"""
run.py — Lumina Lens Server Launcher
--------------------------------------
Run this file to start the Lumina Lens backend server.

Usage:
    python run.py
"""

import sys
import os

# MUST be set before any local imports — ensures models, rewards, etc. are found
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import the app object directly (not as a string) so sys.path is applied first
from main import app  # noqa: E402
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        app,            # pass the actual object, not the "main:app" string
        host="0.0.0.0",
        port=8000,
    )
