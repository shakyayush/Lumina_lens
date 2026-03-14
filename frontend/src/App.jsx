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

  const [inMeeting, setInMeeting] = useState(false)
  const [role, setRole]           = useState('audience')
  const [hostToken, setHostToken] = useState(null)
  const [sessionId, setSessionId] = useState('')
  const [isCameraOn, setIsCameraOn]   = useState(false)
  const [isMuted, setIsMuted]         = useState(true)
  const [rightPanelWidth, setRightPanelWidth]     = useState(420)
  const [isCompactLayout, setIsCompactLayout]     = useState(window.innerWidth < 1024)
  const [isTinyPhone, setIsTinyPhone]             = useState(window.innerWidth < 390 || window.innerHeight < 700)
  const [isPhone, setIsPhone]                     = useState(window.innerWidth < 640)
  const mainRef        = useRef(null)
  const isResizingRef  = useRef(false)

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
      if (compact) { isResizingRef.current = false; document.body.style.cursor = ''; document.body.style.userSelect = '' }
    }
    const onMouseMove = (e) => {
      if (!isResizingRef.current || !mainRef.current || isCompactLayout) return
      const rect = mainRef.current.getBoundingClientRect()
      const proposed = rect.right - e.clientX
      setRightPanelWidth(Math.max(320, Math.min(700, Math.min(rect.width - 320, proposed))))
    }
    const onMouseUp = () => { isResizingRef.current = false; document.body.style.cursor = ''; document.body.style.userSelect = '' }
    window.addEventListener('resize', onResize)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isCompactLayout])

  const startMeeting = async (targetId, selectedRole) => {
    try {
      const res = await fetch(`${API_URL}/session/${targetId}/start?role=${selectedRole}`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        if (data.host_token) setHostToken(data.host_token)
      }
    } catch (e) { console.warn('Backend error on session start', e) }
    setSessionId(targetId)
    setRole(selectedRole)
    setInMeeting(true)
    if (window.location.pathname !== '/') window.history.replaceState({}, '', '/')
  }

  const handleLeave = async () => {
    try {
      const identity = role === 'host' ? `host_${sessionId}` : `audience_${user?.id || 'anon'}`
      await fetch(`${API_URL}/session/${sessionId}/rtc-presence?identity=${encodeURIComponent(identity)}&state=leave`, { method: 'POST' })
    } catch (e) { console.warn('Leave presence error', e) }
    setInMeeting(false)
    setHostToken(null)
  }

  if (!inMeeting) {
    return <Dashboard apiUrl={API_URL} onStartMeeting={startMeeting} />
  }

  const displayName = user?.fullName || user?.firstName || 'You'
  const avatarUrl   = user?.imageUrl
  const rtcUserId   = user?.id || 'anon'

  return (
    <div className={`h-screen w-screen flex flex-col bg-[var(--bg-main)] ${isCompactLayout ? 'overflow-auto' : 'overflow-hidden'}`}>
      {/* Top Navbar */}
      <header className={`glass-panel border-x-0 border-top-0 flex items-center justify-between z-20 ${isCompactLayout ? 'h-12 px-3' : 'h-14 px-6'}`}>
        <div className={`flex items-center ${isCompactLayout ? 'gap-2 min-w-0' : 'gap-3'}`}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/30">L</div>
          <span className={`${isCompactLayout ? 'font-semibold text-sm truncate' : 'font-semibold text-lg tracking-wide'} ${isTinyPhone ? 'max-w-[110px]' : ''}`}>Lumina Lens</span>
          <span className={`${isCompactLayout ? 'hidden lg:flex ml-2' : 'ml-4'} px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-bold uppercase tracking-wider border border-red-500/30 items-center gap-2`}>
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
                  {displayName[0]?.toUpperCase()}
                </div>
              )}
              <span className="text-xs text-slate-400 truncate max-w-[100px]">{displayName}</span>
            </div>
          )}
          <div className={`${isCompactLayout ? 'hidden' : 'text-sm px-4 py-1.5'} rounded-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)]`}>
            <span className="text-[var(--text-secondary)] mr-2">Role:</span>
            <span className="font-semibold text-blue-400">{role === 'host' ? 'Host / Presenter' : 'Attendee'}</span>
            <span className="ml-3 text-xs text-slate-400 font-mono truncate max-w-[160px]">ID: {sessionId}</span>
          </div>
          <button onClick={handleLeave} className={`${isCompactLayout ? 'text-xs px-2 py-1 rounded border border-red-400/30' : 'text-sm'} text-red-400 hover:text-red-300 transition-colors`}>
            Leave
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main
        ref={mainRef}
        className={`flex-1 ${isCompactLayout ? 'flex flex-col overflow-y-auto p-2 sm:p-3 gap-2 sm:gap-3' : 'grid overflow-hidden p-4'} relative z-10`}
        style={isCompactLayout ? undefined : { gridTemplateColumns: `minmax(0,1fr) 8px ${rightPanelWidth}px`, gap: '8px' }}
      >
        {/* Single unified video player — LiveKit handles host publishing and audience subscribing */}
        <div className={`flex flex-col glass-panel rounded-2xl overflow-hidden relative group shadow-2xl min-w-0 ${isCompactLayout ? (isTinyPhone ? 'h-[30vh] min-h-[180px]' : 'h-[34vh] min-h-[210px]') : ''}`}>
          <LiveStream
            sessionId={sessionId}
            apiUrl={API_URL}
            role={role}
            userId={rtcUserId}
            isCameraOn={isCameraOn}
            isMuted={isMuted}
          />
          {/* Camera/mic control bar */}
          <div className={`absolute ${isCompactLayout ? 'bottom-2 left-1/2 -translate-x-1/2 px-2 py-2 gap-1.5 opacity-100' : 'bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 gap-4 opacity-0 group-hover:opacity-100'} glass-panel rounded-full flex transition-opacity duration-300 pointer-events-auto z-10`}>
            <button
              type="button"
              onClick={() => setIsMuted(p => !p)}
              className={`${isCompactLayout ? 'min-w-[68px] h-8 text-[10px]' : 'min-w-[90px] h-10 text-xs'} rounded-full flex items-center justify-center gap-1.5 transition-colors shadow-lg font-semibold ${isMuted ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-red-500 text-white hover:bg-red-600'}`}
            >
              {isMuted ? '🎙 Unmute' : '🔇 Mute'}
            </button>
            <button
              type="button"
              onClick={() => setIsCameraOn(p => !p)}
              className={`${isCompactLayout ? 'min-w-[90px] h-8 text-[10px]' : 'min-w-[120px] h-10 text-xs'} rounded-full bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.2)] flex items-center justify-center gap-1.5 transition-colors font-semibold`}
            >
              {isCameraOn ? '📷 Cam Off' : '📷 Cam On'}
            </button>
          </div>
        </div>

        {/* Drag divider (desktop only) */}
        {!isCompactLayout && (
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={() => { isResizingRef.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none' }}
            className="w-2 cursor-col-resize group flex items-center justify-center"
          >
            <div className="h-16 w-1 rounded-full bg-slate-300 group-hover:bg-blue-400 transition-colors" />
          </div>
        )}

        {/* Right panel — host dashboard or audience Q&A */}
        <div className={`h-full flex flex-col min-w-0 ${isCompactLayout ? (isTinyPhone ? 'min-h-[62vh]' : 'min-h-[58vh]') : ''}`}>
          {role === 'host' ? (
            <HostDashboard
              sessionId={sessionId}
              apiUrl={API_URL}
              hostToken={hostToken}
              currentUser={{ displayName, imageUrl: avatarUrl }}
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
