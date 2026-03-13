import { useState, useEffect, useRef } from 'react'

const HostDashboard = ({ sessionId, apiUrl, aiOrganizer, setAiOrganizer }) => {
  const [questions, setQuestions] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [activeTab, setActiveTab] = useState('questions') // 'questions' | 'leaderboard'
  const [draftContext, setDraftContext] = useState('')
  const [contextStatus, setContextStatus] = useState(null)
  const [isContextLoading, setIsContextLoading] = useState(false)
  const [hasSentContext, setHasSentContext] = useState(false)
  const ws = useRef(null)

  useEffect(() => {
    // Initial fetch
    fetchInitialData()

    // Connect WebSocket
    const wsUrl = apiUrl.replace('http', 'ws') + `/session/${sessionId}/ws`
    ws.current = new WebSocket(wsUrl)
    
    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data)
      console.log("WS host received:", data)
      
      if (data.type === 'new_question' || data.type === 'star') {
        setQuestions(data.questions || [])
        if (data.leaderboard) setLeaderboard(data.leaderboard)
      }
    }

    return () => ws.current?.close()
  }, [sessionId])

  const fetchInitialData = async () => {
    try {
      const [qRes, lbRes] = await Promise.all([
        fetch(`${apiUrl}/session/${sessionId}/questions`),
        fetch(`${apiUrl}/session/${sessionId}/leaderboard`)
      ])
      setQuestions(await qRes.json())
      setLeaderboard(await lbRes.json())
    } catch (e) {}
  }

  const starQuestion = async (qId) => {
    try {
      const res = await fetch(`${apiUrl}/session/${sessionId}/star`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: qId }),
      })
      const data = await res.json()
      if (data.success) {
        // WebSocket will broadcast the update to all, including us
      }
    } catch (e) {}
  }

  return (
    <div className="flex-1 flex flex-col glass-panel rounded-2xl overflow-hidden animate-slide-in">
      {/* Host Tabs + AI Context Loader */}
      <div className="flex flex-col border-b border-[var(--border-subtle)] bg-white/70">
        <div className="flex">
          <button 
            onClick={() => setActiveTab('questions')}
            className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
              activeTab === 'questions' ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Curated Questions
          </button>
          <button 
            onClick={() => setActiveTab('leaderboard')}
            className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
              activeTab === 'leaderboard' ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Leaderboard
          </button>
        </div>

        {/* Meeting context draft for AI */}
        <div className="px-4 pb-3 pt-2 border-t border-[var(--border-subtle)] bg-white/70">
          <div className="flex items-center justify-between mb-1">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                Meeting Topics / Agenda for AI
              </span>
              <span className="text-[10px] text-slate-500">
                When AI Organizer is on, this agenda helps the AI keep only unique, high-signal questions in your inbox.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAiOrganizer(prev => !prev)}
              className={`ml-3 inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide border shadow-sm transition-colors ${
                aiOrganizer
                  ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-500'
                  : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  aiOrganizer ? 'bg-emerald-300' : 'bg-slate-400'
                }`}
              />
              <span>AI Organizer</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                  aiOrganizer ? 'bg-white/20' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {aiOrganizer ? 'On' : 'Off'}
              </span>
            </button>
          </div>
          <div className="flex gap-2">
            <textarea
              value={draftContext}
              onChange={e => setDraftContext(e.target.value)}
              placeholder="Example: Today we will cover the hackathon rules, submission deadlines, judging criteria, and Base44 integration..."
              className="flex-1 text-xs rounded-lg border border-[var(--border-subtle)] bg-white/80 px-2 py-2 resize-none h-14 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
            />
            <div className="flex flex-col gap-1 items-stretch">
              <button
                type="button"
                disabled={!draftContext.trim() || isContextLoading}
                onClick={async () => {
                  if (!draftContext.trim()) return
                  try {
                    setIsContextLoading(true)
                    setContextStatus({ status: 'loading', message: 'Indexing…' })
                    const res = await fetch(
                      `${apiUrl}/session/${sessionId}/load-text?text=${encodeURIComponent(draftContext)}`,
                      { method: 'POST' }
                    )
                    const data = await res.json()
                    setContextStatus(data)
                    setHasSentContext(true)
                  } catch (e) {
                    setContextStatus({ status: 'error', message: 'Could not load context' })
                  } finally {
                    setIsContextLoading(false)
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-[11px] font-semibold uppercase tracking-wide hover:bg-blue-500 transition-colors"
              >
                {isContextLoading ? 'Loading…' : hasSentContext ? 'Sent' : 'Send to AI'}
              </button>
              {hasSentContext && !isContextLoading && (
                <button
                  type="button"
                  onClick={() => setHasSentContext(false)}
                  className="text-[10px] text-blue-600 hover:text-blue-500 underline-offset-2 hover:underline"
                >
                  Edit draft and send again
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {activeTab === 'questions' ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {questions.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
               <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">✨</div>
               <p className="text-sm italic">Waiting for unique questions...</p>
               <p className="text-[10px] mt-1 opacity-60 px-4">The AI is currently filtering duplicate and spam questions from the chat.</p>
            </div>
          ) : (
            questions.map((q, i) => (
              <div key={q.id} className="glass-panel p-4 rounded-xl border-l-4 border-l-blue-500 animate-slide-in hover:bg-white/5 transition-colors group">
                <div className="flex justify-between items-start gap-4">
                  <p className="text-sm font-medium leading-relaxed">{q.text}</p>
                  <span className="text-[10px] font-bold text-slate-500 shrink-0">#{i + 1}</span>
                </div>
                
                <div className="mt-4 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-[10px]">👤</div>
                    <span className="text-[11px] text-slate-400 font-medium">{q.user_id}</span>
                  </div>
                  
                  {q.starred ? (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-amber-500 bg-amber-500/10 px-2 py-1 rounded-lg">
                      ⭐ Starred
                    </span>
                  ) : (
                    <button 
                      onClick={() => starQuestion(q.id)}
                      className="text-[11px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30 px-3 py-1 rounded-lg hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all"
                    >
                      Star Question
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          <h3 className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-4 px-2">Spark Points Rankings</h3>
          {leaderboard.length === 0 ? (
             <p className="text-center text-slate-500 text-xs italic mt-10">No points awarded yet.</p>
          ) : (
            leaderboard.map((u, i) => (
                <div key={u.user_id} className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-all">
                   <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold shadow-lg ${
                     i === 0 ? 'bg-amber-400 text-amber-900 shadow-amber-400/20' :
                     i === 1 ? 'bg-slate-400 text-slate-900 shadow-slate-400/20' :
                     i === 2 ? 'bg-amber-700 text-white shadow-amber-700/20' :
                     'bg-slate-800 text-slate-400'
                   }`}>
                     {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                   </div>
                   <div className="flex-1">
                      <div className="text-sm font-bold">{u.user_id}</div>
                      <div className="text-[10px] uppercase font-bold text-blue-500/70">{u.tier} Tier</div>
                   </div>
                   <div className="text-sm font-black text-white">
                      {u.points} <span className="text-amber-400">⭐</span>
                   </div>
                </div>
            ))
          )}
        </div>
      )}

      {/* Stats Footer */}
      <div className="p-3 bg-[rgba(255,255,255,0.7)] border-t border-[var(--border-subtle)] flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
         <div className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${aiOrganizer ? 'bg-blue-500' : 'bg-slate-400'}`}></span>
            {aiOrganizer ? 'AI Organizer: On — Inbox shows unique, curated questions' : 'AI Organizer: Off — Showing all approved questions'}
         </div>
         <div>{questions.length} Questions in Inbox</div>
      </div>
    </div>
  )
}

export default HostDashboard
