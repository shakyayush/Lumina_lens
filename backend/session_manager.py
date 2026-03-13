"""
Session Manager
---------------
Manages individual meeting sessions entirely in memory.

Each session holds:
  - A list of accepted (unique) questions shown to the host
  - The embeddings of those questions (used for duplicate checks)
  - A set of all user IDs who participated

Think of each session as one meeting/webinar/class.
When a new meeting starts, you create a new session ID.
"""

from datetime import datetime
from uuid import uuid4
from duplicate_detector import get_embedding, is_duplicate

# In-memory store: { session_id: session_data }
_sessions: dict = {}


def create_session(session_id: str) -> dict:
    """Start a new meeting session."""
    _sessions[session_id] = {
        "id": session_id,
        "created_at": datetime.utcnow().isoformat(),
        "questions": [],        # list of accepted Question dicts
        "embeddings": [],       # parallel list of embedding vectors
        "participants": set(),  # user_ids who submitted at least one question
    }
    return {"session_id": session_id, "status": "created"}


def get_session(session_id: str) -> dict | None:
    """Retrieve a session, or None if it doesn't exist."""
    return _sessions.get(session_id)


def process_question(session_id: str, user_id: str, text: str, user_tier: str) -> dict:
    """
    Core logic: check for duplicates, then either accept or reject the question.

    Returns a result dict with:
      - status:           "unique" or "duplicate"
      - message:          Text to show the attendee
      - points_earned:    50 if unique, 0 if duplicate
      - question_id:      UUID of the saved question (only if unique)
      - similarity_score: How similar it was to the nearest existing question
    """
    session = _sessions.get(session_id)
    if not session:
        # Auto-create session if it doesn't exist
        create_session(session_id)
        session = _sessions[session_id]

    session["participants"].add(user_id)

    # --- Basic plan: cap at 5 questions per user per session ---
    if user_tier == "basic":
        user_question_count = sum(
            1 for q in session["questions"] if q["user_id"] == user_id
        )
        if user_question_count >= 5:
            return {
                "status": "limit_reached",
                "message": "⚠️ You've reached the 5-question limit for Basic tier. "
                           "Redeem Spark Points to unlock Pro and ask unlimited questions!",
                "points_earned": 0,
                "question_id": None,
                "similarity_score": None,
            }

    # --- Duplicate check (FAISS + Gemini) ---
    dup, score = is_duplicate(text, session["questions"], session["embeddings"])

    if dup:
        return {
            "status": "duplicate",
            "message": f"🔁 This question is similar to one already asked "
                       f"(similarity: {score * 100:.1f}%). "
                       f"The host will address it soon!",
            "points_earned": 0,
            "question_id": None,
            "similarity_score": score,
        }

    # --- Accept unique question ---
    question_id = str(uuid4())
    priority = "priority" if user_tier in ("pro", "enterprise") else "normal"

    question = {
        "id": question_id,
        "user_id": user_id,
        "text": text,
        "timestamp": datetime.utcnow().isoformat(),
        "priority": priority,
        "starred": False,
    }

    session["questions"].append(question)
    session["embeddings"].append(get_embedding(text))

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
    for q in session["questions"]:
        if q["id"] == question_id:
            if not q.get("starred", False):
                q["starred"] = True
                return q
            return None # Already starred
    return None


def get_questions(session_id: str) -> list:
    """Return all accepted questions for a session (for host dashboard)."""
    session = _sessions.get(session_id)
    if not session:
        return []
    # Priority questions appear first
    questions = session["questions"]
    return sorted(questions, key=lambda q: (0 if q["priority"] == "priority" else 1))


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
