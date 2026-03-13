# 📁 Lumina Lens — Step 2: MongoDB Atlas Integration

## What Changed in This Step

A new file `database.py` was added and `main.py` was updated to connect to **MongoDB Atlas** on startup.
Data that was previously only in memory is now **saved permanently to the cloud database**.

---

## 📄 New File: `database.py`

**Role:** The database layer — handles all reads and writes to MongoDB Atlas.

### What it stores:

| MongoDB Collection | What's in it |
|--------------------|-------------|
| `questions` | Every unique question accepted per session (text, user, timestamp, priority) |
| `users` | Each user's Spark Points balance and tier |
| `sessions` | Session metadata (ID, start time) |

### Key functions:

| Function | What it does |
|----------|-------------|
| `connect_db()` | Opens connection to MongoDB on server startup |
| `close_db()` | Closes connection on server shutdown |
| `save_question(session_id, question)` | Saves a unique question permanently |
| `get_questions_from_db(session_id)` | Fetches all questions for a session |
| `save_user_rewards(user_id, points, tier)` | Creates or updates a user's points |
| `get_user_rewards(user_id)` | Fetches a user's rewards record |
| `save_session(session_id)` | Records that a session was started |

### Why Motor (not PyMongo)?
`motor` is the **async** version of PyMongo — it works with FastAPI's async routes without blocking the server.

---

## 🔄 What Changed in `main.py`

Two key additions:

### 1. Lifespan (startup/shutdown)
```python
@asynccontextmanager
async def lifespan(app):
    await db.connect_db()   # runs when server starts
    yield
    await db.close_db()     # runs when server stops
```
This is FastAPI's recommended way to run code at server startup and shutdown.

### 2. Routes now persist to MongoDB
When a unique question is submitted, it's saved **both** in-memory (for speed) and in MongoDB (for persistence).
If the server restarts, data isn't lost.

---

## ⚙️ Setup: MongoDB Atlas (5 minutes)

1. Go to **[mongodb.com/atlas](https://mongodb.com/atlas)** → Sign up free
2. Create a **free M0 cluster** (no credit card needed)
3. Click **"Connect"** → **"Drivers"** → copy the connection string
4. It looks like:
   ```
   mongodb+srv://youruser:yourpassword@cluster0.xxxxx.mongodb.net/
   ```
5. Set it as an environment variable (recommended):
   ```bash
   # Windows PowerShell
   $env:MONGO_URI = "mongodb+srv://youruser:yourpass@cluster.mongodb.net/"
   ```
   OR just paste it directly in `database.py` (line 29) for the hackathon.

6. In Atlas → **Network Access** → Add your current IP address (or `0.0.0.0/0` for open access during demo)

---

## 🚀 Run the Server (after Python is installed)

```bash
cd d:/practiceproj/backend

# Install all packages (first time only)
python -m pip install -r requirements.txt

# Start the server
uvicorn main:app --reload --port 8000
```

Server running? Visit **http://localhost:8000/docs** to test all endpoints interactively.

---

## ✅ Step 2 Status: Complete

`database.py` is written and wired into `main.py`.
Next: **Step 3 — Base44 Frontend Prompt**
