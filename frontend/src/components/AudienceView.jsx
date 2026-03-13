import { useState, useEffect, useRef } from 'react'

const AudienceView = ({ sessionId, apiUrl, aiOrganizer }) => {
  const [messages, setMessages] = useState([])
  const [inputMessage, setInputMessage] = useState('')
  const [points, setPoints] = useState(0)
  const [tier, setTier] = useState('basic')
  const [userId] = useState('Jatin_' + Math.floor(Math.random() * 1000))
  const chatEndRef = useRef(null)
  const ws = useRef(null)

  useEffect(() => {
    // Scroll to bottom when messages change
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
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
      }
    }

    fetchPoints()
    return () => ws.current?.close()
  }, [sessionId])

  const fetchPoints = async () => {
    try {
      const res = await fetch(`${apiUrl}/rewards/${userId}`)
      const data = await res.json()
      setPoints(data.points)
      setTier(data.tier)
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
      const msg = aiOrganizer
        ? "⚠️ Our AI is currently unavailable. Please try again."
        : "⚠️ Something went wrong. Please try again."
      setMessages(prev => [...prev, { text: msg, type: 'error', id: Date.now() + 1 }])
    }
  }

  const triggerChaos = () => {
    const chaosMessages = [
      "Can you hear me?",
      "Is the screen frozen?",
      "What time does this end?",
      "Can we get the slides?",
      "When is the break?",
      "Testing testing",
      "Hello everyone",
      "Great presentation!",
      "I have a question about the deadline",
      "What is the deadline?",
      "When is the due date?",
      "Due date please",
      "Is there a recording?",
      "Will this be recorded?",
      "Recording link please",
      "How do I join the slack?",
      "Slack link?",
      "Can someone share the link?",
      "What's the wifi password?",
      "Is this the right meeting?"
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
    <div className="flex-1 flex flex-col glass-panel rounded-2xl overflow-hidden animate-slide-in">
      {/* Audience Header */}
      <div className="p-4 border-b border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] flex justify-between items-center">
        <h2 className="font-bold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
          Live Q&A Chat
        </h2>
        <div className="flex items-center gap-3">
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
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
             <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">💬</div>
             <p className="text-sm">Be the first to ask a question!</p>
             <p className="text-[10px] mt-2 italic opacity-60">Earn points when the host stars your quality questions.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'} animate-slide-in`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
              m.type === 'user' ? 'bg-[#2563EB] text-white rounded-tr-none' : 
              m.type === 'ai' ? 'bg-slate-800 text-blue-300 border border-blue-500/30 rounded-tl-none' :
              m.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/30 rounded-tl-none' :
              m.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-tl-none' :
              'bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs py-1 px-3 text-center w-full'
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={sendMessage} className="p-4 bg-[rgba(0,0,0,0.2)] border-t border-[var(--border-subtle)]">
        <div className="relative group">
          <input 
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Ask a question..."
            className="w-full glass-input rounded-xl px-4 py-3 pr-12 text-sm"
          />
          <button 
            type="submit"
            className="absolute right-2 top-1.5 bottom-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center justify-center transition-colors"
          >
            Send
          </button>
        </div>
        
        {/* Load test button to showcase AI filtering under high traffic */}
        <button 
          type="button"
          onClick={triggerChaos}
          className="mt-3 w-full border border-red-500/20 text-[9px] uppercase tracking-tighter text-red-500/40 hover:text-red-500 hover:border-red-500/50 py-1 rounded transition-all italic"
        >
          Stress Test: Send 20 Rapid Questions
        </button>
      </form>
    </div>
  )
}

export default AudienceView
