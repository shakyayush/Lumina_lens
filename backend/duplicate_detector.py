"""
Duplicate Detector (Gemini + FAISS pipeline)
--------------------------------------------
1. Uses sentence-transformers to convert questions into semantic vectors (embeddings).
2. Uses FAISS for lightning-fast cosine similarity search.
3. Uses Gemini LLM as the ultimate judge for contextual duplicate detection.
"""

import os

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer
from google import genai
from dotenv import load_dotenv


load_dotenv()

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


# Initialize Gemini
try:
    gemini_client = genai.Client()
except Exception as e:
    print(f"Warning: Gemini client initialized without API key: {e}")
    gemini_client = None


FAISS_THRESHOLD = 0.70  # Lower threshold for initial recall
FALLBACK_THRESHOLD = 0.85  # Strict threshold if Gemini fails


def get_embedding(text: str) -> list:
    """Convert a question string into a numerical vector (embedding)."""
    return _model.encode(text).tolist()

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
    if not gemini_client or not os.environ.get("GEMINI_API_KEY"):
        # Fallback to strict math if no API key is provided yet
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
