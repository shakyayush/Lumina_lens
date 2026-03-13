"""
Context Manager — Lumina Lens
-------------------------------
Stores meeting context (from YouTube transcript or host-uploaded agenda)
so the AI can answer questions intelligently from meeting content.

Flow:
  1. Host starts session and selects a video
  2. YouTube transcript is fetched automatically
  3. When attendee submits a question:
     a. Check if already answered in transcript → auto-reply with quote
     b. Check if duplicate of existing question → block
     c. If genuinely new → send to host dashboard + award Spark Points
"""

import os
import base64
from datetime import datetime
from dotenv import load_dotenv
from youtube_transcript_api import YouTubeTranscriptApi
from duplicate_detector import get_embedding, cosine_similarity

# Load .env from backend dir (duplicate_detector loads it too; ensure context_manager has it)
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

# In-memory: { session_id: { "text": str, "chunks": list, "embeddings": list } }
_contexts: dict = {}

# Optional: use Gemini to answer questions related to draft when no exact chunk matches
try:
    from google import genai
    _api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    _gemini = genai.Client(api_key=_api_key) if _api_key else None
except Exception:
    _gemini = None


def _ensure_context(session_id: str) -> dict:
    """
    Ensure a session context exists even before host uploads draft/video.
    This allows live multimodal snippets to bootstrap context incrementally.
    """
    if session_id not in _contexts:
        _contexts[session_id] = {
            "video_id": None,
            "full_text": "",
            "chunks": [],
            "embeddings": [],
            "multimodal_notes": [],
            "frame_rate_stats": {
                "last_fps": None,
                "avg_fps_30s": None,
                "min_fps_30s": None,
                "max_fps_30s": None,
                "samples_30s": 0,
                "updated_at": None,
                "history": [],
            },
        }
    elif "multimodal_notes" not in _contexts[session_id]:
        _contexts[session_id]["multimodal_notes"] = []
    elif "frame_rate_stats" not in _contexts[session_id]:
        _contexts[session_id]["frame_rate_stats"] = {
            "last_fps": None,
            "avg_fps_30s": None,
            "min_fps_30s": None,
            "max_fps_30s": None,
            "samples_30s": 0,
            "updated_at": None,
            "history": [],
        }
    return _contexts[session_id]


def _decode_data_url_image(frame_data_url: str) -> bytes | None:
    """
    Accepts data URL like:
      data:image/jpeg;base64,/9j/4AAQSk...
    and returns decoded bytes.
    """
    if not frame_data_url or ";base64," not in frame_data_url:
        return None
    try:
        encoded = frame_data_url.split(";base64,", 1)[1]
        return base64.b64decode(encoded, validate=True)
    except Exception:
        return None


def _summarize_video_frame(frame_bytes: bytes, frame_rate: float | None) -> str | None:
    """
    Use Gemini vision to extract concise contextual cues from a live frame.
    """
    if not _gemini or not frame_bytes:
        return None
    try:
        from google.genai import types

        prompt = (
            "You are analyzing a live meeting frame.\n"
            "Return one short sentence (max 14 words) that states only visible meeting context.\n"
            "No guesses, no names unless clearly visible, no extra explanation.\n"
            f"Approx video frame-rate: {round(frame_rate or 0, 2)} fps.\n"
            "If nothing meaningful is visible, return exactly: NO_VISUAL_CONTEXT"
        )
        response = _gemini.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                prompt,
                types.Part.from_bytes(data=frame_bytes, mime_type="image/jpeg"),
            ],
        )
        text = (response.text or "").strip()
        if not text or "no_visual_context" in text.lower():
            return None
        return text.splitlines()[0].strip()
    except Exception:
        return None


def _update_frame_rate_stats(ctx: dict, frame_rate: float | None):
    """
    Maintain rolling 30-second frame-rate telemetry for real-time consumers.
    """
    if frame_rate is None:
        return
    try:
        fps = float(frame_rate)
    except Exception:
        return
    if fps <= 0:
        return

    stats = ctx.get("frame_rate_stats")
    if not stats:
        stats = {
            "last_fps": None,
            "avg_fps_30s": None,
            "min_fps_30s": None,
            "max_fps_30s": None,
            "samples_30s": 0,
            "updated_at": None,
            "history": [],
        }
        ctx["frame_rate_stats"] = stats

    now = datetime.utcnow()
    history = list(stats.get("history", []))
    history.append({"t": now.timestamp(), "fps": fps})
    cutoff = now.timestamp() - 30.0
    history = [h for h in history if h.get("t", 0) >= cutoff]
    fps_values = [h["fps"] for h in history]

    stats["history"] = history
    stats["last_fps"] = round(fps, 2)
    stats["samples_30s"] = len(fps_values)
    stats["avg_fps_30s"] = round(sum(fps_values) / len(fps_values), 2) if fps_values else None
    stats["min_fps_30s"] = round(min(fps_values), 2) if fps_values else None
    stats["max_fps_30s"] = round(max(fps_values), 2) if fps_values else None
    stats["updated_at"] = now.isoformat() + "Z"


def load_youtube_context(session_id: str, video_id: str) -> dict:
    """
    Fetch the YouTube transcript for a video and store it as session context.

    Args:
        session_id: The active meeting session ID
        video_id:   YouTube video ID (e.g. 'dQw4w9WgXcQ')

    Returns:
        dict with status and number of transcript segments loaded
    """
    try:
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        full_text = " ".join([t["text"] for t in transcript])

        # Split into chunks of ~3 sentences for precise matching
        sentences = full_text.replace("?", ".").replace("!", ".").split(".")
        chunks = [s.strip() for s in sentences if len(s.strip()) > 20]

        # Embed each chunk for semantic search
        embeddings = [get_embedding(chunk) for chunk in chunks]

        _contexts[session_id] = {
            "video_id": video_id,
            "full_text": full_text,
            "chunks": chunks,
            "embeddings": embeddings,
            "multimodal_notes": [],
            "frame_rate_stats": {
                "last_fps": None,
                "avg_fps_30s": None,
                "min_fps_30s": None,
                "max_fps_30s": None,
                "samples_30s": 0,
                "updated_at": None,
                "history": [],
            },
        }

        return {
            "status": "loaded",
            "video_id": video_id,
            "chunks_indexed": len(chunks),
            "message": f"✅ Meeting context loaded from video ({len(chunks)} segments indexed)",
        }

    except Exception as e:
        return {
            "status": "error",
            "message": f"Could not load transcript: {str(e)}. Using empty context.",
        }


def load_text_context(session_id: str, text: str) -> dict:
    """
    Store a manually provided agenda or topic brief as context.
    Used when the host pastes their own meeting notes.
    """
    sentences = text.replace("?", ".").replace("!", ".").split(".")
    chunks = [s.strip() for s in sentences if len(s.strip()) > 15]
    if not chunks:
        # Short draft: use full text as single chunk so has_context works
        chunks = [text.strip()] if text.strip() else []
    embeddings = [get_embedding(chunk) for chunk in chunks]

    _contexts[session_id] = {
        "video_id": None,
        "full_text": text,
        "chunks": chunks,
        "embeddings": embeddings,
        "multimodal_notes": [],
        "frame_rate_stats": {
            "last_fps": None,
            "avg_fps_30s": None,
            "min_fps_30s": None,
            "max_fps_30s": None,
            "samples_30s": 0,
            "updated_at": None,
            "history": [],
        },
    }

    return {
        "status": "loaded",
        "chunks_indexed": len(chunks),
        "message": f"✅ Meeting context loaded from text ({len(chunks)} segments indexed)",
    }


def find_answer_in_context(session_id: str, question: str, threshold: float = 0.48) -> dict:
    """
    Check if a question is already answered in the meeting context.
    Returns the most relevant transcript chunk if found.

    Args:
        session_id: Active session
        question:   Question text from attendee
        threshold:  Minimum similarity to count as "answered" (lower = broader match)

    Returns:
        { "found": bool, "answer": str | None, "score": float }
    """
    ctx = _contexts.get(session_id)
    if not ctx or not ctx["chunks"]:
        return {"found": False, "answer": None, "score": 0.0}

    q_embedding = get_embedding(question)
    best_score = 0.0
    best_chunk = None

    for chunk, emb in zip(ctx["chunks"], ctx["embeddings"]):
        score = cosine_similarity(q_embedding, emb)
        if score > best_score:
            best_score = score
            best_chunk = chunk

    if best_score >= threshold:
        return {
            "found": True,
            "answer": best_chunk,
            "score": round(best_score, 4),
        }

    return {"found": False, "answer": None, "score": round(best_score, 4)}


def generate_answer_from_draft(session_id: str, question: str, supporting_text: str | None = None) -> str | None:
    """
    Generate a concise, question-specific answer from meeting draft/context.

    - If supporting_text is provided (best semantic chunk), prioritize it.
    - Otherwise use full draft context.
    - Keep answer short and only what is asked.
    """
    ctx = _contexts.get(session_id)
    if not ctx or not ctx.get("full_text"):
        return None
    if not _gemini:
        return None

    source = (supporting_text or "").strip() or ctx["full_text"][:8000]
    prompt = f"""You are a meeting assistant. Answer ONLY from the provided context.

Rules:
- Give a direct answer to the exact question.
- Keep it concise (max 1 short sentence, or <= 12 words when possible).
- Do NOT repeat full context or add extra details.
- If asking for a date, return only the date.
- If asking for a name, return only the name.
- If context does not contain the answer, reply exactly: NOT_COVERED

CONTEXT:
{source}

QUESTION:
{question}

ANSWER:"""
    try:
        response = _gemini.models.generate_content(model="gemini-2.5-flash", contents=prompt)
        text = (response.text or "").strip()
        if not text:
            return None
        if "not_covered" in text.lower():
            return None
        return text.splitlines()[0].strip()
    except Exception:
        return None


def ingest_multimodal_context(
    session_id: str,
    transcript: str | None = None,
    frame_data_url: str | None = None,
    frame_rate: float | None = None,
) -> dict:
    """
    Merge live audio (transcript) + video (frame snapshot) into session context.
    This makes AI context aware of ongoing meeting content, not just preloaded draft.
    """
    ctx = _ensure_context(session_id)
    _update_frame_rate_stats(ctx, frame_rate)
    snippets: list[str] = []

    clean_transcript = (transcript or "").strip()
    if clean_transcript:
        snippets.append(f"Live audio: {clean_transcript}")

    frame_bytes = _decode_data_url_image(frame_data_url or "")
    if frame_bytes:
        visual = _summarize_video_frame(frame_bytes, frame_rate)
        if visual:
            snippets.append(f"Live visual: {visual}")
        elif frame_rate:
            snippets.append(f"Live visual stream active at about {round(frame_rate, 2)} fps.")

    if not snippets:
        stats = ctx.get("frame_rate_stats", {})
        return {
            "status": "ok" if frame_rate else "ignored",
            "message": "Frame-rate telemetry updated." if frame_rate else "No usable multimodal content provided.",
            "frame_rate": {
                "last_fps": stats.get("last_fps"),
                "avg_fps_30s": stats.get("avg_fps_30s"),
                "samples_30s": stats.get("samples_30s"),
                "updated_at": stats.get("updated_at"),
            },
        }

    combined = " ".join(snippets)
    ctx["chunks"].append(combined)
    ctx["embeddings"].append(get_embedding(combined))
    ctx["multimodal_notes"].append(combined)

    # Keep memory bounded.
    max_chunks = 300
    if len(ctx["chunks"]) > max_chunks:
        overflow = len(ctx["chunks"]) - max_chunks
        ctx["chunks"] = ctx["chunks"][overflow:]
        ctx["embeddings"] = ctx["embeddings"][overflow:]
    if len(ctx["multimodal_notes"]) > 120:
        ctx["multimodal_notes"] = ctx["multimodal_notes"][-120:]

    existing = (ctx.get("full_text") or "").strip()
    ctx["full_text"] = (existing + "\n" + combined).strip() if existing else combined

    return {
        "status": "ok",
        "message": "Live multimodal context ingested.",
        "chunks_indexed": len(ctx["chunks"]),
        "multimodal_notes": len(ctx["multimodal_notes"]),
        "frame_rate": {
            "last_fps": ctx.get("frame_rate_stats", {}).get("last_fps"),
            "avg_fps_30s": ctx.get("frame_rate_stats", {}).get("avg_fps_30s"),
            "samples_30s": ctx.get("frame_rate_stats", {}).get("samples_30s"),
            "updated_at": ctx.get("frame_rate_stats", {}).get("updated_at"),
        },
    }


def get_frame_rate_stats(session_id: str) -> dict:
    ctx = _ensure_context(session_id)
    stats = ctx.get("frame_rate_stats", {})
    return {
        "last_fps": stats.get("last_fps"),
        "avg_fps_30s": stats.get("avg_fps_30s"),
        "min_fps_30s": stats.get("min_fps_30s"),
        "max_fps_30s": stats.get("max_fps_30s"),
        "samples_30s": stats.get("samples_30s", 0),
        "updated_at": stats.get("updated_at"),
    }


def has_context(session_id: str) -> bool:
    return session_id in _contexts and len(_contexts[session_id]["chunks"]) > 0


def clear_context(session_id: str):
    """Remove loaded context for a session (used when session is reset)."""
    _contexts.pop(session_id, None)
