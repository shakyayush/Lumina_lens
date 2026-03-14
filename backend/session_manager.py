"""
Session Manager
---------------
Manages individual meeting sessions entirely in memory.

Each session holds:
  - A list of accepted (unique) questions shown to the host
  - A list of their embeddings (used for duplicate checks via numpy cosine similarity)
  - A set of all user IDs who participated
  - Session metadata: host name, meeting topic

Optimized for free-tier deployment:
  - No FAISS dependency (replaced with numpy cosine similarity)
  - No local ML models (embeddings come from Gemini API)
"""

import asyncio
import secrets
from datetime import datetime
from uuid import uuid4
from typing import Optional

from duplicate_detector import get_embedding_async, is_duplicate_with_index_async

# In-memory store: { session_id: session_data }
_sessions: dict = {}

# Per-session asyncio locks to protect mutation of shared state
_session_locks: dict[str, asyncio.Lock] = {}


def _get_lock(session_id: str) -> asyncio.Lock:
    if session_id not in _session_locks:
        _session_locks[session_id] = asyncio.Lock()
    return _session_locks[session_id]


def create_session(session_id: str) -> dict:
    """Create a meeting session if missing; preserve if it already exists."""
    if session_id in _sessions:
        return {"session_id": session_id, "status": "already_exists"}
    _sessions[session_id] = {
        "id": session_id,
        "created_at": datetime.utcnow().isoformat(),
        "questions": [],
        "embeddings": [],          # plain list — replaces FAISS index
        "participants": set(),
        "host_name": None,
        "meeting_topic": None,
        "host_token": None,
    }
    return {"session_id": session_id, "status": "created"}


def reset_session(session_id: str) -> dict:
    """Reset a meeting session to a clean state (called when host starts a new meeting)."""
    host_token = secrets.token_hex(24)
    _sessions[session_id] = {
        "id": session_id,
        "created_at": datetime.utcnow().isoformat(),
        "questions": [],
        "embeddings": [],
        "participants": set(),
        "host_name": None,
        "meeting_topic": None,
        "host_token": host_token,
    }
    _session_locks.pop(session_id, None)
    return {"session_id": session_id, "status": "reset", "host_token": host_token}


def validate_host_token(session_id: str, token: str) -> bool:
    """Return True if the token matches the host secret for this session."""
    session = _sessions.get(session_id)
    if not session or not session.get("host_token"):
        return False
    return secrets.compare_digest(session["host_token"], token)


def get_session(session_id: str) -> dict | None:
    """Retrieve a session, or None if it doesn't exist."""
    return _sessions.get(session_id)


def set_session_metadata(session_id: str, host_name: Optional[str], meeting_topic: Optional[str]) -> dict:
    """Store host name and meeting topic for AI auto-answering."""
    session = _sessions.get(session_id)
    if not session:
        create_session(session_id)
        session = _sessions[session_id]
    if host_name is not None:
        session["host_name"] = host_name.strip()
    if meeting_topic is not None:
        session["meeting_topic"] = meeting_topic.strip()
    return {"session_id": session_id, "host_name": session["host_name"], "meeting_topic": session["meeting_topic"]}


def get_session_metadata(session_id: str) -> dict:
    """Get host name and meeting topic for a session."""
    session = _sessions.get(session_id)
    if not session:
        return {"host_name": None, "meeting_topic": None}
    return {"host_name": session.get("host_name"), "meeting_topic": session.get("meeting_topic")}


async def process_question(
    session_id: str,
    user_id: str,
    text: str,
    ai_enabled: bool,
) -> dict:
    """
    Core logic: check for duplicates, then either accept or reject the question.

    Returns a result dict with:
      - status:           "unique" or "duplicate"
      - message:          Text to show the attendee
      - points_earned:    0 always (awarded later when host stars)
      - question_id:      UUID of the saved question (only if unique)
      - similarity_score: How similar it was to the nearest existing question
    """
    async with _get_lock(session_id):
        session = _sessions.get(session_id)
        if not session:
            create_session(session_id)
            session = _sessions[session_id]

        session["participants"].add(user_id)

        # Compute embedding for duplicate check
        embedding = await get_embedding_async(text)

        # Duplicate check using numpy cosine similarity
        if ai_enabled and session["embeddings"] and embedding:
            dup, score = await is_duplicate_with_index_async(
                text,
                embedding,
                session["questions"],
                session["embeddings"],   # pass plain list instead of FAISS index
            )
        else:
            dup, score = False, 0.0

        if dup:
            return {
                "status": "duplicate",
                "message": (
                    f"🔁 This question is similar to one already asked "
                    f"(similarity: {score * 100:.1f}%). "
                    f"The host will address it soon!"
                ),
                "points_earned": 0,
                "question_id": None,
                "similarity_score": score,
            }

        # Accept unique question
        question_id = str(uuid4())
        question = {
            "id": question_id,
            "user_id": user_id,
            "text": text,
            "timestamp": datetime.utcnow().isoformat(),
            "priority": "normal",
            "starred": False,
        }

        session["questions"].append(question)
        if embedding:
            session["embeddings"].append(embedding)

        return {
            "status": "unique",
            "message": "✅ Your question has been sent to the host! Earn 50 Spark Points if they star it.",
            "points_earned": 0,
            "question_id": question_id,
            "similarity_score": score,
        }


def star_question(session_id: str, question_id: str) -> dict | None:
    """Marks a question as starred by the host."""
    session = _sessions.get(session_id)
    if not session:
        return None
    for q in session.get("questions", []):
        if q["id"] == question_id:
            if not q.get("starred", False):
                q["starred"] = True
                return q
            return None  # Already starred
    return None


def get_questions(session_id: str) -> list:
    """Return all accepted questions for a session (for host dashboard). Priority questions first."""
    session = _sessions.get(session_id)
    if not session:
        return []
    return sorted(session["questions"], key=lambda q: (0 if q["priority"] == "priority" else 1))


def get_participants(session_id: str) -> list:
    """Return list of all unique participant user IDs in a session."""
    session = _sessions.get(session_id)
    if not session:
        return []
    return list(session["participants"])


def get_all_sessions() -> list:
    """Return a summary of all active sessions."""
    return [
        {
            "session_id": sid,
            "created_at": s["created_at"],
            "question_count": len(s["questions"]),
            "participant_count": len(s["participants"]),
        }
        for sid, s in _sessions.items()
    ]
