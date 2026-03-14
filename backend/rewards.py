"""
Spark Rewards Engine — Lumina Lens
------------------------------------
Users earn Sharp Tokens (points) by asking questions the host stars.

Fixes applied:
  - Removed tier logic and paid plans.
"""

from typing import Dict

POINTS_PER_STAR = 50

# In-memory store: { user_id: { "points": int } }
_user_store: Dict[str, dict] = {}


def _init_user(user_id: str):
    if user_id not in _user_store:
        _user_store[user_id] = {"points": 0}


def earn_points(user_id: str, amount: int = POINTS_PER_STAR) -> dict:
    """
    Award points to a user (called when host stars a question).
    """
    _init_user(user_id)
    _user_store[user_id]["points"] += amount
    return get_status(user_id)


def get_status(user_id: str) -> dict:
    _init_user(user_id)
    info = _user_store[user_id]
    return {
        "user_id": user_id,
        "points": info["points"],
    }


def load_from_db(user_id: str, points: int):
    """
    Seed in-memory store from DB record (called on server startup or first access).
    """
    _user_store[user_id] = {
        "points": max(0, points),
    }


def get_leaderboard(user_ids: list) -> list:
    board = []
    for uid in user_ids:
        _init_user(uid)
        board.append({
            "user_id": uid,
            "points": _user_store[uid]["points"],
        })
    return sorted(board, key=lambda x: x["points"], reverse=True)

