"""
Duplicate Detector (Gemini + FAISS pipeline)
--------------------------------------------
1. Uses sentence-transformers to convert questions into semantic vectors (embeddings).
2. Uses FAISS for lightning-fast cosine similarity search.
3. Uses Gemini LLM as the ultimate judge for contextual duplicate detection.
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

# Initialize Sentence Transformer
_model = SentenceTransformer("all-MiniLM-L6-v2")
EMBEDDING_DIM = 384


def cosine_similarity(vec1: list | np.ndarray, vec2: list | np.ndarray) -> float:
    """
    Lightweight cosine similarity helper shared by duplicate + context search.
    Accepts Python lists or numpy arrays and returns a float in [-1, 1].
    """
    a = np.asarray(vec1, dtype=np.float32)
    b = np.asarray(vec2, dtype=np.float32)
    denom = (np.linalg.norm(a) * np.linalg.norm(b))
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


FAISS_THRESHOLD = 0.70  # Lower threshold for initial recall
FALLBACK_THRESHOLD = 0.72  # Without Gemini: treat as duplicate if similarity >= this (catches "deadline" vs "due date")


def get_embedding(text: str) -> list:
    """Convert a question string into a numerical vector (embedding)."""
    return _model.encode(text).tolist()


async def get_embedding_async(text: str) -> list:
    """Async wrapper for get_embedding to avoid blocking the event loop."""
    return await asyncio.to_thread(get_embedding, text)

def is_duplicate(
    new_question: str,
    existing_questions: list[dict],
    existing_embeddings: list[list],
) -> tuple[bool, float]:
    """
    Check if a new question is semantically similar to any existing question
    using FAISS for fast retrieval and Gemini for intelligence.
    """
    if not existing_embeddings:
        return False, 0.0

    # 1. FAISS Vector Search
    index = faiss.IndexFlatIP(EMBEDDING_DIM) 
    
    # Needs to be float32 for FAISS
    db_vectors = np.array(existing_embeddings, dtype=np.float32)
    faiss.normalize_L2(db_vectors)
    index.add(db_vectors)

    query_vector = np.array([get_embedding(new_question)], dtype=np.float32)
    faiss.normalize_L2(query_vector)

    scores, indices = index.search(query_vector, 1)
    best_score = float(scores[0][0])
    best_idx = int(indices[0][0])

    if best_score < FAISS_THRESHOLD:
        return False, round(best_score, 4)

    best_match_text = existing_questions[best_idx]["text"]

    # 2. Gemini Validation
    if not gemini_client:
        return best_score >= FALLBACK_THRESHOLD, round(best_score, 4)

    prompt = f"""You are an intelligent meeting assistant. 
Are the following two questions asking the exact same fundamental concept, intent, or information in the context of a meeting? 
Respond with EXACTLY the word "YES" if they are duplicates, or "NO" if they are distinct questions.

Question 1: {new_question}
Question 2: {best_match_text}"""

    try:
        response = gemini_client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )
        is_dup = "YES" in response.text.strip().upper()
        return is_dup, round(best_score, 4)
    except Exception as e:
        print(f"Gemini API error: {e}")
        return best_score >= FALLBACK_THRESHOLD, round(best_score, 4)


async def is_duplicate_async(
    new_question: str,
    existing_questions: list[dict],
    existing_embeddings: list[list],
) -> tuple[bool, float]:
    """
    Async version of is_duplicate.

    - Keeps the FastAPI event loop responsive by:
      - running the CPU-bound FAISS search in a worker thread
      - awaiting Gemini via the async client when available
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

    # If Gemini isn't configured, fall back to strict similarity.
    if not gemini_client or not os.environ.get("GEMINI_API_KEY"):
        return best_score >= FALLBACK_THRESHOLD, round(best_score, 4)

    prompt = f"""You are an intelligent meeting assistant. 
Are the following two questions asking the exact same fundamental concept, intent, or information in the context of a meeting? 
Respond with EXACTLY the word "YES" if they are duplicates, or "NO" if they are distinct questions.

Question 1: {new_question}
Question 2: {best_match_text}"""

    # Prefer the SDK's async client if present. If not, avoid blocking by running
    # the sync call in a worker thread.
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
        return is_dup, round(best_score, 4)
    except Exception as e:
        print(f"Gemini API error: {e}")
        return best_score >= FALLBACK_THRESHOLD, round(best_score, 4)
