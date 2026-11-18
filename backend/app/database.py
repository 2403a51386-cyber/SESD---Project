"""PostgreSQL engine and SQLAlchemy session configuration."""

import os
from pathlib import Path
from typing import Generator

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL, pool_pre_ping=True) if DATABASE_URL else None
SessionLocal = (
    sessionmaker(bind=engine, autoflush=False, autocommit=False)
    if engine is not None
    else None
)


class Base(DeclarativeBase):
    """Base class for SQLAlchemy models added in the next backend step."""


def get_db() -> Generator[Session, None, None]:
    """Yield a database session and always close it after the request."""
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL is not configured; create backend/.env first.")

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
