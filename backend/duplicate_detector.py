"""
Duplicate Detector (Gemini Embeddings + NumPy pipeline)
--------------------------------------------------------
1. Uses Gemini text-embedding-004 API to convert questions into semantic vectors.
   - No local ML model download at startup (removes sentence-transformers + PyTorch)
   - ~50MB install instead of ~1.2GB — works on any free-tier hosting
2. Uses numpy cosine similarity for fast in-memory search.
   - Works perfectly for typical meeting sizes (<1000 questions per session)
3. Uses Gemini LLM as the final judge for borderline cases.
"""

import os
import asyncio
import numpy as np
from google import genai
from dotenv import load_dotenv

# Load .env from backend dir
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if not load_dotenv(_env_path):
    load_dotenv()

EMBEDDING_DIM = 768  # Gemini text-embedding-004 output dimension

# Initialize Gemini client (shared for both embedding and LLM calls)
try:
    _api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    gemini_client = genai.Client(api_key=_api_key) if _api_key else None
    if not gemini_client:
        print("Warning: No GEMINI_API_KEY found — duplicate detection will be disabled")
except Exception as e:
    print(f"Warning: Gemini client init failed: {e}")
    gemini_client = None

FAISS_THRESHOLD   = 0.70   # Minimum cosine similarity to even consider a duplicate
FALLBACK_THRESHOLD = 0.82  # Without Gemini LLM: treat as duplicate above this score


# ── Embedding helpers ──────────────────────────────────────────────────────────

def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two 1-D float32 vectors."""
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / denom) if denom > 0 else 0.0


def cosine_similarity(vec1, vec2) -> float:
    """Public helper used by context_manager."""
    return _cosine_similarity(
        np.asarray(vec1, dtype=np.float32),
        np.asarray(vec2, dtype=np.float32),
    )


def _get_embedding_sync(text: str) -> list:
    """Call Gemini embedding API synchronously. Returns [] on failure."""
    if not gemini_client:
        return []
    try:
        result = gemini_client.models.embed_content(
            model="text-embedding-004",
            contents=text,
        )
        return result.embeddings[0].values
    except Exception as e:
        print(f"[embedding] Gemini API error: {e}")
        return []


def get_embedding(text: str) -> list:
    """Synchronous embedding — used by context_manager batch processing."""
    return _get_embedding_sync(text)


async def get_embedding_async(text: str) -> list:
    """Async wrapper — avoids blocking the FastAPI event loop."""
    return await asyncio.to_thread(_get_embedding_sync, text)


def get_embeddings_batch(texts: list[str]) -> list[list]:
    """Batch-encode multiple texts — each as a separate embedding call."""
    return [_get_embedding_sync(t) for t in texts]


# ── Primary duplicate check (uses pre-stored embeddings list) ─────────────────

async def is_duplicate_with_index_async(
    new_question: str,
    new_embedding: list,
    existing_questions: list[dict],
    embeddings_list: list,          # replaces faiss_index — plain list of embeddings
) -> tuple[bool, float]:
    """
    Check if new_question is semantically similar to any previous question.

    Args:
        new_question:     Incoming question text.
        new_embedding:    Pre-computed embedding for new_question.
        existing_questions: List of question dicts in the session.
        embeddings_list:  Plain Python list of embedding vectors (one per question).

    Returns:
        (is_duplicate: bool, best_similarity_score: float)
    """
    if not embeddings_list or not new_embedding:
        return False, 0.0

    def _find_best() -> tuple[float, int]:
        q_vec = np.asarray(new_embedding, dtype=np.float32)
        matrix = np.asarray(embeddings_list, dtype=np.float32)

        # Batch cosine similarity via matrix multiply (fast even for 1000 rows)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        normed = matrix / norms
        q_normed = q_vec / (np.linalg.norm(q_vec) or 1.0)
        scores = normed @ q_normed
        best_idx = int(np.argmax(scores))
        return float(scores[best_idx]), best_idx

    best_score, best_idx = await asyncio.to_thread(_find_best)

    if best_score < FAISS_THRESHOLD:
        return False, round(best_score, 4)

    if best_idx >= len(existing_questions):
        return False, round(best_score, 4)

    best_match_text = existing_questions[best_idx]["text"]

    # If Gemini not available, fall back to score threshold
    if not gemini_client or not os.environ.get("GEMINI_API_KEY"):
        return best_score >= FALLBACK_THRESHOLD, round(best_score, 4)

    return await _gemini_judge(new_question, best_match_text, best_score)


# ── Secondary path: for batch reprocessing (main.py _reprocess_*) ────────────

async def is_duplicate_async(
    new_question: str,
    existing_questions: list[dict],
    existing_embeddings: list[list],
) -> tuple[bool, float]:
    """
    Duplicate check with provided embeddings list.
    Used for batch reprocessing when the AI mode changes.
    """
    return await is_duplicate_with_index_async(
        new_question,
        await get_embedding_async(new_question),
        existing_questions,
        existing_embeddings,
    )


# ── Gemini LLM judge ──────────────────────────────────────────────────────────

async def _gemini_judge(question_a: str, question_b: str, faiss_score: float) -> tuple[bool, float]:
    """LLM confirmation — only called when cosine score is in the ambiguous zone."""
    prompt = f"""You are an intelligent meeting assistant.
Are the following two questions asking the exact same fundamental concept, intent, or information in the context of a meeting?
Respond with EXACTLY the word "YES" if they are duplicates, or "NO" if they are distinct questions.

Question 1: {question_a}
Question 2: {question_b}"""

    try:
        aio = getattr(gemini_client, "aio", None)
        if aio:
            response = await aio.models.generate_content(
                model="gemini-2.0-flash",
                contents=prompt,
            )
        else:
            response = await asyncio.to_thread(
                gemini_client.models.generate_content,
                model="gemini-2.0-flash",
                contents=prompt,
            )
        is_dup = "YES" in (response.text or "").strip().upper()
        return is_dup, round(faiss_score, 4)
    except Exception as e:
        print(f"[gemini_judge] error: {e}")
        return faiss_score >= FALLBACK_THRESHOLD, round(faiss_score, 4)
