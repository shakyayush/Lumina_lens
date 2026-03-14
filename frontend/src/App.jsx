import { useState, useEffect, useRef } from 'react'
import { SignedIn, SignedOut, useUser } from '@clerk/clerk-react'

import LoginPage from './components/LoginPage'
import Dashboard from './components/Dashboard'
import HostDashboard from './components/HostDashboard'
import AudienceView from './components/AudienceView'
import LiveStream from './components/LiveStream'

const API_URL =
  import.meta.env.VITE_API_URL ||
  `${window.location.protocol}//${window.location.hostname}:8000`

// ── Inner app (only rendered when signed in) ───────────────────────
function SignedInApp() {
  const { user } = useUser()

  const [inMeeting, setInMeeting]         = useState(false)
  const [isStarting, setIsStarting]       = useState(false)   // for loading state
  const [role, setRole]                   = useState('audience')
  const [hostToken, setHostToken]         = useState(null)
  const [sessionId, setSessionId]         = useState('')
  const [isCameraOn, setIsCameraOn]       = useState(false)
  const [isMuted, setIsMuted]             = useState(true)
  const [rightPanelWidth, setRightPanelWidth] = useState(420)
  const [isCompactLayout, setIsCompactLayout] = useState(window.innerWidth < 1024)
  const [isTinyPhone, setIsTinyPhone]         = useState(window.innerWidth < 390 || window.innerHeight < 700)
  const [isPhone, setIsPhone]                 = useState(window.innerWidth < 640)
  const mainRef       = useRef(null)
  const isResizingRef = useRef(false)

  // Save profile to backend on login
  useEffect(() => {
    if (!user) return
    fetch(`${API_URL}/user/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid:       user.id,
        name:      user.fullName || user.firstName || '',
        email:     user.emailAddresses?.[0]?.emailAddress || '',
        photo_url: user.imageUrl || '',
      }),
    }).catch(() => {})
  }, [user])

  // Resize + drag handlers
  useEffect(() => {
    const onResize = () => {
      setIsTinyPhone(window.innerWidth < 390 || window.innerHeight < 700)
      setIsPhone(window.innerWidth < 640)
      const compact = window.innerWidth < 1024
      setIsCompactLayout(compact)
      if (compact) {
        isResizingRef.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    const onMouseMove = (e) => {
      if (!isResizingRef.current || !mainRef.current || isCompactLayout) return
      const rect = mainRef.current.getBoundingClientRect()
      const proposed = rect.right - e.clientX
      setRightPanelWidth(Math.max(320, Math.min(700, Math.min(rect.width - 320, proposed))))
    }
    const onMouseUp = () => {
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isCompactLayout])

  // ── Start / Join meeting ─────────────────────────────────────────
  const startMeeting = async (targetId, selectedRole) => {
    setIsStarting(true)
    try {
      const res = await fetch(
        `${API_URL}/session/${targetId}/start?role=${selectedRole}`,
        { method: 'POST' }
      )
      if (res.ok) {
        const data = await res.json()
        if (data.host_token) setHostToken(data.host_token)
      }
    } catch (e) {
      console.warn('Backend error on session start:', e)
    } finally {
      setIsStarting(false)
    }
    setSessionId(targetId)
    setRole(selectedRole)
    setInMeeting(true)
    if (window.location.pathname !== '/') window.history.replaceState({}, '', '/')
  }

  const handleLeave = async () => {
    try {
      const identity = role === 'host'
        ? `host_${sessionId}`
        : `audience_${user?.id || 'anon'}`
      await fetch(
        `${API_URL}/session/${sessionId}/rtc-presence?identity=${encodeURIComponent(identity)}&state=leave`,
        { method: 'POST' }
      )
    } catch (e) { console.warn('Leave presence error', e) }
    setInMeeting(false)
    setHostToken(null)
    setIsCameraOn(false)
    setIsMuted(true)
  }

  // ── Dashboard (pre-meeting) ──────────────────────────────────────
  if (!inMeeting) {
    return <Dashboard apiUrl={API_URL} onStartMeeting={startMeeting} isStarting={isStarting} />
  }

  // ── In-meeting view ──────────────────────────────────────────────
  const displayName = user?.fullName || user?.firstName || 'You'
  const avatarUrl   = user?.imageUrl
  const rtcUserId   = user?.id || 'anon'

  return (
    <div className={`h-screen w-screen flex flex-col bg-[var(--bg-main)] ${isCompactLayout ? 'overflow-auto' : 'overflow-hidden'}`}>

      {/* ── Top Navbar ─────────────────────────────────────────── */}
      <header className={`glass-panel border-x-0 flex items-center justify-between z-20 shrink-0 ${isCompactLayout ? 'h-12 px-3' : 'h-14 px-6'}`}>
        <div className={`flex items-center ${isCompactLayout ? 'gap-2 min-w-0' : 'gap-3'}`}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-lg">
            L
          </div>
          <span className={`font-semibold ${isCompactLayout ? 'text-sm' : 'text-lg tracking-wide'}`}>
            Lumina Lens
          </span>
          <span className="flex items-center gap-1.5 ml-3 px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 text-[10px] font-bold uppercase tracking-wider border border-red-500/30">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            Live
          </span>
        </div>

        <div className={`flex items-center ${isCompactLayout ? 'gap-2' : 'gap-4'}`}>
          {!isPhone && (
            <div className="flex items-center gap-2">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full border border-white/20" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">
                  {(displayName[0] || 'U').toUpperCase()}
                </div>
              )}
              <span className="text-xs text-slate-400 truncate max-w-[100px]">{displayName}</span>
            </div>
          )}
          {!isCompactLayout && (
            <div className="text-sm px-4 py-1.5 rounded-full bg-white/5 border border-white/10 flex items-center gap-2">
              <span className="text-slate-400">Role:</span>
              <span className="font-semibold text-blue-400">
                {role === 'host' ? 'Host / Presenter' : 'Attendee'}
              </span>
              <span className="text-xs text-slate-500 font-mono ml-1">ID: {sessionId}</span>
            </div>
          )}
          <button
            onClick={handleLeave}
            className="text-xs px-3 py-1.5 rounded-lg border border-red-400/30 text-red-400 hover:text-white hover:bg-red-500/80 transition-all font-semibold"
          >
            ✕ Leave
          </button>
        </div>
      </header>

      {/* ── Main grid ───────────────────────────────────────────── */}
      <main
        ref={mainRef}
        className={`flex-1 min-h-0 relative z-10 ${
          isCompactLayout
            ? 'flex flex-col overflow-y-auto p-2 sm:p-3 gap-3'
            : 'grid p-4 gap-2 overflow-hidden'
        }`}
        style={
          isCompactLayout
            ? undefined
            : { gridTemplateColumns: `minmax(0,1fr) 8px ${rightPanelWidth}px` }
        }
      >
        {/* ── Video panel ──────────────────────────────────── */}
        <div className={`relative flex flex-col glass-panel rounded-2xl overflow-hidden shadow-2xl min-w-0 ${
          isCompactLayout
            ? `shrink-0 ${isTinyPhone ? 'h-[32vh]' : 'h-[38vh]'}`
            : 'h-full min-h-0'
        }`}>

          {/* LiveKit video for both host and audience */}
          <div className="flex-1 min-h-0 h-full">
            <LiveStream
              sessionId={sessionId}
              apiUrl={API_URL}
              role={role}
              userId={rtcUserId}
              isCameraOn={isCameraOn}
              isMuted={isMuted}
            />
          </div>

          {/* Camera / mic toolbar — always visible, pinned to bottom */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-3 px-4 py-3 bg-gradient-to-t from-black/70 to-transparent z-20">
            <button
              type="button"
              onClick={() => setIsMuted(p => !p)}
              title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide transition-all shadow ${
                isMuted
                  ? 'bg-white/20 text-white hover:bg-white/30'
                  : 'bg-red-500 text-white hover:bg-red-600 shadow-red-500/40'
              }`}
            >
              {isMuted ? '🎙 Unmute' : '🔇 Muted'}
            </button>
            <button
              type="button"
              onClick={() => setIsCameraOn(p => !p)}
              title={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide transition-all shadow ${
                isCameraOn
                  ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-blue-500/40'
                  : 'bg-white/20 text-white hover:bg-white/30'
              }`}
            >
              {isCameraOn ? '📷 Cam On' : '📷 Cam Off'}
            </button>
          </div>
        </div>

        {/* ── Drag divider (desktop only) ───────────────── */}
        {!isCompactLayout && (
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={() => {
              isResizingRef.current = true
              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'
            }}
            className="flex items-center justify-center cursor-col-resize group"
          >
            <div className="h-16 w-1 rounded-full bg-slate-600 group-hover:bg-blue-400 transition-colors" />
          </div>
        )}

        {/* ── Right panel: host dashboard or attendee Q&A ── */}
        <div className={`flex flex-col min-w-0 ${isCompactLayout ? '' : 'h-full min-h-0 overflow-hidden'}`}>
          {role === 'host' ? (
            <HostDashboard
              sessionId={sessionId}
              apiUrl={API_URL}
              hostToken={hostToken}
            />
          ) : (
            <AudienceView
              sessionId={sessionId}
              apiUrl={API_URL}
              currentUser={{ uid: user?.id, displayName, photoURL: avatarUrl }}
            />
          )}
        </div>
      </main>
    </div>
  )
}

// ── Root App — Clerk handles auth state ────────────────────────────
function App() {
  return (
    <>
      <SignedOut>
        <LoginPage />
      </SignedOut>
      <SignedIn>
        <SignedInApp />
      </SignedIn>
    </>
  )
}

export default App
