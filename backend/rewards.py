"""
Spark Rewards Engine — Lumina Lens
------------------------------------
Users earn Spark Points by submitting UNIQUE questions.
Points can be redeemed to unlock premium tiers.

Tiers:
  Basic      →   0 pts  (free)   — 5 questions/session, standard reply
  Pro        → 500 pts           — unlimited questions, priority highlight
  Enterprise → 2000 pts          — Pro + analytics export
"""

from typing import Dict

POINTS_PER_UNIQUE_QUESTION = 50

TIER_THRESHOLDS = {
    "basic": 0,
    "pro": 500,
    "enterprise": 2000,
}

TIER_BENEFITS = {
    "basic": "5 questions/session, standard replies",
    "pro": "Unlimited questions, priority highlighting on host dashboard",
    "enterprise": "Pro + session analytics export",
}

# In-memory store: { user_id: { "points": int, "tier": str } }
_user_store: Dict[str, dict] = {}


def _init_user(user_id: str):
    if user_id not in _user_store:
        _user_store[user_id] = {"points": 0, "tier": "basic"}


def earn_points(user_id: str, amount: int = POINTS_PER_UNIQUE_QUESTION) -> dict:
    _init_user(user_id)
    _user_store[user_id]["points"] += amount
    return get_status(user_id)


def get_status(user_id: str) -> dict:
    _init_user(user_id)
    info = _user_store[user_id]
    return {
        "user_id": user_id,
        "points": info["points"],
        "tier": info["tier"],
        "benefits": TIER_BENEFITS[info["tier"]],
    }


def redeem_points(user_id: str, target_tier: str) -> dict:
    _init_user(user_id)
    target_tier = target_tier.lower()

    if target_tier not in TIER_THRESHOLDS:
        return {"success": False, "message": f"Unknown tier: {target_tier}",
                "new_tier": _user_store[user_id]["tier"],
                "remaining_points": _user_store[user_id]["points"]}

    required = TIER_THRESHOLDS[target_tier]
    current_points = _user_store[user_id]["points"]

    if current_points < required:
        needed = required - current_points
        return {
            "success": False,
            "message": f"You need {needed} more Spark Points to unlock {target_tier.capitalize()} tier.",
            "new_tier": _user_store[user_id]["tier"],
            "remaining_points": current_points,
        }

    _user_store[user_id]["points"] -= required
    _user_store[user_id]["tier"] = target_tier

    return {
        "success": True,
        "message": f"🎉 You've unlocked {target_tier.capitalize()} tier using {required} Spark Points!",
        "new_tier": target_tier,
        "remaining_points": _user_store[user_id]["points"],
    }


def get_leaderboard(user_ids: list) -> list:
    board = []
    for uid in user_ids:
        _init_user(uid)
        board.append({
            "user_id": uid,
            "points": _user_store[uid]["points"],
            "tier": _user_store[uid]["tier"],
        })
    return sorted(board, key=lambda x: x["points"], reverse=True)
