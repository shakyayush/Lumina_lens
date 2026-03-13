import { useState, useEffect, useRef } from 'react'

const HostDashboard = ({ sessionId, apiUrl, hostToken }) => {
  const [questions, setQuestions] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [activeTab, setActiveTab] = useState('questions') // 'questions' | 'leaderboard'
  const [draftContext, setDraftContext] = useState('')
  const [hostName, setHostName] = useState('')
  const [meetingTopic, setMeetingTopic] = useState('')
  const [isContextLoading, setIsContextLoading] = useState(false)
  const [hasSentContext, setHasSentContext] = useState(false)
  const [isMetadataSaved, setIsMetadataSaved] = useState(false)
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 640)
  const [showDraftBox, setShowDraftBox] = useState(window.innerWidth >= 640)
  const ws = useRef(null)

  useEffect(() => {
    const onResize = () => {
      const narrow = window.innerWidth < 640
      setIsNarrow(narrow)
      if (!narrow) setShowDraftBox(true)
    }
    window.addEventListener('resize', onResize)

    fetchInitialData()

    const wsUrl = apiUrl.replace(/^http/, 'ws') + `/session/${sessionId}/ws`
    ws.current = new WebSocket(wsUrl)

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'new_question' || data.type === 'star') {
          if (data.questions) setQuestions(data.questions)
          if (data.leaderboard) setLeaderboard(data.leaderboard)
        }
      } catch (e) {
        console.warn('[WS] failed to parse message', e)
      }
    }

    ws.current.onerror = () => console.warn('[WS] connection error')

    return () => {
      window.removeEventListener('resize', onResize)
      ws.current?.close()
    }
  }, [sessionId])

  const fetchInitialData = async () => {
    try {
      const [qRes, lbRes] = await Promise.all([
        fetch(`${apiUrl}/session/${sessionId}/questions`),
        fetch(`${apiUrl}/session/${sessionId}/leaderboard`),
      ])
      if (qRes.ok) setQuestions(await qRes.json())
      if (lbRes.ok) setLeaderboard(await lbRes.json())
    } catch (e) {}
  }

  const starQuestion = async (qId) => {
    if (!hostToken) {
      console.warn('No host token — cannot star')
      return
    }
    try {
      const res = await fetch(`${apiUrl}/session/${sessionId}/star`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: qId, host_token: hostToken }),
      })
      const data = await res.json()
      if (data.success) {
        setQuestions(prev => prev.map(q => q.id === qId ? { ...q, starred: true } : q))
      }
    } catch (e) {}
  }

  const saveMetadata = async () => {
    if (!hostName.trim() && !meetingTopic.trim()) return
    try {
      await fetch(`${apiUrl}/session/${sessionId}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host_name: hostName.trim() || null,
          meeting_topic: meetingTopic.trim() || null,
        }),
      })
      setIsMetadataSaved(true)
    } catch (e) {
      console.warn('Failed to save metadata', e)
    }
  }

  const sendDraft = async () => {
    if (!draftContext.trim()) return
    try {
      setIsContextLoading(true)
      const res = await fetch(
        `${apiUrl}/session/${sessionId}/load-text?text=${encodeURIComponent(draftContext)}`,
        { method: 'POST' }
      )
      await res.json()
      setHasSentContext(true)
    } catch (e) {
      console.warn('Failed to send draft', e)
    } finally {
      setIsContextLoading(false)
    }
  }

  return (
    <div className={`flex-1 flex flex-col glass-panel rounded-2xl animate-slide-in min-h-0 ${isNarrow ? 'max-h-[70vh] overflow-hidden' : 'overflow-hidden'}`}>
      
      {/* Tabs */}
      <div className="flex flex-col border-b border-[var(--border-subtle)] bg-white/70">
        <div className="flex">
          <button
            onClick={() => setActiveTab('questions')}
            className={`flex-1 py-2.5 sm:py-3 text-[11px] sm:text-xs font-bold uppercase tracking-wide sm:tracking-widest transition-all ${
              activeTab === 'questions' ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Curated Questions
          </button>
          <button
            onClick={() => setActiveTab('leaderboard')}
            className={`flex-1 py-2.5 sm:py-3 text-[11px] sm:text-xs font-bold uppercase tracking-wide sm:tracking-widest transition-all ${
              activeTab === 'leaderboard' ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Leaderboard
          </button>
        </div>

        {/* Meeting Setup Panel */}
        <div className="px-3 sm:px-4 pb-3 pt-2 border-t border-[var(--border-subtle)] bg-white/70 space-y-3">

          {/* Host Name + Topic (session metadata) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                Host Info <span className="text-slate-400 normal-case font-normal">(helps AI answer meta‑questions)</span>
              </span>
              {isMetadataSaved && (
                <span className="text-[10px] text-emerald-500 font-semibold">✓ Saved</span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={hostName}
                onChange={e => { setHostName(e.target.value); setIsMetadataSaved(false) }}
                placeholder="Your name (e.g. Alice Johnson)"
                className="text-xs rounded-lg border border-[var(--border-subtle)] bg-white/80 px-2 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
              />
              <input
                type="text"
                value={meetingTopic}
                onChange={e => { setMeetingTopic(e.target.value); setIsMetadataSaved(false) }}
                placeholder="Meeting topic (e.g. Q3 Roadmap)"
                className="text-xs rounded-lg border border-[var(--border-subtle)] bg-white/80 px-2 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
              />
            </div>
            <button
              type="button"
              disabled={!hostName.trim() && !meetingTopic.trim()}
              onClick={saveMetadata}
              className="mt-2 px-3 py-1.5 rounded-lg bg-emerald-600 disabled:bg-emerald-300 disabled:cursor-not-allowed text-white text-[11px] font-semibold uppercase tracking-wide hover:bg-emerald-500 transition-colors"
            >
              {isMetadataSaved ? '✓ Saved to AI' : 'Save Host Info'}
            </button>
          </div>

          {/* Draft Context */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                Meeting Draft / Agenda
              </span>
              <div className="flex items-center gap-2">
                {isNarrow && (
                  <button
                    type="button"
                    onClick={() => setShowDraftBox(prev => !prev)}
                    className="text-[10px] px-2 py-1 rounded border border-slate-300 text-slate-600 bg-white"
                  >
                    {showDraftBox ? 'Hide' : 'Show'}
                  </button>
                )}
                <span className="text-[10px] font-bold text-blue-600 px-2 py-1 rounded border border-blue-200 bg-blue-50">
                  AI Always On
                </span>
              </div>
            </div>

            <div className={`${showDraftBox ? 'grid' : 'hidden'} grid-cols-1 sm:grid-cols-[1fr_auto] gap-2`}>
              <textarea
                value={draftContext}
                onChange={e => { setDraftContext(e.target.value); setHasSentContext(false) }}
                placeholder="Paste your agenda, notes, or topic details here. The AI will use this to auto-answer attendee questions..."
                className="w-full text-xs rounded-lg border border-[var(--border-subtle)] bg-white/80 px-2 py-2 resize-none h-16 sm:h-14 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
              />
              <div className="flex flex-col gap-1 items-stretch">
                <button
                  type="button"
                  disabled={!draftContext.trim() || isContextLoading}
                  onClick={sendDraft}
                  className="px-3 py-2 sm:py-1.5 rounded-lg bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-[11px] font-semibold uppercase tracking-wide hover:bg-blue-500 transition-colors"
                >
                  {isContextLoading ? 'Loading…' : hasSentContext ? '✓ Sent' : 'Send to AI'}
                </button>
                {hasSentContext && !isContextLoading && (
                  <button
                    type="button"
                    onClick={() => setHasSentContext(false)}
                    className="text-[10px] text-blue-600 hover:text-blue-500 underline-offset-2 hover:underline"
                  >
                    Edit & resend
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'questions' ? (
        <div className="flex-1 p-3 sm:p-4 overflow-hidden">
          <div className="max-h-[55vh] overflow-y-auto space-y-2.5 sm:space-y-3 custom-scrollbar">
            {questions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 sm:p-6 text-slate-500">
                <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">✨</div>
                <p className="text-sm italic">Waiting for unique questions...</p>
                <p className="text-[10px] mt-1 opacity-60 px-4">
                  AI answers common questions from your draft and queues only unique ones here.
                </p>
              </div>
            ) : (
              questions.map((q, i) => (
                <div key={q.id} className="glass-panel p-3 sm:p-4 rounded-xl border-l-4 border-l-blue-500 animate-slide-in hover:bg-white/5 transition-colors group">
                  <div className="flex justify-between items-start gap-3 sm:gap-4">
                    <p className="text-sm font-medium leading-relaxed break-words">{q.text}</p>
                    <span className="text-[10px] font-bold text-slate-500 shrink-0">#{i + 1}</span>
                  </div>

                  <div className="mt-3 sm:mt-4 flex justify-between items-center gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-slate-700 flex items-center justify-center text-[10px]">👤</div>
                      <span className="text-[11px] text-slate-400 font-medium truncate max-w-[120px]">{q.user_id}</span>
                      {q.priority === 'priority' && (
                        <span className="text-[9px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/30 px-1.5 py-0.5 rounded">PRO</span>
                      )}
                    </div>

                    {q.starred ? (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-amber-500 bg-amber-500/10 px-2 py-1 rounded-lg">
                        ⭐ Starred · +50 pts sent
                      </span>
                    ) : (
                      <button
                        onClick={() => starQuestion(q.id)}
                        className="text-[11px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30 px-2.5 sm:px-3 py-1 rounded-lg hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all"
                      >
                        ⭐ Star (+50 pts)
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2 custom-scrollbar">
          <h3 className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-4 px-2">Sharp Token Rankings</h3>
          {leaderboard.length === 0 ? (
            <p className="text-center text-slate-500 text-xs italic mt-10">No points awarded yet.</p>
          ) : (
            leaderboard.map((u, i) => (
              <div key={u.user_id} className="flex items-center gap-3 sm:gap-4 p-2.5 sm:p-3 rounded-xl hover:bg-white/5 transition-all">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold shadow-lg ${
                  i === 0 ? 'bg-amber-400 text-amber-900 shadow-amber-400/20' :
                  i === 1 ? 'bg-slate-400 text-slate-900 shadow-slate-400/20' :
                  i === 2 ? 'bg-amber-700 text-white shadow-amber-700/20' :
                  'bg-slate-800 text-slate-400'
                }`}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold break-all">{u.user_id}</div>
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
      <div className="p-2.5 sm:p-3 bg-[rgba(255,255,255,0.7)] border-t border-[var(--border-subtle)] flex flex-col sm:flex-row justify-between sm:items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
        <div className="flex items-center gap-1 break-words">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
          AI On — Answers common Qs from draft; inbox shows unique only
        </div>
        <div>{questions.length} Questions in Inbox</div>
      </div>
    </div>
  )
}

export default HostDashboard
