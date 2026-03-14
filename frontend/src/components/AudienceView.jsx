import { useState, useEffect, useRef } from 'react'

const AudienceView = ({ sessionId, apiUrl, currentUser }) => {
  const [messages, setMessages] = useState([])
  const [inputMessage, setInputMessage] = useState('')
  const [points, setPoints] = useState(0)
  const [hostName, setHostName] = useState('')
  const [meetingTopic, setMeetingTopic] = useState('')
  const [participantCount, setParticipantCount] = useState(0)
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 640 || window.innerHeight < 700)

  // Use Firebase uid or fall back to localStorage for unauthenticated preview
  const userId = currentUser?.uid || (() => {
    const key = 'lumina_user_id'
    return window.localStorage.getItem(key) || (
      (() => { const id = 'Attendee_' + Math.random().toString(36).slice(2); window.localStorage.setItem(key, id); return id })()
    )
  })()

  const chatEndRef = useRef(null)
  const ws = useRef(null)
  const starredQuestionIds = useRef(new Set()) // Track already-notified starred questions

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 640 || window.innerHeight < 700)
    window.addEventListener('resize', onResize)

    // Connect WebSocket
    const wsUrl = apiUrl.replace(/^http/, 'ws') + `/session/${sessionId}/ws`
    ws.current = new WebSocket(wsUrl)

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        // Host starred this user's question
        if (data.type === 'star' && data.user_id === userId) {
          // Prevent duplicate notifications if WS fires twice
          if (!starredQuestionIds.current.has(data.question_id || 'star')) {
            starredQuestionIds.current.add(data.question_id || 'star')
            setMessages(prev => [...prev, {
              text: `⭐ Your question was starred by the host! +50 Sharp Tokens added.`,
              type: 'system',
              id: Date.now(),
            }])
            setPoints(data.new_total ?? 0)
          }
        }

        // AI answered this user's question (ai_resolution broadcast)
        if (data.type === 'ai_resolution' && data.user_id === userId) {
          setMessages(prev => [...prev, {
            text: `🤖 AI Answer: ${data.message}`,
            type: 'ai',
            id: Date.now() + 1,
          }])
        }

        // Live Participant Count
        if (data.type === 'participant_count') {
          setParticipantCount(data.count || 0)
        }
      } catch (e) {
        console.warn('[WS] failed to parse message', e)
      }
    }

    ws.current.onerror = () => {
      console.warn('[WS] connection error')
    }

    fetchPoints()
    fetchMetadata()

    return () => {
      window.removeEventListener('resize', onResize)
      ws.current?.close()
    }
  }, [sessionId])

  const fetchPoints = async () => {
    try {
      const res = await fetch(`${apiUrl}/rewards/${userId}`)
      const data = await res.json()
      setPoints(Number(data?.points) || 0)
    } catch (e) {
      console.warn('fetchPoints error', e)
    }
  }

  const fetchMetadata = async () => {
    try {
      const res = await fetch(`${apiUrl}/session/${sessionId}/metadata`)
      const data = await res.json()
      if (data) {
        setHostName(data.host_name || '')
        setMeetingTopic(data.meeting_topic || '')
      }
    } catch (e) {
      console.warn('fetchMetadata error', e)
    }
  }

  const sendMessage = async (e) => {
    e?.preventDefault()
    const msgText = inputMessage.trim()
    if (!msgText || msgText.length < 5) {
      setMessages(prev => [...prev, {
        text: '⚠️ Please enter a question with at least 5 characters.',
        type: 'error',
        id: Date.now(),
      }])
      return
    }
    if (msgText.length > 500) {
      setMessages(prev => [...prev, {
        text: '⚠️ Question is too long (max 500 characters).',
        type: 'error',
        id: Date.now(),
      }])
      return
    }

    setInputMessage('')
    setMessages(prev => [...prev, { text: msgText, type: 'user', id: Date.now() }])

    try {
      const res = await fetch(`${apiUrl}/session/${sessionId}/question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, text: msgText }),
      })
      const data = await res.json()

      let feedbackMsg = ''
      let feedbackType = 'ai'

      if (data.status === 'duplicate') {
        feedbackMsg = `🔁 Duplicate: ${data.message}`
        feedbackType = 'error'
      } else if (data.status === 'context_answered') {
        feedbackMsg = `🤖 AI Answer: ${data.message}`
        feedbackType = 'ai'
      } else {
        feedbackMsg = `✔️ Question submitted! You'll earn Sharp Tokens if the host stars it.`
        feedbackType = 'success'
      }

      setMessages(prev => [...prev, { text: feedbackMsg, type: feedbackType, id: Date.now() + 1 }])
      if (data.total_points !== undefined) setPoints(data.total_points)
    } catch (e) {
      setMessages(prev => [...prev, {
        text: '⚠️ Could not reach server. Please try again.',
        type: 'error',
        id: Date.now() + 1,
      }])
    }
  }

  const triggerChaos = () => {
    const chaosMessages = [
      // --- 3 common-context questions (same topic: what is HackIndia / its focus) ---
      // AI should deduplicate and answer all three from the meeting draft
      'What is HackIndia 2026?',
      'Can you explain what HackIndia is about?',
      'What does HackIndia 2026 aim to achieve for Indian developers?',

      // --- 2 unique questions (distinct topics, should reach host inbox) ---
      'What is the prize pool for HackIndia 2026?',
      'How many team members are allowed per team in HackIndia?',
    ]

    chaosMessages.forEach((msg, i) => {
      setTimeout(async () => {
        setMessages(prev => [...prev, { text: msg, type: 'user', id: Date.now() + i }])
        fetch(`${apiUrl}/session/${sessionId}/question`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, text: msg }),
        })
      }, i * 100)
    })
  }

  return (
    <div className="flex-1 flex flex-col glass-panel rounded-2xl overflow-hidden animate-slide-in min-h-0">
      {/* Audience Header */}
      <div className="p-3 sm:p-4 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] flex justify-between items-center gap-2">
        <div className="flex flex-col min-w-0">
          <h2 className="font-bold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-sm sm:text-base">Live Q&A Chat</span>
          </h2>
          {(hostName || meetingTopic) && (
            <div className="text-[10px] text-slate-400 mt-1 ml-4 truncate">
              Session/Meeting {meetingTopic && ` ${meetingTopic}`} {hostName && ` by ${hostName}`}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* User identity */}
          {currentUser && (
            <div className="flex items-center gap-1.5">
              {currentUser.photoURL ? (
                <img src={currentUser.photoURL} alt="" className="w-6 h-6 rounded-full border border-white/20" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold">
                  {(currentUser.displayName || 'U')[0].toUpperCase()}
                </div>
              )}
              <span className="text-[10px] text-slate-400 hidden sm:block truncate max-w-[80px]">
                {currentUser.displayName?.split(' ')[0] || 'You'}
              </span>
            </div>
          )}
          <div className="text-right flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-500/10 text-blue-300 border border-blue-500/20 rounded-full text-[10px] font-mono shadow-sm">
              👥 {participantCount}
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500 font-bold leading-none">Sharp Tokens</div>
              <div className="text-sm font-bold text-amber-400 leading-none mt-1 pr-2">{points}</div>
            </div>
          </div>
        </div>
      </div>


      {/* Messages Area */}
      <div className="p-3 sm:p-4 flex-1 overflow-hidden">
        <div className="h-full max-h-[60vh] overflow-y-auto space-y-3 sm:space-y-4 custom-scrollbar">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">💬</div>
              <p className="text-sm">Be the first to ask a question!</p>
              <p className="text-[10px] mt-2 italic opacity-60">Earn Sharp Tokens when the host stars your quality questions.</p>
            </div>
          )}
          {messages.map((m) => {
            const hasAiLabel = m.type === 'ai' && m.text && m.text.includes('— Answered by AI')
            const [mainText] = hasAiLabel ? m.text.split('\n\n— Answered by AI') : [m.text]
            return (
              <div key={m.id} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'} animate-slide-in`}>
                <div className={`max-w-[92%] sm:max-w-[85%] rounded-2xl px-3 sm:px-4 py-2 text-sm ${
                  m.type === 'user'    ? 'bg-[#2563EB] text-white rounded-tr-none' :
                  m.type === 'ai'     ? 'bg-slate-800 text-blue-300 border border-blue-500/30 rounded-tl-none' :
                  m.type === 'error'  ? 'bg-red-500/10 text-red-400 border border-red-500/30 rounded-tl-none' :
                  m.type === 'success'? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-tl-none' :
                  'bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs py-1 px-3 text-center w-full'
                }`}>
                  {hasAiLabel ? (
                    <>
                      <div>{mainText.replace(/^🤖 AI Answer: /, '').trim()}</div>
                      <div className="mt-2 pt-2 border-t border-blue-500/20 text-[10px] text-blue-400/80 font-medium">Answered by AI</div>
                    </>
                  ) : m.text}
                </div>
              </div>
            )
          })}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <form onSubmit={sendMessage} className="p-3 sm:p-4 bg-[rgba(0,0,0,0.2)] border-t border-[var(--border-subtle)]">
        <div className={isNarrow ? 'grid grid-cols-1 gap-2' : 'flex gap-2'}>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Ask a question (min 5 chars)..."
            maxLength={500}
            className="flex-1 glass-input rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-sm"
          />
          <button
            type="submit"
            className={`px-3 sm:px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center justify-center transition-colors text-sm font-medium ${isNarrow ? 'w-full py-2.5' : ''}`}
          >
            Send
          </button>
        </div>

        {/* Stress test button */}
        <button
          type="button"
          onClick={triggerChaos}
          className="mt-2.5 sm:mt-3 w-full border border-red-500/20 text-[10px] uppercase tracking-tight text-red-500/40 hover:text-red-500 hover:border-red-500/50 py-1.5 rounded transition-all italic"
        >
          {isNarrow ? 'Stress Test (5 Questions)' : 'Stress Test: Send 5 HackIndia Questions (3 common + 2 unique)'}
        </button>
      </form>
    </div>
  )
}

export default AudienceView
