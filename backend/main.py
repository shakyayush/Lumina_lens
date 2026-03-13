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
import secrets
from datetime import datetime
# Ensure the backend folder is always in the Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from contextlib import asynccontextmanager
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from pymongo.errors import ServerSelectionTimeoutError

from models import (
    QuestionRequest,
    QuestionResponse,
    RedeemRequest,
    RedeemResponse,
    StarQuestionRequest,
    AIModeRequest,
    MultimodalContextRequest,
    RtcTokenRequest,
    RtcTokenResponse,
)
from websockets_manager import ws_manager
import session_manager as sm
import rewards as rw
import database as db
import context_manager as cm
from duplicate_detector import is_duplicate_async, get_embedding_async


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
# AI is now default ON for all sessions.
_ai_mode: dict[str, bool] = {}
_rtc_presence: dict[str, set[str]] = {}

RTC_MAX_PARTICIPANTS = 10
RTC_PROVIDER_URL = os.getenv("RTC_PROVIDER_URL", "").strip()
RTC_API_KEY = os.getenv("RTC_API_KEY", "").strip()
RTC_API_SECRET = os.getenv("RTC_API_SECRET", "").strip()


def _build_rtc_identity(session_id: str, role: str, user_id: str | None) -> str:
    if role == "host":
        return f"host_{session_id}"
    if user_id:
        return f"audience_{user_id}"
    return f"audience_{secrets.token_hex(6)}"


def _issue_livekit_token(room_name: str, identity: str, role: str) -> str:
    if not RTC_PROVIDER_URL or not RTC_API_KEY or not RTC_API_SECRET:
        raise RuntimeError("RTC provider is not configured. Set RTC_PROVIDER_URL, RTC_API_KEY, RTC_API_SECRET.")
    try:
        from livekit import api as lk_api
    except Exception as exc:
        raise RuntimeError("LiveKit SDK missing. Install dependency 'livekit-api'.") from exc

    grants = lk_api.VideoGrants(
        room=room_name,
        room_join=True,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=True,
    )
    token = (
        lk_api.AccessToken(RTC_API_KEY, RTC_API_SECRET)
        .with_identity(identity)
        .with_name(identity)
        .with_grants(grants)
    )
    metadata = {"role": role, "session_id": room_name}
    return token.with_metadata(str(metadata)).to_jwt()


async def _reprocess_existing_inbox_with_ai(session_id: str) -> dict:
    """
    When host toggles AI ON, reprocess existing inbox questions:
    - auto-answer draft-covered questions (remove from host inbox)
    - remove semantic duplicates
    - keep only unique unresolved questions in host inbox
    """
    session = sm.get_session(session_id)
    if not session:
        return {"resolved_by_ai": 0, "duplicates_removed": 0, "kept": 0}

    # Reprocess the full attendee inbox, not only currently curated list.
    questions = list(session.get("all_questions", session.get("questions", [])))
    if not questions:
        return {"resolved_by_ai": 0, "duplicates_removed": 0, "kept": 0}

    kept_questions: list[dict] = []
    kept_embeddings: list[list] = []
    resolved_count = 0
    duplicate_count = 0
    ai_suffix = "\n\n— Answered by AI"

    for q in questions:
        q_text = q.get("text", "")
        answer_text = None
        score = None

        if cm.has_context(session_id):
            context_answer = cm.find_answer_in_context(session_id, q_text, threshold=0.32)
            score = context_answer.get("score")

            if context_answer.get("found"):
                answer_text = await asyncio.to_thread(
                    cm.generate_answer_from_draft,
                    session_id,
                    q_text,
                    context_answer.get("answer", ""),
                )
                if not answer_text:
                    raw = (context_answer.get("answer", "") or "").strip()
                    answer_text = raw.split(".")[0].strip() if raw else None

            if not answer_text:
                answer_text = await asyncio.to_thread(cm.generate_answer_from_draft, session_id, q_text)

        if answer_text:
            resolved_count += 1
            await ws_manager.broadcast(
                session_id,
                {
                    "type": "ai_resolution",
                    "user_id": q.get("user_id"),
                    "question_id": q.get("id"),
                    "message": answer_text + ai_suffix,
                    "similarity_score": score,
                },
            )
            continue

        if kept_embeddings:
            dup, _ = await is_duplicate_async(q_text, kept_questions, kept_embeddings)
            if dup:
                duplicate_count += 1
                continue

        kept_questions.append(q)
        kept_embeddings.append(await get_embedding_async(q_text))

    session["questions"] = kept_questions
    session["embeddings"] = kept_embeddings

    # Push refreshed host inbox immediately.
    await ws_manager.broadcast(
        session_id,
        {
            "type": "new_question",
            "questions": sm.get_questions(session_id),
        },
    )

    return {
        "resolved_by_ai": resolved_count,
        "duplicates_removed": duplicate_count,
        "kept": len(kept_questions),
    }

# Catch MongoDB connectivity errors; return friendly 503 instead of 500
@app.exception_handler(ServerSelectionTimeoutError)
async def mongo_timeout_handler(request, exc):
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database temporarily unavailable. Is MongoDB running? See MONGO_URI in backend/.env",
        },
    )

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
async def start_session(session_id: str, role: str = "audience"):
    """
    Start/join a meeting session.

    - host: reset session to clean state (new meeting)
    - audience: join existing session without wiping host state
    - AI Organizer remains ON by default
    """
    if role == "host":
        result = sm.reset_session(session_id)
        _ai_mode[session_id] = True
        _rtc_presence[session_id] = set()
        cm.clear_context(session_id)
    else:
        result = sm.create_session(session_id)
        if session_id not in _ai_mode:
            _ai_mode[session_id] = True
        _rtc_presence.setdefault(session_id, set())
    await db.save_session(session_id)          # Persist to MongoDB
    return result


@app.get("/sessions")
async def list_sessions():
    """List all sessions — pulls from MongoDB for persistence across restarts."""
    return await db.get_all_sessions_from_db()


@app.post("/session/{session_id}/rtc-token", response_model=RtcTokenResponse)
async def issue_rtc_token(session_id: str, body: RtcTokenRequest):
    """
    Issue short-lived managed WebRTC token for a room join.
    Enforces basic role validation and room capacity guard.
    """
    role = (body.role or "").strip().lower()
    if role not in ("host", "audience"):
        return JSONResponse(status_code=400, content={"detail": "Invalid role. Use 'host' or 'audience'."})

    if not sm.get_session(session_id):
        sm.create_session(session_id)

    present = _rtc_presence.setdefault(session_id, set())
    identity = _build_rtc_identity(session_id, role, body.user_id)

    if identity not in present and len(present) >= RTC_MAX_PARTICIPANTS:
        return JSONResponse(
            status_code=429,
            content={"detail": f"Room participant limit reached ({RTC_MAX_PARTICIPANTS})."},
        )

    try:
        token = _issue_livekit_token(session_id, identity, role)
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    # Reserve participant slot at token issuance time to enforce capacity
    # even before explicit presence callbacks arrive from clients.
    present.add(identity)

    return RtcTokenResponse(
        token=token,
        ws_url=RTC_PROVIDER_URL,
        room_name=session_id,
        identity=identity,
        role=role,
    )


@app.post("/session/{session_id}/rtc-presence")
async def rtc_presence(session_id: str, identity: str, state: str = "join"):
    """
    Best-effort presence tracking for capacity guarding and diagnostics.
    """
    present = _rtc_presence.setdefault(session_id, set())
    if state == "leave":
        present.discard(identity)
    else:
        present.add(identity)
    return {"session_id": session_id, "participants": len(present)}


# ─────────────────────────────────────────────
# QUESTION ROUTES
# ─────────────────────────────────────────────

@app.post("/session/{session_id}/question", response_model=QuestionResponse)
async def submit_question(session_id: str, body: QuestionRequest):
    """
    Submit a question from an attendee.

    AI is always ON:
      (1) Common/context questions answered by AI (not queued)
      (2) Duplicates are filtered
      (3) Unique unresolved questions are queued to host inbox
    """
    user_status = rw.get_status(body.user_id)
    user_tier = user_status["tier"]
    total_points = user_status["points"]
    tier = user_tier
    ai_enabled = _ai_mode.get(session_id, True)
    # Always keep raw attendee submissions for full host inbox when AI is OFF.
    sm.record_submission(session_id, body.user_id, body.text, user_tier)

    # When AI is ON: check draft/context FIRST. Answer meeting-topic and basic
    # questions from the draft — even if unique (first time asked).
    AI_ANSWER_SUFFIX = "\n\n— Answered by AI"
    if ai_enabled and cm.has_context(session_id):
        context_answer = cm.find_answer_in_context(session_id, body.text, threshold=0.32)
        answer_text = None
        if context_answer and context_answer.get("found"):
            answer_text = await asyncio.to_thread(
                cm.generate_answer_from_draft,
                session_id,
                body.text,
                context_answer.get("answer", ""),
            )
            if not answer_text:
                # Fallback: never return huge chunks; keep first sentence only.
                raw = (context_answer.get("answer", "") or "").strip()
                answer_text = raw.split(".")[0].strip() if raw else None
        if not answer_text:
            # No chunk match — always try Gemini to answer from draft (it will say "wasn't covered" if unrelated)
            answer_text = await asyncio.to_thread(cm.generate_answer_from_draft, session_id, body.text)
        if answer_text:
            return QuestionResponse(
                status="context_answered",
                message=answer_text + AI_ANSWER_SUFFIX,
                points_earned=0,
                total_points=total_points,
                tier=tier,
                similarity_score=context_answer.get("score") if context_answer else None,
            )

    # Run duplicate detection (only when AI on) and question limit checks.
    result = await sm.process_question(
        session_id,
        body.user_id,
        body.text,
        user_tier,
        ai_enabled,
    )

    if result["status"] == "unique":
        question_doc = {
            "id": result["question_id"],
            "user_id": body.user_id,
            "text": body.text,
            "timestamp": datetime.utcnow().isoformat(),
            "priority": "priority" if user_tier in ("pro", "enterprise") else "normal",
            "starred": False,
        }

        # Broadcast to host inbox
        await ws_manager.broadcast(
            session_id,
            {
                "type": "new_question",
                "questions": sm.get_questions(session_id) if ai_enabled else sm.get_all_questions(session_id),
            },
        )
        asyncio.create_task(db.save_question(session_id, question_doc))

    # Fall back to duplicate/unique/limit_reached messaging.
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
    ai_enabled = _ai_mode.get(session_id, True)
    await ws_manager.broadcast(
        session_id,
        {
            "type": "star",
            "questions": sm.get_questions(session_id) if ai_enabled else sm.get_all_questions(session_id),
            "leaderboard": rw.get_leaderboard(sm.get_participants(session_id)),
            # Targeted payload so the attendee whose question was starred
            # can update their Spark points in real time via WebSockets.
            "user_id": starred_q["user_id"],
            "new_total": updated_rewards["points"],
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
    ai_enabled = _ai_mode.get(session_id, True)
    return sm.get_questions(session_id) if ai_enabled else sm.get_all_questions(session_id)


# ─────────────────────────────────────────────
# REWARDS ROUTES
# ─────────────────────────────────────────────

@app.get("/rewards/{user_id}")
async def get_rewards(user_id: str):
    """Get a user's Spark Points balance, tier, and benefits."""
    # Try MongoDB first (persisted), fallback to in-memory
    db_record = await db.get_user_rewards(user_id)
    if db_record:
        return {
            "user_id": db_record.get("user_id", user_id),
            "points": db_record.get("points", 0),
            "tier": db_record.get("tier", "basic"),
            "benefits": rw.TIER_BENEFITS.get(db_record.get("tier", "basic"), rw.TIER_BENEFITS["basic"]),
        }
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


@app.post("/session/{session_id}/multimodal-context")
async def ingest_multimodal_context_route(session_id: str, body: MultimodalContextRequest):
    """
    Ingest live multimodal meeting context from host:
    - audio transcript snippets
    - video frame snapshot + frame-rate metadata
    """
    return await asyncio.to_thread(
        cm.ingest_multimodal_context,
        session_id,
        body.transcript,
        body.frame_data_url,
        body.frame_rate,
    )


@app.get("/session/{session_id}/frame-rate")
async def get_frame_rate(session_id: str):
    """
    Real-time frame-rate telemetry for the active meeting camera stream.
    No UI change required; can be consumed by monitoring/tools.
    """
    return cm.get_frame_rate_stats(session_id)


@app.get("/session/{session_id}/debug")
async def debug_session(session_id: str):
    """Diagnostic: current AI state, context, and question count for troubleshooting."""
    questions = sm.get_questions(session_id)
    return {
        "session_id": session_id,
        "ai_enabled": _ai_mode.get(session_id, True),
        "has_context": cm.has_context(session_id),
        "question_count": len(questions),
        "context_chunk_count": len(cm._contexts.get(session_id, {}).get("chunks", [])),
        "frame_rate": cm.get_frame_rate_stats(session_id),
        "rtc_participants": len(_rtc_presence.get(session_id, set())),
    }


@app.post("/session/{session_id}/ai-mode")
async def set_ai_mode(session_id: str, body: AIModeRequest):
    """
    Backward-compatible endpoint.
    AI Organizer is now fixed ON by design.
    """
    _ai_mode[session_id] = True
    stats = await _reprocess_existing_inbox_with_ai(session_id)
    return {"session_id": session_id, "ai_enabled": True, "reprocess": stats}


@app.get("/session/{session_id}/ai-mode")
async def get_ai_mode(session_id: str):
    """Read the current AI Organizer mode for a session."""
    return {"session_id": session_id, "ai_enabled": _ai_mode.get(session_id, True)}


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
