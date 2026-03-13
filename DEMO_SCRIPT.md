## Lumina Lens Hackathon Demo Script (Golden Path)

### Roles & Devices
- **Host (e.g. Jatin)**: Laptop running the Host view.
- **Audience (e.g. Aayush)**: Phone or second laptop running the Audience view.

### Pre-demo Setup
- **Backend**: In `backend`, create a virtualenv, install `requirements.txt`, and export:
  - `GEMINI_API_KEY` (for smarter duplicate checks, optional but ideal).
  - `MONGO_URI` (or use the default `mongodb://localhost:27017`).
  - Run: `python run.py` (FastAPI on port 8000).
- **Frontend**: In `frontend`, run `npm install` (once), then `npm run dev` and open the app in the browser.

### Live Demo Flow (3–4 minutes)

1. **Enter the Lobby**
   - Show the landing screen with the Lumina Lens branding.
   - Introduce: “This is a fake Zoom built just for this hackathon, with an AI brain behind it.”

2. **Host Starts the Session**
   - On the Host laptop, click **“Join as Host”**.
   - This calls `POST /session/demo-session-42/start` and boots the backend session.
   - Narrate: “When I start the webinar, our backend creates a session and connects to Mongo + WebSockets.”

3. **Audience Joins & Asks a Unique Question**
   - On the Audience device, click **“Join as Audience”**.
   - Ask a clear, unique question (e.g. “What is the deadline to submit our projects?”).
   - Point out:
     - The question appears in the attendee chat immediately.
     - On the Host side, the same question appears in the **Curated Questions** tab.
     - Explain: “Behind the scenes we embed this question with Sentence Transformers and index it in FAISS.”

4. **Host Stars the Best Question → Spark Points & Leaderboard**
   - On the Host view, click **“Star Question”** on that question.
   - Call out the effects:
     - Audience chat receives a system message: question starred, +50 points.
     - Audience’s **Spark** counter jumps by 50 and tier stays `basic` until enough points.
     - Host **Leaderboard** tab shows this user on top with 50 ⭐.
   - Narrate: “We only award points when the host stars a question. That’s our moderation + gamification loop.”

5. **Show AI Duplicate Filtering**
   - From the Audience view, ask a near-duplicate (e.g. “When is the due date for submissions?”).
   - Show:
     - The attendee chat returns a **duplicate** message instead of sending a new question to the host.
     - On the Host view, no new card appears—only the original question stays.
   - Explain: “FAISS quickly finds the closest match, and Gemini (if the key is set) is the final judge of true duplicates.”

6. **(Optional) Context-Powered Answer**
   - If you’ve preloaded a transcript or agenda via `/load-video` or `/load-text`, ask a question that is clearly answered in that content.
   - Show that the Audience chat returns an **AI Answer** bubble without bothering the host.
   - Narrate: “If the answer is already in the transcript, we just answer it automatically with semantic search.”

7. **Trigger the Chaos Button**
   - On the Audience view, click **“[ Dev ONLY ] Trigger Chaos Mode (Simulate 20 Spam/Duplicate Msgs)”**.
   - Describe what’s happening:
     - Attendee chat floods with ~20 spam/duplicate messages in a couple of seconds.
     - Host dashboard remains clean, showing only a small set of unique questions.
   - Emphasize: “Even under chaos, the host only sees the important, unique questions in real time.”

8. **Wrap-Up Talking Points**
   - “Under the hood we’re using Sentence Transformers + FAISS + Gemini to de-duplicate questions.”
   - “WebSockets and Redis keep host and attendees perfectly in sync.”
   - “Spark Rewards and the leaderboard turn Q&A into a game, rewarding great questions instead of noise.”
   - Close with: “This is plug-and-play for any webinar or town hall that’s drowning in repetitive Q&A.”

//cd d:\practiceproj
.\backend\.venv\Scripts\python.exe backend\run.py


cd d:\practiceproj\frontend
npm run dev -- --host 0.0.0.0 --port 5173