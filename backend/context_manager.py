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

from youtube_transcript_api import YouTubeTranscriptApi
from duplicate_detector import get_embedding, cosine_similarity

# In-memory: { session_id: { "text": str, "chunks": list, "embeddings": list } }
_contexts: dict = {}


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
    chunks = [s.strip() for s in sentences if len(s.strip()) > 20]
    embeddings = [get_embedding(chunk) for chunk in chunks]

    _contexts[session_id] = {
        "video_id": None,
        "full_text": text,
        "chunks": chunks,
        "embeddings": embeddings,
    }

    return {
        "status": "loaded",
        "chunks_indexed": len(chunks),
        "message": f"✅ Meeting context loaded from text ({len(chunks)} segments indexed)",
    }


def find_answer_in_context(session_id: str, question: str, threshold: float = 0.55) -> dict:
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


def has_context(session_id: str) -> bool:
    return session_id in _contexts and len(_contexts[session_id]["chunks"]) > 0
