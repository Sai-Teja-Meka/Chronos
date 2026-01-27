import os
from typing import List, Union, Any
from pydantic_settings import BaseSettings
from pydantic import model_validator

class Settings(BaseSettings):
    """
    Application Configuration validated by Pydantic.
    Reads from environment variables or .env file.
    """
    PROJECT_NAME: str = "Project Chronos"
    API_V1_STR: str = "/api/v1"

    # DATABASE
    DATABASE_URL: str

    # SECURITY / CORS
    # Accept as Union to prevent JSON parsing by EnvSettingsSource
    CORS_ORIGINS: Union[str, List[str]] = []

    # LOGGING
    LOG_LEVEL: str = "INFO"

    # OPENAI (Added in Phase 4)
    OPENAI_API_KEY: str = ""

    @model_validator(mode='before')
    @classmethod
    def parse_cors_origins(cls, values: dict) -> dict:
        """
        Parse CORS_ORIGINS from CSV string to list BEFORE Pydantic processes it.
        This runs before EnvSettingsSource tries JSON parsing.
        """
        cors = values.get('CORS_ORIGINS', '')
        
        # If it's a non-empty string and not JSON array format
        if isinstance(cors, str) and cors and not cors.startswith('['):
            values['CORS_ORIGINS'] = [origin.strip() for origin in cors.split(',') if origin.strip()]
        elif isinstance(cors, str) and not cors:
            values['CORS_ORIGINS'] = []
        # If already a list, keep it
        elif isinstance(cors, list):
            values['CORS_ORIGINS'] = cors
            
        return values

    class Config:
        case_sensitive = True
        # Remove env_file to rely only on docker-compose environment variables
        # env_file = ".env"
        extra = "ignore"

# Global instance
settings = Settings()
