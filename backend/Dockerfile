# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# 1. Install System Dependencies (Required for psycopg2)
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 2. SDK INSTALLATION (Fix #1)
# Copy the SDK from the project root (context) into the container
COPY chronos_sdk /chronos_sdk

# Install the SDK in editable mode so it registers as a package
RUN pip install -e /chronos_sdk

# 3. BACKEND DEPENDENCIES
# Copy requirements relative to the project root
COPY backend/requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# 4. APPLICATION CODE
# ✅ FIX: Copy contents of backend/ into /app/ (not backend/ as subdirectory)
COPY backend/. .

# 5. RUNTIME
# Start the FastAPI server
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
