"""
Main FastAPI Application — Lumina Lens
---------------------------------------
Entry point of the backend server.
Wires together: session manager, duplicate detector, Spark Rewards, and MongoDB.

Run with:
    uvicorn main:app --reload --port 8000

Then visit:
    http://localhost:8000/docs  ← interactive Swagger UI (API explorer)
"""

import sys
import os
# Ensure the backend folder is always in the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from models import (
    QuestionRequest,
    QuestionResponse,
    RedeemRequest,
    RedeemResponse,
    StarQuestionRequest,
    AIModeRequest,
)
from websockets_manager import ws_manager
import session_manager as sm
import rewards as rw
import database as db
import context_manager as cm


# ── Lifespan: runs on startup & shutdown ──────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect_db()   # Connect to MongoDB Atlas on startup
    yield
    await db.close_db()     # Close connection on shutdown


app = FastAPI(
    title="Lumina Lens API",
    description="AI-powered Meeting Assistant that filters duplicate questions in live meetings using NLP. Powered by Spark Rewards.",
    version="1.0.0",
    lifespan=lifespan,
)

# Per-session flag: whether AI Organizer is actively shaping responses.
_ai_mode: dict[str, bool] = {}

# Allow Base44 frontend (and any local dev tool) to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # In production, restrict to your Base44 app domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────
# SESSION ROUTES
# ─────────────────────────────────────────────

@app.post("/session/{session_id}/start")
async def start_session(session_id: str):
    """Create a new meeting session. Call this when the host starts the meeting."""
    result = sm.create_session(session_id)
    # Default AI mode is off until host explicitly enables it
    _ai_mode[session_id] = False
    await db.save_session(session_id)          # Persist to MongoDB
    return result


@app.get("/sessions")
async def list_sessions():
    """List all sessions — pulls from MongoDB for persistence across restarts."""
    return await db.get_all_sessions_from_db()


# ─────────────────────────────────────────────
# QUESTION ROUTES
# ─────────────────────────────────────────────

@app.post("/session/{session_id}/question", response_model=QuestionResponse)
async def submit_question(session_id: str, body: QuestionRequest):
    """
    Submit a question from an attendee.

    Flow:
      1. Get user's current tier (Basic / Pro / Enterprise)
      2. Check question limit for Basic users
      3. Run duplicate detection (NLP cosine similarity)
      4. If unique → save to in-memory + MongoDB + award 50 Spark Points
      5. If duplicate → return auto-reply, no points earned
    """
    user_status = rw.get_status(body.user_id)
    user_tier = user_status["tier"]

    result = sm.process_question(session_id, body.user_id, body.text, user_tier)

    total_points = user_status["points"]
    tier = user_tier

    context_answer = None

    if result["status"] == "unique":
        # Persist the unique question without points awarded yet
        question_doc = {
            "id": result["question_id"],
            "user_id": body.user_id,
            "text": body.text,
            "priority": "priority" if user_tier in ("pro", "enterprise") else "normal",
            "starred": False,
        }
        await db.save_question(session_id, question_doc)

        ai_enabled = _ai_mode.get(session_id, False)

        # Optional: check if this question can be auto-answered from loaded context
        # AI works "behind the scenes" at all times, but only surfaces answers
        # to attendees when AI Organizer is turned on.
        if cm.has_context(session_id):
            context_answer = cm.find_answer_in_context(session_id, body.text)

        # Broadcast the new question to all connected host dashboards
        await ws_manager.broadcast(
            session_id,
            {
                "type": "new_question",
                "questions": sm.get_questions(session_id),
            },
        )

        # If AI mode is ON and context has a strong match, surface an AI answer
        if ai_enabled and context_answer and context_answer.get("found"):
            return QuestionResponse(
                status="context_answered",
                message=context_answer.get("answer") or result["message"],
                points_earned=0,  # Points still deferred until starred
                total_points=total_points,
                tier=tier,
                similarity_score=context_answer.get("score"),
            )

    # When AI is off, or when context could not confidently answer,
    # fall back to the base duplicate/unique messaging.
    return QuestionResponse(
        status=result["status"],
        message=result["message"],
        points_earned=0,  # Points deferred until starred
        total_points=total_points,
        tier=tier,
        similarity_score=result.get("similarity_score"),
    )

@app.post("/session/{session_id}/star")
async def star_question_endpoint(session_id: str, body: StarQuestionRequest):
    """
    Host action: Star a question because it's good.
    This awards the 50 Spark Points to the attendee who asked it.
    """
    starred_q = sm.star_question(session_id, body.question_id)
    if not starred_q:
        return {"success": False, "message": "Question not found or already starred"}
    
    # Award points to the user who asked it
    updated_rewards = rw.earn_points(starred_q["user_id"])
    
    # Persist the changes
    await db.save_question(session_id, starred_q)
    await db.save_user_rewards(starred_q["user_id"], updated_rewards["points"], updated_rewards["tier"])

    # Broadcast updated questions + leaderboard to all connected hosts
    await ws_manager.broadcast(
        session_id,
        {
            "type": "star",
            "questions": sm.get_questions(session_id),
            "leaderboard": rw.get_leaderboard(sm.get_participants(session_id)),
        },
    )

    return {
        "success": True, 
        "message": "Question starred and points awarded!", 
        "user_id": starred_q["user_id"],
        "new_total": updated_rewards["points"]
    }


@app.get("/session/{session_id}/questions")
async def get_questions(session_id: str):
    """
    Get all unique, curated questions for a session.
    HOST DASHBOARD polls this endpoint to display the live question feed.
    Priority questions (Pro/Enterprise users) appear first.
    """
    return sm.get_questions(session_id)


# ─────────────────────────────────────────────
# REWARDS ROUTES
# ─────────────────────────────────────────────

@app.get("/rewards/{user_id}")
async def get_rewards(user_id: str):
    """Get a user's Spark Points balance, tier, and benefits."""
    # Try MongoDB first (persisted), fallback to in-memory
    db_record = await db.get_user_rewards(user_id)
    if db_record:
        return db_record
    return rw.get_status(user_id)


@app.post("/rewards/{user_id}/redeem", response_model=RedeemResponse)
async def redeem_rewards(user_id: str, body: RedeemRequest):
    """
    Redeem Spark Points to upgrade to a premium tier.

    Tiers:
      - pro        → 500 points → unlimited questions + priority highlight
      - enterprise → 2000 points → Pro + analytics export
    """
    result = rw.redeem_points(user_id, body.tier)
    if result["success"]:
        await db.save_user_rewards(user_id, result["remaining_points"], result["new_tier"])
    return RedeemResponse(**result)


@app.get("/session/{session_id}/leaderboard")
async def get_leaderboard(session_id: str):
    """Top Spark Points earners in this session — great for gamification!"""
    participants = sm.get_participants(session_id)
    return rw.get_leaderboard(participants)


# ─────────────────────────────────────────────
# CONTEXT / VIDEO ROUTES
# ─────────────────────────────────────────────

@app.post("/session/{session_id}/load-video")
async def load_video_context(session_id: str, video_id: str):
    """
    Fetch a YouTube transcript and store it as meeting context.
    Call this when host selects a video. AI uses transcript to auto-answer questions.
    """
    return cm.load_youtube_context(session_id, video_id)


@app.post("/session/{session_id}/load-text")
async def load_text_context_route(session_id: str, text: str):
    """
    Store a manually typed agenda as meeting context.
    Alternative to video transcript — host pastes their own notes.
    """
    return cm.load_text_context(session_id, text)


@app.get("/session/{session_id}/context-status")
async def get_context_status(session_id: str):
    """Check if a session has context loaded."""
    return {"has_context": cm.has_context(session_id)}


@app.post("/session/{session_id}/ai-mode")
async def set_ai_mode(session_id: str, body: AIModeRequest):
    """
    Enable or disable AI Organizer for a given session.

    When disabled, questions are still processed and stored, but
    AI-powered auto-answers are not surfaced to attendees.
    """
    _ai_mode[session_id] = body.enabled
    return {"session_id": session_id, "ai_enabled": body.enabled}


# ─────────────────────────────────────────────
# WEBSOCKET ROUTE
# ─────────────────────────────────────────────

@app.websocket("/session/{session_id}/ws")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    Real-time channel for host and attendees.

    Hosts listen for:
      - type: "new_question" → refreshed curated questions list
      - type: "star"         → updated questions + leaderboard

    Attendees listen for:
      - type: "star" with their user_id → points earned notification
    """
    await ws_manager.connect(session_id, websocket)
    try:
        # Keep the connection open; we don't expect messages from clients right now
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(session_id, websocket)
    except Exception:
        ws_manager.disconnect(session_id, websocket)


# ─────────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "status": "🟢 Lumina Lens is running",
        "docs": "Visit /docs for the interactive API explorer",
    }
