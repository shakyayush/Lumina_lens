# Lumina_lens

Lumina Lens is a real-time AI meeting Q&A assistant with:

- Audience chat to submit questions
- Host dashboard for curated questions + starring
- Duplicate detection using embeddings + FAISS + Gemini (optional)
- Meeting context ingestion (host agenda) for context-aware answers
- WebSockets for real-time sync and MongoDB persistence

## Quick start

### Backend

```powershell
cd d:\practiceproj
.\backend\.venv\Scripts\python.exe backend\run.py
```

### Frontend

```powershell
cd d:\practiceproj\frontend
npm run dev -- --host 0.0.0.0 --port 5173
```

Open:
- `http://localhost:5173` on the host laptop
- `http://<your-laptop-ip>:5173` on other devices (same Wi‑Fi)

## Environment variables

Create `backend/.env` (not committed) using `backend/.env.example` as reference.

