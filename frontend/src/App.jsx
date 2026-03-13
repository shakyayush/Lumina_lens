import { useState, useEffect, useRef } from 'react'

import HostDashboard from './components/HostDashboard'
import AudienceView from './components/AudienceView'
import WebCamVideo from './components/WebCamVideo'

// Prefer environment variable for deployed environments (Base44, etc.),
// but fall back to local backend in dev.
const API_URL =
  import.meta.env.VITE_API_URL ||
  `${window.location.protocol}//${window.location.hostname}:8000`

function App() {
  const [inMeeting, setInMeeting] = useState(false)
  const [role, setRole] = useState('audience')
  const [hostToken, setHostToken] = useState(null) // Secret issued by server to host only
  const [sessionId, setSessionId] = useState(() => {
    // Remember last meeting code on this device for convenience.
    return window.localStorage.getItem('lumina_meeting_id') || ''
  })
  const [isCameraOn, setIsCameraOn] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [rightPanelWidth, setRightPanelWidth] = useState(420)
  const [isCompactLayout, setIsCompactLayout] = useState(window.innerWidth < 1024)
  const [isTinyPhone, setIsTinyPhone] = useState(window.innerWidth < 390 || window.innerHeight < 700)
  const [isPhone, setIsPhone] = useState(window.innerWidth < 640)
  const [rtcUserId] = useState(() => {
    const key = 'lumina_rtc_user_id'
    const existing = window.localStorage.getItem(key)
    if (existing) return existing
    // Use crypto.randomUUID() for guaranteed uniqueness (no collision risk)
    const created = 'rtc_' + (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2))
    window.localStorage.setItem(key, created)
    return created
  })
  const mainRef = useRef(null)
  const isResizingRef = useRef(false)

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
      const minRight = 320
      const maxRight = Math.min(700, rect.width - 320)
      const proposed = rect.right - e.clientX
      const clamped = Math.max(minRight, Math.min(maxRight, proposed))
      setRightPanelWidth(clamped)
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
  
  const startMeeting = async (selectedRole) => {
    let targetId = (sessionId || '').trim()

    // If host starts without a code, auto-generate one they can share.
    if (selectedRole === 'host' && !targetId) {
      const freshId = `room-${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)}`
      targetId = freshId
      setSessionId(freshId)
      window.localStorage.setItem('lumina_meeting_id', freshId)
    }

    // Audience (or host) must have a meeting code.
    if (!targetId) {
      alert('Enter a meeting code first.')
      return
    }

    try {
      const res = await fetch(`${API_URL}/session/${targetId}/start?role=${selectedRole}`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        // Server returns host_token only for the host role — store it for star requests
        if (data.host_token) setHostToken(data.host_token)
      }
    } catch(e) {
      console.warn('Backend not running or CORS issue', e)
    }
    setRole(selectedRole)
    setInMeeting(true)
  }

  if (!inMeeting) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none"></div>
        
        <div className="glass-panel max-w-md w-full p-5 sm:p-8 rounded-2xl animate-slide-in relative z-10 text-center">
          <div className="mb-6 sm:mb-8">
            <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent inline-block mb-3">Lumina Lens</h1>
            <p className="text-sm text-[var(--text-secondary)]">AI-Powered Q&A Filter</p>
          </div>
          
          <div className="space-y-4">
            <div className="text-left space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2 font-semibold">Meeting code</label>
                <input
                  type="text"
                  value={sessionId}
                  onChange={e => setSessionId(e.target.value)}
                  placeholder="e.g. room-abc123 or your custom name"
                  className="w-full glass-input rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2 font-semibold">Join As</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <button 
                  onClick={() => startMeeting('audience')}
                  className="flex-1 bg-[rgba(255,255,255,0.03)] border border-[var(--border-subtle)] hover:border-blue-500/50 hover:bg-blue-500/10 py-3 rounded-xl transition-all font-medium"
                >
                  👀 Audience
                </button>
                <button 
                  onClick={() => startMeeting('host')}
                  className="flex-1 btn-primary py-3 rounded-xl animate-pulse-glow"
                >
                  🎤 Host
                </button>
                </div>
              </div>
            </div>
            
            <div className="pt-4 mt-6 border-t border-[var(--border-subtle)]">
                <p className="text-xs text-[var(--text-secondary)] text-left flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block animate-pulse"></span>
                  Ready for live Q&amp;A session
                </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`h-screen w-screen flex flex-col bg-[var(--bg-main)] ${isCompactLayout ? 'overflow-auto' : 'overflow-hidden'}`}>
      {/* Top Navbar */}
      <header className={`glass-panel border-x-0 border-top-0 flex items-center justify-between z-20 ${isCompactLayout ? 'h-12 px-3' : 'h-14 px-6'}`}>
        <div className={`flex items-center ${isCompactLayout ? 'gap-2 min-w-0' : 'gap-3'}`}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/30">L</div>
          <span className={`${isCompactLayout ? 'font-semibold text-sm truncate' : 'font-semibold text-lg tracking-wide'} ${isTinyPhone ? 'max-w-[110px]' : ''}`}>Lumina Lens</span>
          <span className={`${isCompactLayout ? 'hidden lg:flex ml-2' : 'ml-4'} px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-bold uppercase tracking-wider border border-red-500/30 items-center gap-2`}>
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
            Live
          </span>
        </div>
        
        <div className={`flex items-center ${isCompactLayout ? 'gap-2' : 'gap-4'}`}>
          <div className={`${isCompactLayout ? 'hidden' : 'text-sm px-4 py-1.5'} rounded-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)]`}>
            <span className="text-[var(--text-secondary)] mr-2">Role:</span>
            <span className="font-semibold text-blue-400">{role === 'host' ? 'Host / Presenter' : 'Attendee'}</span>
            <span className="ml-3 text-xs text-slate-400 font-mono truncate max-w-[160px]">ID: {sessionId}</span>
          </div>
          <button
            onClick={async () => {
              // Notify server so the RTC slot is freed
              try {
                const identity = role === 'host' ? `host_${sessionId}` : `audience_${rtcUserId}`
                await fetch(
                  `${API_URL}/session/${sessionId}/rtc-presence?identity=${encodeURIComponent(identity)}&state=leave`,
                  { method: 'POST' }
                )
              } catch (e) {
                console.warn('Failed to send leave presence', e)
              }
              setInMeeting(false)
            }}
            className={`${isCompactLayout ? 'text-xs px-2 py-1 rounded border border-red-400/30' : 'text-sm'} text-red-400 hover:text-red-300 transition-colors`}
          >
            Leave
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        ref={mainRef}
        className={`flex-1 ${isCompactLayout ? 'flex flex-col overflow-y-auto p-2 sm:p-3 gap-2 sm:gap-3' : 'grid overflow-hidden p-4'} relative z-10`}
        style={isCompactLayout ? undefined : { gridTemplateColumns: `minmax(0,1fr) 8px ${rightPanelWidth}px`, gap: '8px' }}
      >
        
        {/* Left Side: Video Feed */}
        <div className={`flex flex-col glass-panel rounded-2xl overflow-hidden relative group shadow-2xl min-w-0 ${isCompactLayout ? (isTinyPhone ? 'h-[30vh] min-h-[180px]' : 'h-[34vh] min-h-[210px]') : ''}`}>
          <WebCamVideo
            isCameraOn={isCameraOn}
            isMuted={isMuted}
            sessionId={sessionId}
            apiUrl={API_URL}
            role={role}
            rtcUserId={rtcUserId}
            enableMultimodal={role === 'host'}
          />
          
          {/* Overlay Meeting Controls */}
          {(
            <div className={`absolute ${isCompactLayout ? 'bottom-2 left-1/2 -translate-x-1/2 px-2 py-2 gap-1.5 opacity-100' : 'bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 gap-6 opacity-0 group-hover:opacity-100'} glass-panel rounded-full flex transition-opacity duration-300 pointer-events-auto`}>
               <button
                 type="button"
                 onClick={() => setIsMuted(prev => !prev)}
                 className={`${isCompactLayout ? 'min-w-[68px] h-8 text-[10px]' : 'min-w-[90px] h-10 text-xs'} rounded-full flex items-center justify-center transition-colors shadow-lg font-semibold uppercase tracking-wide ${
                   isMuted ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-red-500 text-white hover:bg-red-600'
                 }`}
               >
                  {isMuted ? 'Unmute' : 'Mute'}
               </button>
               <button
                 type="button"
                 onClick={() => setIsCameraOn(prev => !prev)}
                 className={`${isCompactLayout ? 'min-w-[90px] h-8 text-[10px]' : 'min-w-[120px] h-10 text-xs'} rounded-full bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.2)] flex items-center justify-center transition-colors font-semibold uppercase tracking-wide`}
               >
                  {isCameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
               </button>
               {role === 'host' && (
                 <button className={`${isCompactLayout ? (isTinyPhone ? 'hidden' : 'min-w-[84px] h-8 text-[10px]') : 'min-w-[110px] h-10 text-xs'} rounded-full bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.2)] flex items-center justify-center transition-colors font-semibold uppercase tracking-wide`}>
                    Share Screen
                 </button>
               )}
            </div>
          )}
        </div>

        {/* Draggable divider between video and inbox */}
        {!isCompactLayout && (
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={() => {
            isResizingRef.current = true
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
          }}
          className="w-2 cursor-col-resize group flex items-center justify-center"
          title="Drag to resize panels"
        >
          <div className="h-16 w-1 rounded-full bg-slate-300 group-hover:bg-blue-400 transition-colors" />
        </div>
        )}

        {/* Right Side: The Magic / Interactive Panel */}
        <div className={`h-full flex flex-col min-w-0 ${isCompactLayout ? (isTinyPhone ? 'min-h-[62vh]' : 'min-h-[58vh]') : ''}`}>
          {role === 'host' ? (
            <HostDashboard
              sessionId={sessionId}
              apiUrl={API_URL}
              hostToken={hostToken}
            />
          ) : (
            <AudienceView sessionId={sessionId} apiUrl={API_URL} />
          )}
        </div>
        
      </main>
    </div>
  )
}

export default App
