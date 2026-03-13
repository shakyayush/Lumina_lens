import { useState, useEffect } from 'react'

import HostDashboard from './components/HostDashboard'
import AudienceView from './components/AudienceView'
import WebCamVideo from './components/WebCamVideo'

const API_URL = `${window.location.protocol}//${window.location.hostname}:8000`

function App() {
  const [inMeeting, setInMeeting] = useState(false)
  const [role, setRole] = useState('audience') // 'audience' | 'host'
  const [sessionId, setSessionId] = useState('demo-session-42')
  const [isCameraOn, setIsCameraOn] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [isAiOrganizerOn, setIsAiOrganizerOn] = useState(false)
  
  // Fake starting a new session
  const startMeeting = async (selectedRole) => {
    try {
      await fetch(`${API_URL}/session/${sessionId}/start`, { method: 'POST' })
    } catch(e) {
      console.warn("Backend not running or CORS issue", e)
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
        
        <div className="glass-panel max-w-md w-full p-8 rounded-2xl animate-slide-in relative z-10 text-center">
          <div className="mb-8">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent inline-block mb-3">Lumina Lens</h1>
            <p className="text-sm text-[var(--text-secondary)]">AI-Powered Q&A Filter</p>
          </div>
          
          <div className="space-y-4">
            <div className="text-left">
              <label className="block text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2 font-semibold">Join As</label>
              <div className="flex gap-4">
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
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-main)] overflow-hidden">
      {/* Top Navbar */}
      <header className="h-14 glass-panel border-x-0 border-top-0 flex items-center justify-between px-6 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/30">L</div>
          <span className="font-semibold text-lg tracking-wide">Lumina Lens</span>
          <span className="ml-4 px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-bold uppercase tracking-wider border border-red-500/30 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
            Live
          </span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="text-sm px-4 py-1.5 rounded-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)]">
            <span className="text-[var(--text-secondary)] mr-2">Role:</span>
            <span className="font-semibold text-blue-400">{role === 'host' ? 'Host / Presenter' : 'Attendee'}</span>
          </div>
          <button onClick={() => setInMeeting(false)} className="text-sm text-red-400 hover:text-red-300 transition-colors">
            Leave
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex overflow-hidden p-4 gap-4 relative z-10">
        
        {/* Left Side: Video Feed */}
        <div className="flex-[7] flex flex-col glass-panel rounded-2xl overflow-hidden relative group shadow-2xl">
          <WebCamVideo isCameraOn={isCameraOn} />
          
          {/* Overlay Meeting Controls */}
          {role === 'host' && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 glass-panel rounded-full px-6 py-3 flex gap-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-auto">
               <button
                 type="button"
                 onClick={() => setIsMuted(prev => !prev)}
                 className={`min-w-[90px] h-10 rounded-full flex items-center justify-center transition-colors shadow-lg text-xs font-semibold uppercase tracking-wide ${
                   isMuted ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-red-500 text-white hover:bg-red-600'
                 }`}
               >
                  {isMuted ? 'Unmute' : 'Mute'}
               </button>
               <button
                 type="button"
                 onClick={() => setIsCameraOn(prev => !prev)}
                 className="min-w-[120px] h-10 rounded-full bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.2)] flex items-center justify-center transition-colors text-xs font-semibold uppercase tracking-wide"
               >
                  {isCameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
               </button>
               <button className="min-w-[110px] h-10 rounded-full bg-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.2)] flex items-center justify-center transition-colors text-xs font-semibold uppercase tracking-wide">
                  Share Screen
               </button>
            </div>
          )}
        </div>

        {/* Right Side: The Magic / Interactive Panel */}
        <div className="flex-[3] min-w-[360px] max-w-[420px] h-full flex flex-col">
          {role === 'host' ? (
            <HostDashboard
              sessionId={sessionId}
              apiUrl={API_URL}
              aiOrganizer={isAiOrganizerOn}
              setAiOrganizer={setIsAiOrganizerOn}
            />
          ) : (
            <AudienceView sessionId={sessionId} apiUrl={API_URL} aiOrganizer={isAiOrganizerOn} />
          )}
        </div>
        
      </main>
    </div>
  )
}

export default App
