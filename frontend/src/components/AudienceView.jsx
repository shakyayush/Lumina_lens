import { useState, useEffect, useRef } from 'react'

const AudienceView = ({ sessionId, apiUrl }) => {
  const [messages, setMessages] = useState([])
  const [inputMessage, setInputMessage] = useState('')
  const [points, setPoints] = useState(0)
  const [tier, setTier] = useState('basic')
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 640 || window.innerHeight < 700)
  const [userId] = useState(() => {
    const key = 'lumina_user_id'
    const existing = window.localStorage.getItem(key)
    if (existing) return existing
    const created = 'Attendee_' + Math.floor(Math.random() * 10000)
    window.localStorage.setItem(key, created)
    return created
  })
  const chatEndRef = useRef(null)
  const ws = useRef(null)

  useEffect(() => {
    // Scroll to bottom when messages change
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 640 || window.innerHeight < 700)
    window.addEventListener('resize', onResize)

    // Connect WebSockets
    const wsUrl = apiUrl.replace('http', 'ws') + `/session/${sessionId}/ws`
    ws.current = new WebSocket(wsUrl)
    
    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'star' && data.user_id === userId) {
        setMessages(prev => [...prev, { 
          text: `⭐ Host starred your question! You earned 50 points!`, 
          type: 'system',
          id: Date.now() 
        }])
        fetchPoints()
      } else if (data.type === 'ai_resolution' && data.user_id === userId) {
        setMessages(prev => [...prev, {
          text: `🤖 AI Answer: ${data.message}`,
          type: 'ai',
          id: Date.now() + 1
        }])
      }
    }

    fetchPoints()
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
      setTier(data?.tier ?? 'basic')
    } catch (e) {}
  }

  const sendMessage = async (e) => {
    e?.preventDefault()
    if (!inputMessage.trim()) return

    const msgText = inputMessage.trim()
    setInputMessage('')
    
    // Optimistic add to chat
    setMessages(prev => [...prev, { text: msgText, type: 'user', id: Date.now() }])

    try {
      const res = await fetch(`${apiUrl}/session/${sessionId}/question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, text: msgText }),
      })
      const data = await res.json()

      let feedbackMsg = ""
      let feedbackType = 'ai'

      if (data.status === 'duplicate') {
        feedbackMsg = `🔁 Duplicate: ${data.message}`
        feedbackType = 'error'
      } else if (data.status === 'context_answered') {
        feedbackMsg = `🤖 AI Answer: ${data.message}`
        feedbackType = 'ai'
      } else {
        feedbackMsg = `✔️ Question submitted! Points will be awarded if the Host stars it.`
        feedbackType = 'success'
      }

      setMessages(prev => [...prev, { text: feedbackMsg, type: feedbackType, id: Date.now() + 1 }])
      if (data.total_points) setPoints(data.total_points)
    } catch (e) {
      const msg = "⚠️ Our AI is currently unavailable. Please try again."
      setMessages(prev => [...prev, { text: msg, type: 'error', id: Date.now() + 1 }])
    }
  }

  const triggerChaos = () => {
    const chaosMessages = [
      // Topic cluster A: Deadline / submission (similar context, 4 variants)
      "What is the project submission deadline?",
      "By when do we need to submit our project?",
      "When is the final due date for submissions?",
      "Can you confirm the last date to submit?",

      // Topic cluster B: Recording / replay (similar context, 4 variants)
      "Will this session recording be shared?",
      "Can we get the replay link later?",
      "Is there a recording available after this meeting?",
      "Where can we watch this session again?",

      // Unique questions (should remain as unique for host inbox)
      "What are the judging criteria for winners?",
      "How many members are allowed per team?",
      "Is there any prize for best UI/UX?",
      "Do we need to submit source code or only demo video?",
      "Will there be a Q&A session with mentors tomorrow?",
      "What is the process for tie-break decisions?"
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
    <div className={`flex-1 flex flex-col glass-panel rounded-2xl animate-slide-in min-h-0 ${isNarrow ? 'max-h-[70vh] overflow-hidden' : 'overflow-hidden'}`}>
      {/* Audience Header */}
      <div className="p-3 sm:p-4 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] flex justify-between items-center gap-2">
        <h2 className="font-bold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
          <span className="text-sm sm:text-base">Live Q&A Chat</span>
        </h2>
        <div className="flex items-center gap-2 sm:gap-3">
           <div className="text-right">
              <div className="text-[10px] uppercase text-slate-500 font-bold leading-none">Your Spark</div>
              <div className="text-sm font-bold text-amber-400 leading-none mt-1">{points} ⭐</div>
           </div>
           <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
             tier === 'basic' ? 'border-slate-500 text-slate-500' : 'border-blue-500 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.2)]'
           }`}>
             {tier}
           </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 custom-scrollbar">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
             <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">💬</div>
             <p className="text-sm">Be the first to ask a question!</p>
             <p className="text-[10px] mt-2 italic opacity-60">Earn points when the host stars your quality questions.</p>
          </div>
        )}
        {messages.map((m) => {
          const hasAiLabel = m.type === 'ai' && m.text && m.text.includes('— Answered by AI')
          const [mainText, _label] = hasAiLabel ? m.text.split('\n\n— Answered by AI') : [m.text, null]
          return (
            <div key={m.id} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'} animate-slide-in`}>
              <div className={`max-w-[92%] sm:max-w-[85%] rounded-2xl px-3 sm:px-4 py-2 text-sm ${
                m.type === 'user' ? 'bg-[#2563EB] text-white rounded-tr-none' : 
                m.type === 'ai' ? 'bg-slate-800 text-blue-300 border border-blue-500/30 rounded-tl-none' :
                m.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/30 rounded-tl-none' :
                m.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-tl-none' :
                'bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs py-1 px-3 text-center w-full'
              }`}>
                {hasAiLabel ? (
                  <>
                    <div>{mainText.replace(/^🤖 AI Answer: /, '').trim()}</div>
                    <div className="mt-2 pt-2 border-t border-blue-500/20 text-[10px] text-blue-400/80 font-medium">Answered by AI</div>
                  </>
                ) : (
                  m.text
                )}
              </div>
            </div>
          )
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={sendMessage} className="p-3 sm:p-4 bg-[rgba(0,0,0,0.2)] border-t border-[var(--border-subtle)]">
        <div className={isNarrow ? 'grid grid-cols-1 gap-2' : 'flex gap-2'}>
          <input 
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 glass-input rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-sm"
          />
          <button 
            type="submit"
            className={`px-3 sm:px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center justify-center transition-colors text-sm font-medium ${isNarrow ? 'w-full py-2.5' : ''}`}
          >
            Send
          </button>
        </div>
        
        {/* Load test button to showcase AI filtering under high traffic */}
        <button 
          type="button"
          onClick={triggerChaos}
          className="mt-2.5 sm:mt-3 w-full border border-red-500/20 text-[10px] uppercase tracking-tight text-red-500/40 hover:text-red-500 hover:border-red-500/50 py-1.5 rounded transition-all italic"
        >
          {isNarrow ? 'Stress Test Questions' : 'Stress Test: Send 20 Rapid Questions'}
        </button>
      </form>
    </div>
  )
}

export default AudienceView
