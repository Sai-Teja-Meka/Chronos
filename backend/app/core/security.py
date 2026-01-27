"""
Security Middleware for Project Chronos
Implements: API Key Auth, Rate Limiting (Redis-backed), Input Validation, Audit Logging
"""

import os
import time
import hashlib
import secrets
import redis
from typing import Optional, Dict, Callable, Any
from datetime import datetime, timedelta
from functools import wraps

from fastapi import HTTPException, Request, status, Depends, FastAPI
from fastapi.security import APIKeyHeader
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import logging

logger = logging.getLogger("chronos.security")

# ============================================
# 1. API KEY AUTHENTICATION
# ============================================

API_KEY_NAME = "X-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)

class APIKeyManager:
    """Manages API key validation and rotation"""
    
    def __init__(self):
        # Load from environment or secrets manager
        self.valid_keys = self._load_api_keys()
        
    def _load_api_keys(self) -> set:
        """Load API keys from environment"""
        keys_str = os.getenv("CHRONOS_API_KEYS", "")
        
        if not keys_str:
            logger.warning("⚠️ NO API KEYS CONFIGURED - All requests will be rejected!")
            logger.warning("Set CHRONOS_API_KEYS environment variable")
            return set()
        
        # Support comma-separated list
        keys = {key.strip() for key in keys_str.split(",") if key.strip()}
        logger.info(f"✅ Loaded {len(keys)} API key(s)")
        return keys
    
    def validate_key(self, api_key: Optional[str]) -> bool:
        """
        Validate API key using constant-time comparison of SHA-256 hashes.
        
        Implements FIX OPTION 1: Direct Constant-Time Comparison.
        Assumes self.valid_keys contains SHA-256 hashes of the actual API keys.
        """
        if not api_key:
            return False
        
        # Hash the provided key to prevent timing attacks and allow hashed storage
        provided_hash = hashlib.sha256(api_key.encode()).hexdigest()
        
        # Constant-time comparison against valid key hashes
        return any(secrets.compare_digest(provided_hash, valid_key) 
                  for valid_key in self.valid_keys)
    
    @staticmethod
    def generate_key() -> str:
        """Generate a new secure API key"""
        return f"chronos_{secrets.token_urlsafe(32)}"

api_key_manager = APIKeyManager()

async def get_api_key(api_key: Optional[str] = Depends(api_key_header)) -> str:
    """Dependency for API key validation"""
    if not api_key_manager.validate_key(api_key):
        logger.warning(f"❌ Invalid API key attempt: {api_key[:10] if api_key else 'None'}...")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
            headers={"WWW-Authenticate": "ApiKey"}
        )
    return api_key

# ============================================
# 2. RATE LIMITING (Redis-Backed)
# ============================================

def get_api_key_from_header(request: Request) -> str:
    """
    Extract API key from headers for rate limiting identification.
    Falls back to IP address if no API key provided.
    """
    # Check X-API-Key header first
    api_key = request.headers.get(API_KEY_NAME)
    if api_key:
        return f"api_key:{hashlib.sha256(api_key.encode()).hexdigest()[:16]}"
    
    # Check Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        key_part = auth_header[7:]
        return f"api_key:{hashlib.sha256(key_part.encode()).hexdigest()[:16]}"

    # Fallback to IP address
    return f"ip:{get_remote_address(request)}"

def create_redis_limiter() -> Limiter:
    """
    Initialize Redis-backed rate limiter.
    Ensures shared state across backend instances.
    """
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    
    return Limiter(
        key_func=get_api_key_from_header,
        storage_uri=redis_url,
        default_limits=["100/minute"],
        strategy="moving-window",
        headers_enabled=True
    )

# Global Limiter Instance
limiter = create_redis_limiter()

def setup_rate_limiting(app: FastAPI):
    """
    Configure FastAPI app with rate limiting exception handlers.
    Call this from main.py
    """
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

def get_rate_limit_stats(api_key: str) -> Dict[str, Any]:
    """
    Retrieve current rate limit statistics for a specific key from Redis.
    Useful for monitoring endpoints.
    """
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    try:
        redis_client = redis.from_url(redis_url)
        
        # Calculate current time window
        current_minute = int(time.time() / 60)
        
        # Generate the key slowapi uses (hashing the api key to match get_api_key_from_header logic)
        key_hash = hashlib.sha256(api_key.encode()).hexdigest()[:16]
        redis_key = f"slowapi:api_key:{key_hash}:{current_minute}"
        
        count = redis_client.get(redis_key)
        requests_count = int(count) if count else 0
        limit = 100 # Default limit
        
        return {
            "requests_current_minute": requests_count,
            "limit": limit,
            "remaining": max(0, limit - requests_count),
            "status": "healthy"
        }
    except Exception as e:
        logger.error(f"Failed to fetch rate limit stats: {e}")
        return {"status": "error", "details": str(e)}

# ============================================
# 3. SECURITY MIDDLEWARE
# ============================================

class SecurityMiddleware(BaseHTTPMiddleware):
    """
    Global security middleware.
    
    Note: Rate limiting is now handled by the 'slowapi' decorators 
    and middleware, so manual checks have been removed from here 
    to prevent double-counting or conflicts.
    """
    
    async def dispatch(self, request: Request, call_next: Callable):
        # Track request start time
        start_time = time.time()
        
        # Process request
        try:
            response = await call_next(request)
            
            # Audit Logging
            duration_ms = (time.time() - start_time) * 1000
            self._audit_log(request, response, duration_ms)
            
            return response
            
        except Exception as e:
            logger.error(f"❌ Request failed: {request.url.path} - {str(e)}")
            raise
    
    def _audit_log(self, request: Request, response: Response, duration_ms: float):
        """Log security-relevant events"""
        # Log all authenticated requests
        if request.url.path.startswith("/trace") or request.url.path.startswith("/branch"):
            api_key = request.headers.get(API_KEY_NAME, "none")
            key_hash = hashlib.sha256(api_key.encode()).hexdigest()[:8]
            
            logger.info(
                f"🔒 {request.method} {request.url.path} | "
                f"Key: {key_hash} | Status: {response.status_code} | "
                f"Duration: {duration_ms:.2f}ms"
            )

# ============================================
# 4. INPUT VALIDATION
# ============================================

class SecurityValidator:
    """Input validation helpers"""
    
    @staticmethod
    def validate_uuid(value: str) -> bool:
        """Validate UUID format"""
        import re
        uuid_pattern = re.compile(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            re.IGNORECASE
        )
        return bool(uuid_pattern.match(value))
    
    @staticmethod
    def validate_conversation_id(conversation_id: str) -> str:
        """Validate and sanitize conversation ID"""
        if not SecurityValidator.validate_uuid(conversation_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid conversation_id format (must be UUID)"
            )
        return conversation_id
    
    @staticmethod
    def validate_event_type(event_type: str) -> str:
        """Validate event type against whitelist"""
        allowed_types = {
            'user_message',
            'assistant_message',
            'tool_call',
            'tool_result',
            'error',
            'system_message'
        }
        
        if event_type not in allowed_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid event_type. Allowed: {allowed_types}"
            )
        
        return event_type
    
    @staticmethod
    def validate_json_size(json_data: dict, max_size_mb: float = 1.0) -> dict:
        """Validate JSON payload size"""
        import json
        size_bytes = len(json.dumps(json_data).encode('utf-8'))
        max_bytes = max_size_mb * 1024 * 1024
        
        if size_bytes > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Payload too large: {size_bytes/1024/1024:.2f}MB (max: {max_size_mb}MB)"
            )
        
        return json_data
    
    @staticmethod
    def sanitize_string(value: str, max_length: int = 10000) -> str:
        """Sanitize string input"""
        # Remove null bytes
        value = value.replace('\x00', '')
        
        # Truncate if too long
        if len(value) > max_length:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"String too long: {len(value)} chars (max: {max_length})"
            )
        
        return value

security_validator = SecurityValidator()

# ============================================
# 5. CORS SECURITY
# ============================================

def get_cors_origins() -> list:
    """Get allowed CORS origins from environment"""
    origins_str = os.getenv("CHRONOS_CORS_ORIGINS", "http://localhost:5173")
    
    origins = [origin.strip() for origin in origins_str.split(",") if origin.strip()]
    
    logger.info(f"✅ CORS allowed origins: {origins}")
    return origins

# ============================================
# 6. HELPER FUNCTIONS
# ============================================

def require_api_key(func):
    """Decorator to require API key for endpoints"""
    @wraps(func)
    async def wrapper(*args, api_key: str = Depends(get_api_key), **kwargs):
        # API key already validated by dependency
        return await func(*args, **kwargs)
    return wrapper