import { useState, useEffect } from 'react'
import { useUser, useClerk, UserButton } from '@clerk/clerk-react'

const Dashboard = ({ apiUrl, onStartMeeting }) => {
  const { user } = useUser()
  const [points, setPoints] = useState(0)
  const [meetingCode, setMeetingCode] = useState('')
  const [generatedLink, setGeneratedLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [joinCode, setJoinCode] = useState(() => {
    const parts = window.location.pathname.split('/join/')
    return parts.length === 2 && parts[1] ? parts[1] : ''
  })

  const appOrigin = window.location.origin

  // Fetch Sharp Tokens from backend
  useEffect(() => {
    if (!user?.id) return
    fetch(`${apiUrl}/rewards/${user.id}`)
      .then(r => r.json())
      .then(d => setPoints(d?.points ?? 0))
      .catch(() => {})
  }, [user, apiUrl])



  const handleStartMeeting = () => {
    const roomId = meetingCode.trim() ||
      `room-${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)}`
    const link = `${appOrigin}/join/${roomId}`
    setGeneratedLink(link)
    setMeetingCode(roomId)
    onStartMeeting(roomId, 'host')
  }

  const handleJoinMeeting = () => {
    const code = joinCode.trim()
    if (!code) { alert('Enter a meeting code or link.'); return }
    const roomId = code.includes('/join/') ? code.split('/join/').pop() : code
    onStartMeeting(roomId, 'audience')
  }

  const copyLink = () => {
    navigator.clipboard.writeText(generatedLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const displayName = user?.fullName || user?.firstName || user?.emailAddresses?.[0]?.emailAddress || 'User'
  const avatarUrl   = user?.imageUrl

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background blobs */}
      <div className="absolute top-[-15%] left-[-15%] w-[55%] h-[55%] bg-blue-600/20 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-15%] right-[-15%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[140px] pointer-events-none" />

      <div className="w-full max-w-lg space-y-4 relative z-10 animate-slide-in">

        {/* Profile Card */}
        <div className="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="w-12 h-12 rounded-full border-2 border-blue-500/50 shadow-lg" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-white text-lg">
                {displayName[0].toUpperCase()}
              </div>
            )}
            <div>
              <div className="font-bold text-sm">{displayName}</div>
              <div className="text-[11px] text-slate-400 truncate max-w-[200px]">
                {user?.emailAddresses?.[0]?.emailAddress}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] uppercase text-slate-500 font-bold">Sharp Tokens</div>
              <div className="text-lg font-black text-amber-400">{points} ⭐</div>
            </div>
            {/* Clerk's UserButton — handles sign out + account management */}
            <UserButton
              appearance={{
                elements: {
                  avatarBox: 'w-9 h-9 border-2 border-slate-600',
                  userButtonPopoverCard: 'bg-slate-900 border border-white/10',
                  userButtonPopoverActionButton: 'text-slate-300 hover:bg-white/5',
                  userButtonPopoverActionButtonText: 'text-slate-300',
                },
              }}
            />
          </div>
        </div>

        {/* App Title */}
        <div className="text-center py-2">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            Lumina Lens
          </h1>
          <p className="text-xs text-slate-400 mt-1">AI-Powered Live Q&amp;A</p>
        </div>

        {/* Start Meeting (Host) */}
        <div className="glass-panel rounded-2xl p-5 space-y-3">
          <span className="text-[11px] uppercase font-bold tracking-wider text-blue-400">🎤 Host a Meeting</span>
          <input
            type="text"
            value={meetingCode}
            onChange={e => setMeetingCode(e.target.value)}
            placeholder="Custom room name (optional — leave blank to auto-generate)"
            className="w-full glass-input rounded-xl px-3 py-2 text-sm"
          />
          <button
            id="start-meeting-btn"
            onClick={handleStartMeeting}
            className="w-full btn-primary py-3 rounded-xl font-semibold text-sm animate-pulse-glow"
          >
            🚀 Start Meeting
          </button>

          {/* Shareable link */}
          {generatedLink && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3 space-y-2">
              <div className="text-[11px] text-green-400 font-bold uppercase">Share this link with participants:</div>
              <div className="flex items-center gap-2">
                <code className="text-[11px] text-slate-300 bg-black/30 rounded-lg px-2 py-1.5 flex-1 truncate">
                  {generatedLink}
                </code>
                <button
                  onClick={copyLink}
                  className="shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white transition-colors"
                >
                  {copied ? '✓ Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Join Meeting (Audience) */}
        <div className="glass-panel rounded-2xl p-5 space-y-3">
          <span className="text-[11px] uppercase font-bold tracking-wider text-slate-400">👀 Join a Meeting</span>
          <input
            type="text"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value)}
            placeholder="Paste meeting code or full link"
            className="w-full glass-input rounded-xl px-3 py-2 text-sm"
          />
          <button
            id="join-meeting-btn"
            onClick={handleJoinMeeting}
            className="w-full bg-[rgba(255,255,255,0.05)] border border-[var(--border-subtle)] hover:border-blue-500/50 hover:bg-blue-500/10 py-3 rounded-xl transition-all font-semibold text-sm"
          >
            Join as Audience
          </button>
        </div>

        <div className="text-center">
          <p className="text-[11px] text-slate-500 flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
            Connected — Ready for live Q&amp;A
          </p>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
