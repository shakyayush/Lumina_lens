"""
Main FastAPI Application — Lumina Lens
---------------------------------------
Entry point of the backend server.
Wires together: session manager, duplicate detector, Spark Rewards, and MongoDB.

Run with:
    uvicorn main:app --reload --port 8000

Then visit:
    http://localhost:8000/docs  ← interactive Swagger UI (API explorer)

Fixes applied (from code review):
  - CORS: explicit origin allowlist, removed allow_credentials+wildcard conflict
  - asyncio.create_task: all fire-and-forget tasks wrapped with logging error handler
  - session metadata endpoint: host can set their name and meeting topic
  - earn_points now persists to DB (points survive restart)
  - load-text / load-video: run in thread (non-blocking)
  - set_ai_mode: now honors the enabled field instead of ignoring it
  - RTC presence protected by asyncio.Lock
  - session metadata injected into AI answer prompts
"""

import sys
import os
import secrets
import asyncio
import logging
from datetime import datetime
from contextlib import asynccontextmanager

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo.errors import ServerSelectionTimeoutError

from models import (
    QuestionRequest,
    QuestionResponse,
    StarQuestionRequest,
    AIModeRequest,
    MultimodalContextRequest,
    RtcTokenRequest,
    RtcTokenResponse,
    SessionMetadataRequest,
    UserProfileRequest,
)
from websockets_manager import ws_manager
import session_manager as sm
import rewards as rw
import database as db
import context_manager as cm
from duplicate_detector import is_duplicate_async, get_embedding_async
from session_manager import validate_host_token

logger = logging.getLogger("lumina_lens")

# ── Lifespan: runs on startup & shutdown ──────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect_db()
    yield
    await db.close_db()


app = FastAPI(
    title="Lumina Lens API",
    description="AI-powered Meeting Assistant that filters duplicate questions in live meetings using NLP. Powered by Spark Rewards.",
    version="2.0.0",
    lifespan=lifespan,
)

# Per-session flag: whether AI Organizer is actively shaping responses.
_ai_mode: dict[str, bool] = {}

# Per-session RTC presence (protected by per-session lock)
_rtc_presence: dict[str, set[str]] = {}
_rtc_locks: dict[str, asyncio.Lock] = {}

RTC_MAX_PARTICIPANTS = 10
ANSWER_MATCH_THRESHOLD = 0.6
FALLBACK_GEN_THRESHOLD = 0.5
RTC_PROVIDER_URL = os.getenv("RTC_PROVIDER_URL", "").strip()
RTC_API_KEY = os.getenv("RTC_API_KEY", "").strip()
RTC_API_SECRET = os.getenv("RTC_API_SECRET", "").strip()

# Allowed frontend origins — controlled via FRONTEND_URL env var on Render
_base_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
]
_prod_url = os.getenv("FRONTEND_URL", "").strip()
if _prod_url:
    _base_origins.append(_prod_url)

ALLOWED_ORIGINS = _base_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,  # Must be False when not using specific credentials
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_rtc_lock(session_id: str) -> asyncio.Lock:
    if session_id not in _rtc_locks:
        _rtc_locks[session_id] = asyncio.Lock()
    return _rtc_locks[session_id]


async def _safe_task(coro, description: str = "background task"):
    """Wrap a coroutine so errors are logged, never silently swallowed."""
    try:
        await coro
    except Exception as e:
        logger.error(f"[{description}] failed: {e}", exc_info=True)


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

    questions = list(session.get("questions", []))
    if not questions:
        return {"resolved_by_ai": 0, "duplicates_removed": 0, "kept": 0}

    meta = sm.get_session_metadata(session_id)
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
                    meta.get("host_name"),
                    meta.get("meeting_topic"),
                )
                if not answer_text:
                    raw = (context_answer.get("answer", "") or "").strip()
                    answer_text = raw.split(".")[0].strip() if raw else None

            if not answer_text:
                answer_text = await asyncio.to_thread(
                    cm.generate_answer_from_draft,
                    session_id,
                    q_text,
                    None,
                    meta.get("host_name"),
                    meta.get("meeting_topic"),
                )

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


# ── Exception Handlers ─────────────────────────────────────────────────────────

@app.exception_handler(ServerSelectionTimeoutError)
async def mongo_timeout_handler(request, exc):
    return JSONResponse(
        status_code=503,
        content={"detail": "Database temporarily unavailable. Is MongoDB running? See MONGO_URI in backend/.env"},
    )


# ─────────────────────────────────────────────
# SESSION ROUTES
# ─────────────────────────────────────────────

@app.post("/session/{session_id}/start")
async def start_session(session_id: str, role: str = "audience"):
    """
    Start/join a meeting session.
    - host: reset session to clean state
    - audience: join without wiping state
    """
    if role == "host":
        result = sm.reset_session(session_id)  # Contains host_token
        _ai_mode[session_id] = True
        async with _get_rtc_lock(session_id):
            _rtc_presence[session_id] = set()
        cm.clear_context(session_id)
    else:
        result = sm.create_session(session_id)
        _ai_mode.setdefault(session_id, True)
        _rtc_presence.setdefault(session_id, set())

    asyncio.create_task(_safe_task(db.save_session(session_id), "save_session"))
    # host_token is included in result for host role — client must store it securely
    return result


@app.get("/sessions")
async def list_sessions():
    """List all sessions — pulls from MongoDB for persistence across restarts."""
    return await db.get_all_sessions_from_db()


@app.post("/session/{session_id}/metadata")
async def set_session_metadata(session_id: str, body: SessionMetadataRequest):
    """
    Set the host name and meeting topic for this session.
    These are used by the AI to answer meta-questions like
    'who is the host?' and 'what is this meeting about?'.
    """
    if not sm.get_session(session_id):
        sm.create_session(session_id)

    result = sm.set_session_metadata(session_id, body.host_name, body.meeting_topic)

    # Also inject metadata into the context manager so it surfaces in AI answers
    meta_text_parts = []
    if body.host_name:
        meta_text_parts.append(f"Host: {body.host_name}")
    if body.meeting_topic:
        meta_text_parts.append(f"Meeting topic: {body.meeting_topic}")
    if meta_text_parts:
        meta_snippet = ". ".join(meta_text_parts) + "."
        existing_ctx = cm.has_context(session_id)
        if existing_ctx:
            # Prepend meta info to existing context
            ctx = cm._contexts.get(session_id)
            if ctx:
                ctx["full_text"] = meta_snippet + "\n" + ctx.get("full_text", "")
        else:
            await asyncio.to_thread(cm.load_text_context, session_id, meta_snippet)

    return result


@app.get("/session/{session_id}/metadata")
async def get_session_metadata(session_id: str):
    """Get the host name and meeting topic for a session."""
    return sm.get_session_metadata(session_id)


@app.post("/session/{session_id}/rtc-token", response_model=RtcTokenResponse)
async def issue_rtc_token(session_id: str, body: RtcTokenRequest):
    """Issue short-lived managed WebRTC token for a room join."""
    role = (body.role or "").strip().lower()
    if role not in ("host", "audience"):
        return JSONResponse(status_code=400, content={"detail": "Invalid role. Use 'host' or 'audience'."})

    if not sm.get_session(session_id):
        sm.create_session(session_id)

    identity = _build_rtc_identity(session_id, role, body.user_id)

    async with _get_rtc_lock(session_id):
        present = _rtc_presence.setdefault(session_id, set())
        if identity not in present and len(present) >= RTC_MAX_PARTICIPANTS:
            return JSONResponse(
                status_code=429,
                content={"detail": f"Room participant limit reached ({RTC_MAX_PARTICIPANTS})."},
            )

        try:
            token = _issue_livekit_token(session_id, identity, role)
        except RuntimeError as exc:
            return JSONResponse(status_code=503, content={"detail": str(exc)})

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
    """Best-effort presence tracking for capacity guarding and diagnostics."""
    async with _get_rtc_lock(session_id):
        present = _rtc_presence.setdefault(session_id, set())
        if state == "leave":
            present.discard(identity)
        else:
            present.add(identity)
    return {"session_id": session_id, "participants": len(_rtc_presence.get(session_id, set()))}


# ─────────────────────────────────────────────
# QUESTION ROUTES
# ─────────────────────────────────────────────

@app.post("/session/{session_id}/question", response_model=QuestionResponse)
async def submit_question(session_id: str, body: QuestionRequest):
    """
    Submit a question from an attendee.

    Pipeline (in order):
      1. AI context check first — if meeting context exists and the AI can answer,
         return an AI answer immediately. Question is NOT saved to host inbox.
      2. Semantic duplicate check — if the question is similar to one already in
         the inbox, tell the attendee to wait. Question is NOT saved again.
      3. Unique question — save to host inbox, broadcast via WebSocket, persist to DB.
    """
    user_status = rw.get_status(body.user_id)
    total_points = user_status["points"]
    ai_enabled = _ai_mode.get(session_id, True)
    meta = sm.get_session_metadata(session_id)

    AI_ANSWER_SUFFIX = "\n\n— Answered by AI"

    # ── STEP 1: Try to answer from AI context FIRST ────────────────────────────
    if ai_enabled and cm.has_context(session_id):
        score = 0.0
        answer_text = None

        context_answer = cm.find_answer_in_context(session_id, body.text, threshold=ANSWER_MATCH_THRESHOLD)
        score = context_answer.get("score", 0.0) if context_answer else 0.0

        if context_answer and context_answer.get("found"):
            answer_text = await asyncio.to_thread(
                cm.generate_answer_from_draft,
                session_id,
                body.text,
                context_answer.get("answer", ""),
                meta.get("host_name"),
                meta.get("meeting_topic"),
            )
            if not answer_text:
                raw = (context_answer.get("answer", "") or "").strip()
                answer_text = raw.split(".")[0].strip() if raw else None

        if not answer_text and score >= FALLBACK_GEN_THRESHOLD:
            answer_text = await asyncio.to_thread(
                cm.generate_answer_from_draft,
                session_id,
                body.text,
                None,
                meta.get("host_name"),
                meta.get("meeting_topic"),
            )

        if answer_text:
            # AI answered — do NOT add to host inbox at all
            return QuestionResponse(
                status="context_answered",
                message=answer_text + AI_ANSWER_SUFFIX,
                points_earned=0,
                total_points=total_points,
                similarity_score=score or None,
            )

    # ── STEP 2 & 3: Duplicate check then accept unique into host inbox ─────────
    result = await sm.process_question(
        session_id,
        body.user_id,
        body.text,
        ai_enabled,
    )

    # Duplicate — return early, nothing goes to host inbox
    if result["status"] != "unique":
        return QuestionResponse(
            status=result["status"],
            message=result["message"],
            points_earned=0,
            total_points=total_points,
            similarity_score=result.get("similarity_score"),
        )

    # Unique question — broadcast to host and persist
    question_doc = {
        "id": result["question_id"],
        "user_id": body.user_id,
        "text": body.text,
        "timestamp": datetime.utcnow().isoformat(),
        "priority": "normal",
        "starred": False,
    }

    await ws_manager.broadcast(
        session_id,
        {
            "type": "new_question",
            "questions": sm.get_questions(session_id),
        },
    )
    asyncio.create_task(_safe_task(db.save_question(session_id, question_doc), "save_question"))

    return QuestionResponse(
        status="unique",
        message=result["message"],
        points_earned=0,
        total_points=total_points,
        similarity_score=result.get("similarity_score"),
    )


@app.post("/session/{session_id}/star")
async def star_question_endpoint(session_id: str, body: StarQuestionRequest):
    """
    Host action: Star a question.
    Requires the host_token issued at session start — attendees cannot call this.
    Awards Spark Points to the attendee who asked it.
    """
    # Validate host token — reject anyone without it
    if not validate_host_token(session_id, body.host_token):
        return JSONResponse(
            status_code=403,
            content={"detail": "Forbidden: only the host can star questions."},
        )

    starred_q = sm.star_question(session_id, body.question_id)
    if not starred_q:
        return {"success": False, "message": "Question not found or already starred"}

    updated_rewards = rw.earn_points(starred_q["user_id"])

    # Persist both starred question and updated points
    asyncio.create_task(_safe_task(db.save_question(session_id, starred_q), "save_starred_question"))
    asyncio.create_task(
        _safe_task(
            db.save_user_rewards(starred_q["user_id"], updated_rewards["points"]),
            "save_user_rewards",
        )
    )

    ai_enabled = _ai_mode.get(session_id, True)
    await ws_manager.broadcast(
        session_id,
        {
            "type": "star",
            "questions": sm.get_questions(session_id) if ai_enabled else sm.get_questions(session_id),
            "leaderboard": rw.get_leaderboard(sm.get_participants(session_id)),
            "user_id": starred_q["user_id"],
            "new_total": updated_rewards["points"],
        },
    )

    return {
        "success": True,
        "message": "Question starred and points awarded!",
        "user_id": starred_q["user_id"],
        "new_total": updated_rewards["points"],
    }


@app.get("/session/{session_id}/questions")
async def get_questions(session_id: str):
    """
    Get all unique, curated questions for a session.
    Priority questions (Pro/Enterprise users) appear first.
    """
    return sm.get_questions(session_id)


# ─────────────────────────────────────────────
# REWARDS ROUTES
# ─────────────────────────────────────────────

@app.get("/rewards/{user_id}")
async def get_rewards(user_id: str):
    """Get a user's Spark Points balance."""
    # Try to load from DB first so we have the latest persisted value
    db_record = await db.get_user_rewards(user_id)
    if db_record:
        rw.load_from_db(user_id, db_record.get("points", 0))
    return rw.get_status(user_id)


# ─────────────────────────────────────────────
# USER PROFILE ROUTES
# ─────────────────────────────────────────────



@app.post("/user/profile")
async def upsert_user_profile(body: UserProfileRequest):
    """
    Called after Firebase login — saves (or updates) the user's profile in MongoDB.
    Idempotent: safe to call on every login.
    """
    asyncio.create_task(
        _safe_task(
            db.save_user_profile(body.uid, body.name, body.email, body.photo_url),
            "save_user_profile",
        )
    )
    return {"success": True}


@app.get("/user/profile/{uid}")
async def get_user_profile(uid: str):
    """Fetch a user's profile and Sharp Token balance from MongoDB."""
    profile = await db.get_user_profile(uid)
    rewards = await db.get_user_rewards(uid)
    return {
        "uid": uid,
        "name": profile.get("name", "") if profile else "",
        "email": profile.get("email", "") if profile else "",
        "photo_url": profile.get("photo_url", "") if profile else "",
        "points": rewards.get("points", 0) if rewards else 0,
    }



@app.get("/session/{session_id}/leaderboard")
async def get_leaderboard(session_id: str):
    """Top Spark Points earners in this session."""
    participants = sm.get_participants(session_id)
    return rw.get_leaderboard(participants)


# ─────────────────────────────────────────────
# CONTEXT / VIDEO ROUTES
# ─────────────────────────────────────────────

@app.post("/session/{session_id}/load-video")
async def load_video_context(session_id: str, video_id: str):
    """
    Fetch a YouTube transcript and store it as meeting context.
    Runs in a thread to avoid blocking the event loop during embedding computation.
    """
    return await asyncio.to_thread(cm.load_youtube_context, session_id, video_id)


@app.post("/session/{session_id}/load-text")
async def load_text_context_route(session_id: str, text: str):
    """
    Store a manually typed agenda as meeting context.
    Runs in a thread to avoid blocking the event loop.
    """
    return await asyncio.to_thread(cm.load_text_context, session_id, text)


@app.get("/session/{session_id}/context-status")
async def get_context_status(session_id: str):
    """Check if a session has context loaded."""
    return {"has_context": cm.has_context(session_id)}


@app.post("/session/{session_id}/multimodal-context")
async def ingest_multimodal_context_route(session_id: str, body: MultimodalContextRequest):
    """Ingest live multimodal meeting context (audio transcript + video frame)."""
    return await asyncio.to_thread(
        cm.ingest_multimodal_context,
        session_id,
        body.transcript,
        body.frame_data_url,
        body.frame_rate,
    )


@app.get("/session/{session_id}/frame-rate")
async def get_frame_rate(session_id: str):
    """Real-time frame-rate telemetry for the active meeting camera stream."""
    return cm.get_frame_rate_stats(session_id)


@app.get("/session/{session_id}/debug")
async def debug_session(session_id: str):
    """Diagnostic: current AI state, context, and question count for troubleshooting."""
    questions = sm.get_questions(session_id)
    meta = sm.get_session_metadata(session_id)
    return {
        "session_id": session_id,
        "ai_enabled": _ai_mode.get(session_id, True),
        "has_context": cm.has_context(session_id),
        "question_count": len(questions),
        "context_chunk_count": len(cm._contexts.get(session_id, {}).get("chunks", [])),
        "frame_rate": cm.get_frame_rate_stats(session_id),
        "rtc_participants": len(_rtc_presence.get(session_id, set())),
        "host_name": meta.get("host_name"),
        "meeting_topic": meta.get("meeting_topic"),
    }


@app.post("/session/{session_id}/ai-mode")
async def set_ai_mode(session_id: str, body: AIModeRequest):
    """
    Toggle the AI Organizer for a session.
    When enabled=True, reprocesses existing inbox to apply AI filtering.
    """
    _ai_mode[session_id] = body.enabled
    stats = {}
    if body.enabled:
        stats = await _reprocess_existing_inbox_with_ai(session_id)
    return {"session_id": session_id, "ai_enabled": body.enabled, "reprocess": stats}


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
      - type: "ai_resolution" with their user_id → AI answered their question
    """
    await ws_manager.connect(session_id, websocket)
    try:
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
