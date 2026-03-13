"""
Duplicate Detector (Gemini + FAISS pipeline)
--------------------------------------------
1. Uses sentence-transformers to convert questions into semantic vectors (embeddings).
2. Uses FAISS for lightning-fast cosine similarity search — index is built ONCE per session
   and updated incrementally (add-only). Never rebuilt per call.
3. Uses Gemini LLM as the ultimate judge for contextual duplicate detection.

Fixes applied:
  - Added is_duplicate_with_index_async() that accepts an existing FAISS index
    so session_manager no longer rebuilds the index on every call.
  - Kept original is_duplicate / is_duplicate_async for backward compatibility
    during any reprocessing passes.
"""

import os
import asyncio
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
from google import genai
from dotenv import load_dotenv

# Load .env from backend dir so GEMINI_API_KEY is found when run from project root
_load_env = load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
if not _load_env:
    load_dotenv()  # fallback to cwd

# Initialize Sentence Transformer model (loaded once at module import)
_model = SentenceTransformer("all-MiniLM-L6-v2")
EMBEDDING_DIM = 384


def cosine_similarity(vec1: list | np.ndarray, vec2: list | np.ndarray) -> float:
    """
    Lightweight cosine similarity helper shared by duplicate + context search.
    Accepts Python lists or numpy arrays and returns a float in [-1, 1].
    """
    a = np.asarray(vec1, dtype=np.float32)
    b = np.asarray(vec2, dtype=np.float32)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)


# Initialize Gemini with GEMINI_API_KEY from .env
try:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    gemini_client = genai.Client(api_key=api_key) if api_key else None
    if not gemini_client:
        print("Warning: No GEMINI_API_KEY or GOOGLE_API_KEY in .env")
except Exception as e:
    print(f"Warning: Gemini client failed: {e}")
    gemini_client = None


FAISS_THRESHOLD = 0.70     # Minimum similarity for FAISS recall
FALLBACK_THRESHOLD = 0.72  # Without Gemini: treat as duplicate above this score


def get_embedding(text: str) -> list:
    """Convert a question string into a numerical vector (embedding)."""
    return _model.encode(text).tolist()


def get_embeddings_batch(texts: list[str]) -> list[list]:
    """Batch-encode multiple texts in one SentenceTransformer pass (much faster than one-by-one)."""
    return _model.encode(texts).tolist()


async def get_embedding_async(text: str) -> list:
    """Async wrapper for get_embedding to avoid blocking the event loop."""
    return await asyncio.to_thread(get_embedding, text)


# ---------------------------------------------------------------------------
# PRIMARY PATH: accepts a pre-built, persistent FAISS index (no rebuild cost)
# ---------------------------------------------------------------------------

async def is_duplicate_with_index_async(
    new_question: str,
    new_embedding: list,
    existing_questions: list[dict],
    faiss_index: faiss.IndexFlatIP,
) -> tuple[bool, float]:
    """
    Check if a new question is semantically similar to any existing question
    using a pre-built persistent FAISS index (O(log N) search, no rebuild).

    Args:
        new_question:      The text of the incoming question.
        new_embedding:     Pre-computed embedding for new_question.
        existing_questions: List of question dicts in the session (for Gemini text lookup).
        faiss_index:       The session's persistent FAISS index (already contains all prior embeddings).

    Returns:
        (is_duplicate: bool, best_similarity_score: float)
    """
    if faiss_index.ntotal == 0:
        return False, 0.0

    def _search() -> tuple[float, int]:
        query_vector = np.array([new_embedding], dtype=np.float32)
        faiss.normalize_L2(query_vector)
        scores, indices = faiss_index.search(query_vector, 1)
        return float(scores[0][0]), int(indices[0][0])

    best_score, best_idx = await asyncio.to_thread(_search)

    if best_score < FAISS_THRESHOLD:
        return False, round(best_score, 4)

    if best_idx >= len(existing_questions):
        # Index out of sync — treat as non-duplicate to be safe
        return False, round(best_score, 4)

    best_match_text = existing_questions[best_idx]["text"]

    # Gemini validation
    if not gemini_client or not os.environ.get("GEMINI_API_KEY"):
        return best_score >= FALLBACK_THRESHOLD, round(best_score, 4)

    return await _gemini_judge(new_question, best_match_text, best_score)


# ---------------------------------------------------------------------------
# SECONDARY PATH: builds a temporary index from a list of embeddings
# (used by _reprocess_existing_inbox_with_ai in main.py)
# ---------------------------------------------------------------------------

async def is_duplicate_async(
    new_question: str,
    existing_questions: list[dict],
    existing_embeddings: list[list],
) -> tuple[bool, float]:
    """
    Async duplicate check that builds a temporary FAISS index from the provided embeddings.
    Use is_duplicate_with_index_async for the hot path — this is for batch reprocessing.
    """
    if not existing_embeddings:
        return False, 0.0

    async def _faiss_best_match() -> tuple[float, int]:
        def _run() -> tuple[float, int]:
            index = faiss.IndexFlatIP(EMBEDDING_DIM)
            db_vectors = np.array(existing_embeddings, dtype=np.float32)
            faiss.normalize_L2(db_vectors)
            index.add(db_vectors)

            query_vector = np.array([get_embedding(new_question)], dtype=np.float32)
            faiss.normalize_L2(query_vector)

            scores, indices = index.search(query_vector, 1)
            return float(scores[0][0]), int(indices[0][0])

        return await asyncio.to_thread(_run)

    best_score, best_idx = await _faiss_best_match()

    if best_score < FAISS_THRESHOLD:
        return False, round(best_score, 4)

    best_match_text = existing_questions[best_idx]["text"]

    if not gemini_client or not os.environ.get("GEMINI_API_KEY"):
        return best_score >= FALLBACK_THRESHOLD, round(best_score, 4)

    return await _gemini_judge(new_question, best_match_text, best_score)


async def _gemini_judge(question_a: str, question_b: str, faiss_score: float) -> tuple[bool, float]:
    """Shared Gemini LLM judge — called after FAISS pre-filter."""
    prompt = f"""You are an intelligent meeting assistant.
Are the following two questions asking the exact same fundamental concept, intent, or information in the context of a meeting?
Respond with EXACTLY the word "YES" if they are duplicates, or "NO" if they are distinct questions.

Question 1: {question_a}
Question 2: {question_b}"""

    try:
        aio_client = getattr(gemini_client, "aio", None)
        if aio_client is not None:
            response = await aio_client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
            )
        else:
            response = await asyncio.to_thread(
                gemini_client.models.generate_content,
                model="gemini-2.5-flash",
                contents=prompt,
            )

        is_dup = "YES" in (response.text or "").strip().upper()
        return is_dup, round(faiss_score, 4)
    except Exception as e:
        print(f"Gemini API error: {e}")
        return faiss_score >= FALLBACK_THRESHOLD, round(faiss_score, 4)
