## Project Context: Lumina Lens

Lumina Lens is a real-time AI meeting Q&A assistant. It powers a fake “Zoom-style” webinar where:
- **Audience users** submit questions in a chat.
- **Hosts** see a cleaned, curated list of unique questions in a dashboard.
- **AI** filters duplicates, auto-answers from meeting context, and powers gamified rewards (“Spark Points” and a leaderboard).

### High-Level Architecture

- **Backend (`backend/`)**: FastAPI server handling sessions, questions, WebSocket updates, duplicate detection, and context-aware answering.
  - Integrates with **MongoDB** for persistent storage of questions, users, and sessions (see `database.py`).
  - Uses **Sentence Transformers + FAISS + Gemini** to detect duplicate questions (see `duplicate_detector.py`).
  - Manages **meeting context** (YouTube transcript or host-provided text) for semantic search and auto-answers (see `context_manager.py`).
- **Frontend (`frontend/`)**: Vite/React (or similar) SPA (Single Page Application) with:
  - **Host view**: start/end session, see curated questions, star questions, and view leaderboard.
  - **Audience view**: join as attendee, submit questions, see AI answers or duplicate warnings, and track Spark Points.
- **Real-time layer**: WebSockets keep audience chat and host dashboard in sync.

### Key Backend Components

- **`backend/database.py`**
  - Connects to MongoDB (`MONGO_URI`) using `motor` async client.
  - Collections:
    - `questions`: unique questions per session.
    - `users`: Spark Points balance + tier for each user.
    - `sessions`: session metadata (e.g., created time).
  - Core functions:
    - `connect_db` / `close_db`: lifecycle connection management.
    - `save_question`, `get_questions_from_db`: persist and fetch questions.
    - `save_user_rewards`, `get_user_rewards`: manage Spark Points and tiers.
    - `save_session`, `get_all_sessions_from_db`: track sessions.

- **`backend/duplicate_detector.py`**
  - Loads a Sentence Transformer model (`all-MiniLM-L6-v2`) to embed questions into 384‑dim vectors.
  - Builds a **FAISS** index (inner product, normalized to act as cosine similarity) over existing question embeddings.
  - `is_duplicate(new_question, existing_questions, existing_embeddings)`:
    - Quickly finds the most similar existing question via FAISS.
    - If the similarity is below `FAISS_THRESHOLD`, treats it as new.
    - If above threshold and a `GEMINI_API_KEY` is configured, calls Gemini (`gemini-2.5-flash`) to decide if the questions are truly duplicates.
    - Falls back to a stricter numeric threshold if Gemini is unavailable.

- **`backend/context_manager.py`**
  - Maintains in-memory meeting context per session (`_contexts`), built from either:
    - **YouTube transcripts** (`load_youtube_context`), or
    - **Host-provided text** (`load_text_context`).
  - Splits context into chunks (~3 sentences) and embeds each chunk with the same embedding model as the duplicate detector.
  - `find_answer_in_context(session_id, question, threshold=0.55)`:
    - Finds the most similar context chunk via cosine similarity.
    - If similarity exceeds the threshold, returns a candidate answer for an AI auto-response instead of bothering the host.
  - `has_context(session_id)` is a convenience check to see if context has been loaded.

### Data & Behavior Flow (End-to-End)

1. **Host starts a session**
   - Frontend calls a backend endpoint like `POST /session/<session-id>/start`.
   - Backend initializes session records (MongoDB) and any real-time channels (WebSockets).

2. **Context loading (optional but powerful)**
   - Host can either:
     - Provide a YouTube video ID → `load_youtube_context` pulls and indexes transcript.
     - Paste meeting agenda/notes → `load_text_context` indexes the text.
   - Result: `_contexts[session_id]` stores text chunks and their embeddings for later semantic search.

3. **Audience submits a question**
   - Frontend Audience view sends the question to the backend.
   - Backend pipeline:
     1. **Context search**: `find_answer_in_context` checks if the question is already answered in the loaded transcript/agenda.
        - If a strong match is found → return an AI answer bubble directly to the audience.
     2. **Duplicate detection**: `is_duplicate` compares the question against stored questions for this session.
        - If considered duplicate → audience chat shows a duplicate message; host dashboard does not get a new card.
     3. **Unique question**:
        - Saved to MongoDB via `save_question`.
        - Broadcast to host dashboard via WebSockets.
        - Spark Points are awarded to the asking user and saved via `save_user_rewards`.

4. **Host interaction & gamification**
   - Host can **star** questions to highlight them and to award additional Spark Points.
   - Leaderboard is computed from `users` documents in MongoDB and shown on the host dashboard.

### Files & Configuration You’ll Commonly Touch

- **Root**
  - `README.md`: Quick start commands for backend and frontend.
  - `DEMO_SCRIPT.md`: Step‑by‑step “golden path” for live demos (who does what, in which order).
  - `contextreadme.md` (this file): Architectural and flow overview.

- **Backend (`backend/`)**
  - `run.py` (referenced in docs): FastAPI entrypoint (starts server on port 8000).
  - `database.py`: MongoDB connection and data access helpers.
  - `duplicate_detector.py`: Embedding + FAISS + Gemini duplicate detection.
  - `context_manager.py`: Meeting context loading and semantic answer lookup.
  - `.env` & `.env.example`: Environment variables, including at least:
    - `GEMINI_API_KEY` for Gemini duplicate validation.
    - `MONGO_URI` for MongoDB Atlas or local Mongo.

- **Frontend (`frontend/`)**
  - Vite dev server started with `npm run dev -- --host 0.0.0.0 --port 5173`.
  - Provides:
    - **Landing / lobby** screen with Lumina Lens branding.
    - **Join as Host** / **Join as Audience** entry points.
    - Host dashboard (curated questions, star, leaderboard).
    - Audience chat (question input, AI answers, duplicate messages, Spark meter).

### How to Run (From Scratch)

- **Backend**
  - Create and activate a virtualenv in `backend/`, install `requirements.txt`.
  - Configure `.env` based on `.env.example` (set at least `GEMINI_API_KEY` and `MONGO_URI`).
  - Start the server, for example:
    - `.\backend\.venv\Scripts\python.exe backend\run.py` (from project root in PowerShell).

- **Frontend**
  - From `frontend/`, run:
    - `npm install` (first time only).
    - `npm run dev -- --host 0.0.0.0 --port 5173`.
  - Open:
    - `http://localhost:5173` on the host laptop.
    - `http://<your-laptop-ip>:5173` on other devices on the same network.

This file is meant as a **conceptual map** of the project so you can quickly recall what lives where and how data flows between audience, host, backend logic, and MongoDB.
