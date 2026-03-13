"""
Database — MongoDB Atlas Integration (Step 2)
----------------------------------------------
Connects Lumina Lens to MongoDB Atlas for persistent storage.

Why MongoDB?
  - Stores questions, user rewards, and session history permanently
  - Data survives server restarts (unlike in-memory dicts)
  - Free tier on Atlas is more than enough for the hackathon MVP

Collections:
  - questions   → all unique questions per session
  - users        → Spark Points balance + tier per user
  - sessions     → session metadata (start time, participant count)

Setup:
  1. Go to https://mongodb.com/atlas → create free account
  2. Create a free M0 cluster
  3. Click "Connect" → get your connection string
  4. Replace MONGO_URI below with your actual connection string
  5. Add your IP to the Atlas Network Access whitelist
"""

import os
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime

# ── Connection ────────────────────────────────────────────────────────────────
# Set this as an environment variable OR paste your Atlas URI directly here for the hackathon
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = "luminalens"

client: AsyncIOMotorClient = None
db = None


async def connect_db():
    """Call this once when the FastAPI server starts up."""
    global client, db
    client = AsyncIOMotorClient(MONGO_URI)
    db = client[DB_NAME]
    # Use plain ASCII to avoid encoding issues on some terminals
    print(f"Connected to MongoDB: {DB_NAME}")


async def close_db():
    """Call this when the server shuts down."""
    if client:
        client.close()
        print("MongoDB connection closed")


# ── Questions ─────────────────────────────────────────────────────────────────

async def save_question(session_id: str, question: dict):
    """Persist a unique question to MongoDB."""
    doc = {**question, "session_id": session_id, "saved_at": datetime.utcnow()}
    await db.questions.insert_one(doc)


async def get_questions_from_db(session_id: str) -> list:
    """Fetch all unique questions for a session from MongoDB."""
    cursor = db.questions.find(
        {"session_id": session_id},
        {"_id": 0}  # exclude MongoDB's internal _id field
    ).sort("timestamp", 1)
    return await cursor.to_list(length=500)


# ── Users / Rewards ───────────────────────────────────────────────────────────

async def save_user_rewards(user_id: str, points: int, tier: str):
    """Upsert (create or update) a user's Spark Points record."""
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"points": points, "tier": tier, "updated_at": datetime.utcnow()}},
        upsert=True,
    )


async def get_user_rewards(user_id: str) -> dict | None:
    """Fetch a user's rewards record from MongoDB."""
    return await db.users.find_one({"user_id": user_id}, {"_id": 0})


# ── Sessions ──────────────────────────────────────────────────────────────────

async def save_session(session_id: str):
    """Record a new session start."""
    await db.sessions.update_one(
        {"session_id": session_id},
        {"$setOnInsert": {"session_id": session_id, "created_at": datetime.utcnow()}},
        upsert=True,
    )


async def get_all_sessions_from_db() -> list:
    """Fetch all session records."""
    cursor = db.sessions.find({}, {"_id": 0})
    return await cursor.to_list(length=100)
