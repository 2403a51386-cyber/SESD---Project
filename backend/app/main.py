"""DMERAS FastAPI application entry point."""

import logging
import os
from typing import Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .database import engine

logger = logging.getLogger(__name__)

app = FastAPI(
    title="DMERAS API",
    description="Backend API for the Disaster Management & Emergency Resource Allocation System.",
    version="0.1.0",
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:5500,http://localhost:5500",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/", tags=["Health"])
def read_root() -> Dict[str, str]:
    """Return a simple message confirming that the API process is running."""
    return {"service": "DMERAS API", "status": "running"}


@app.get("/health", tags=["Health"])
def health_check() -> Dict[str, str]:
    """Report API health and check PostgreSQL when it is configured."""
    if engine is None:
        return {"api": "ok", "database": "not_configured"}

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        logger.exception("PostgreSQL health check failed")
        raise HTTPException(
            status_code=503,
            detail="The API is running, but the database connection failed.",
        ) from error

    return {"api": "ok", "database": "connected"}
