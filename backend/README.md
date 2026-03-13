# 📁 Lumina Lens — Backend (Step 1)

## What This Folder Does

This is the **brain of Lumina Lens**. It runs as a web server on your laptop.
The Base44 frontend talks to this server to submit questions, check for duplicates, and manage Spark Rewards points.

---

## 📂 Folder Structure

```
backend/
├── main.py                ← 🚪 Entry point — starts the server, defines all API routes
├── duplicate_detector.py  ← 🧠 NLP engine — detects if a question is a repeat
├── session_manager.py     ← 📋 Session store — manages each meeting's questions
├── rewards.py             ← ⭐ Spark Rewards engine — points, tiers, redemption
├── models.py              ← 📐 Data shapes — defines what requests/responses look like
└── requirements.txt       ← 📦 Python packages needed to run the server
```

---

## 📄 File-by-File Explanation

### `main.py` — The Front Door
**Role:** This is the only file you ever run directly. It starts the FastAPI web server and connects all the other modules together.

**What it does:**
- Exposes all the API routes (URLs) that the frontend calls
- Handles incoming requests and sends back responses
- Applies CORS headers so the Base44 frontend is allowed to connect

**Key routes:**
| URL | What it does |
|-----|-------------|
| `POST /session/{id}/start` | Host starts a new meeting session |
| `POST /session/{id}/question` | Attendee submits a question |
| `GET /session/{id}/questions` | Host dashboard fetches curated questions |
| `GET /rewards/{user_id}` | Check a user's Spark Points balance |
| `POST /rewards/{user_id}/redeem` | Redeem points for a premium tier |
| `GET /session/{id}/leaderboard` | Top point earners in the session |

---

### `duplicate_detector.py` — The NLP Brain
**Role:** Figures out if a new question means the same thing as one already asked.

**How it works:**
1. Loads an AI model (`all-MiniLM-L6-v2`) — a lightweight language model trained to understand sentence meaning
2. Converts any text into a list of numbers called an **embedding** (a vector)
3. Measures the **cosine similarity** between two vectors — a score between 0.0 and 1.0
   - `1.0` = identical meaning
   - `0.0` = completely unrelated
4. If similarity ≥ **0.82**, it's a duplicate

**Example:**
```
"What is the submission deadline?"   → embedding: [0.23, 0.87, ...]
"When do we need to submit?"         → embedding: [0.21, 0.85, ...]
similarity = 0.94 → DUPLICATE ✅
```

---

### `session_manager.py` — The Meeting Room
**Role:** Manages each live meeting session. Keeps track of:
- All unique questions accepted for this session
- The embedding vectors (for future duplicate checks)
- Which users participated

**How it works:**
- Uses a Python dictionary in memory (no database needed yet)
- Each session has a unique `session_id` (e.g., `"meeting-001"`)
- When a question comes in, it asks `duplicate_detector` → if unique, it saves it

**The question limit rule:**
> Basic tier users can only submit **5 questions per session**. Pro+ users have no limit.

---

### `rewards.py` — The Spark Points Engine
**Role:** Manages Spark Rewards points — the gamification layer of the product.

**How the points work:**
| Action | Points |
|--------|--------|
| Submit a unique question | +50 pts |
| Submit a duplicate | 0 pts |

**Tiers:**
| Tier | Cost | Benefits |
|------|------|---------|
| Basic | Free | 5 questions/session, standard replies |
| Pro | 500 pts | Unlimited questions + priority highlight on host dashboard |
| Enterprise | 2000 pts | Pro + session analytics export |

**What "redeem" means:**
Points are deducted when you unlock a tier. You don't earn the tier permanently from one session — you spend your saved-up points to upgrade.

---

### `models.py` — The Data Shapes
**Role:** Defines what data looks like when it goes in and out of the API.

Think of it as a **contract** between the frontend and backend.
- `QuestionRequest` — shape of a submitted question
- `QuestionResponse` — what the server sends back after checking a question
- `RedeemRequest` / `RedeemResponse` — for tier upgrades

---

### `requirements.txt` — The Package List
**Role:** Lists all the Python libraries this project needs.

| Package | What it does |
|---------|-------------|
| `fastapi` | The web framework — handles routing, requests, responses |
| `uvicorn` | The server that actually runs FastAPI |
| `sentence-transformers` | Loads the AI model for converting text to embeddings |
| `numpy` | Math library used for cosine similarity calculation |
| `pydantic` | Data validation — enforces the shapes defined in models.py |

---

## 🚀 How to Run

```bash
# Step 1 — Install dependencies (one-time setup)
cd d:/practiceproj/backend
pip install -r requirements.txt

# Step 2 — Start the server
uvicorn main:app --reload --port 8000
```

Once running:
- **Swagger UI (interactive API tester):** http://localhost:8000/docs
- **Health check:** http://localhost:8000

---

## 🔄 How It All Connects

```
[Base44 Frontend]
      │
      │  HTTP requests (JSON)
      ▼
[main.py — FastAPI Server :8000]
      │
      ├──► session_manager.py
      │         └──► duplicate_detector.py (checks for similarity)
      │
      └──► rewards.py (awards / redeems Spark Points)
```

---

## ✅ Step 1 Status: Complete

All backend files are written and ready to run.
Next step: **MongoDB Atlas integration** (Step 2) — to persist data permanently.
