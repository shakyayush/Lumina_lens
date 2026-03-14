import { useState, useEffect } from 'react'
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
  ControlBar,
  GridLayout,
  ParticipantTile,
  useTracks,
  AudioTrack,
  VideoTrack
} from '@livekit/components-react'
import '@livekit/components-styles'
import { Track } from 'livekit-client'

export default function LiveStream({ sessionId, apiUrl, role, userId, hostName }) {
  const [token, setToken] = useState(null)
  const [wsUrl, setWsUrl] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    
    async function fetchToken() {
      try {
        const res = await fetch(`${apiUrl}/session/${sessionId}/rtc-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, role })
        })
        
        const data = await res.json()
        
        if (!res.ok) {
          throw new Error(data.detail || 'Failed to get stream token')
        }
        
        if (mounted) {
          setToken(data.token)
          setWsUrl(data.ws_url)
        }
      } catch (e) {
        if (mounted) setError(e.message)
      }
    }
    
    fetchToken()
    
    return () => { mounted = false }
  }, [sessionId, apiUrl, role, userId])

  if (error) {
    return (
      <div className="bg-red-500/10 text-red-400 p-4 border border-red-500/20 rounded-xl text-center text-sm">
        Video Stream Error: {error}
      </div>
    )
  }

  if (!token || !wsUrl) {
    return (
      <div className="bg-slate-800/50 p-6 rounded-xl text-center border border-slate-700/50 animate-pulse">
        <p className="text-slate-400 font-medium text-sm">Connecting to secure stream...</p>
      </div>
    )
  }

  return (
    <LiveKitRoom
      video={role === 'host'}
      audio={role === 'host'}
      token={token}
      serverUrl={wsUrl}
      data-lk-theme="default"
      className={`rounded-2xl overflow-hidden shadow-2xl border border-[var(--border-subtle)] bg-black/40 ${role === 'host' ? 'h-[300px] sm:h-[400px]' : 'h-full aspect-video'}`}
    >
      {role === 'host' ? (
        // Host gets the full control bar to mute/unmute and stop video
        <div className="relative h-full w-full flex flex-col">
          <div className="absolute top-4 left-4 z-10 bg-black/60 backdrop-blur px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white text-xs font-bold tracking-wide">BROADCASTING</span>
          </div>
          <div className="flex-1 min-h-0">
             <VideoConference />
          </div>
        </div>
      ) : (
        // Audience only watches the stream passively
        <AudienceStreamReceiver hostName={hostName} />
      )}
      {/* Required to render audio tracks for the audience */}
      <RoomAudioRenderer />
    </LiveKitRoom>
  )
}

// Custom component to just render the host's video feed for the audience
function AudienceStreamReceiver({ hostName }) {
  // Find camera tracks published by other users (the host)
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  
  return (
    <div className="relative w-full h-full bg-slate-900 flex justify-center items-center">
      {tracks.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 text-center animate-pulse">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4 border border-slate-700">
             <span className="text-2xl opacity-50">📷</span>
          </div>
          <p className="text-slate-400 font-medium tracking-wide">Waiting for host to share video...</p>
        </div>
      ) : (
        <GridLayout tracks={tracks} style={{ height: '100%', width: '100%' }}>
          <ParticipantTile />
        </GridLayout>
      )}
      
      {/* Overlay label */}
      <div className="absolute bottom-4 left-4 z-10 bg-black/60 backdrop-blur px-3 py-1.5 rounded-lg border border-white/10 flex items-center gap-2 max-w-[80%]">
        <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Host</span>
        <span className="text-xs text-white font-medium truncate">{hostName || 'Streaming'}</span>
      </div>
    </div>
  )
}
