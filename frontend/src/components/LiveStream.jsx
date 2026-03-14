import { useState, useEffect } from 'react'
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
  GridLayout,
  ParticipantTile,
  useTracks,
} from '@livekit/components-react'
import '@livekit/components-styles'
import { Track } from 'livekit-client'

/**
 * LiveStream — unified LiveKit video component for both host and audience.
 *
 * Props:
 *  sessionId   — meeting room ID
 *  apiUrl      — backend base URL
 *  role        — 'host' | 'audience'
 *  userId      — user identifier sent to the token endpoint
 *  isCameraOn  — whether the camera is on (host only; audience always false)
 *  isMuted     — whether the microphone is muted
 */
export default function LiveStream({
  sessionId,
  apiUrl,
  role,
  userId,
  isCameraOn = false,
  isMuted = true,
}) {
  const [token, setToken]   = useState(null)
  const [wsUrl, setWsUrl]   = useState(null)
  const [error, setError]   = useState(null)
  const [roomKey, setRoomKey] = useState(0) // bump to reconnect

  // Fetch a fresh LiveKit token when session/role/user changes
  // Auto-retries up to 3 times (backend may be cold-starting on free tier)
  useEffect(() => {
    let mounted = true
    setToken(null)
    setWsUrl(null)
    setError(null)

    async function fetchTokenWithRetry() {
      const MAX_ATTEMPTS = 3
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const controller = new AbortController()
          const to = setTimeout(() => controller.abort(), 20000)
          const res = await fetch(`${apiUrl}/session/${sessionId}/rtc-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, role }),
            signal: controller.signal,
          })
          clearTimeout(to)
          const data = await res.json()
          if (!res.ok) throw new Error(data.detail || 'Failed to get stream token')
          if (mounted) {
            setToken(data.token)
            setWsUrl(data.ws_url)
            setRoomKey(k => k + 1)
          }
          return // success
        } catch (e) {
          if (!mounted) return
          if (attempt < MAX_ATTEMPTS) {
            await new Promise(r => setTimeout(r, 8000)) // wait 8s before retry
          } else {
            if (mounted) setError(e.message)
          }
        }
      }
    }

    fetchTokenWithRetry()
    return () => { mounted = false }
  }, [sessionId, apiUrl, role, userId])


  // ── Error state ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-900 rounded-2xl">
        <div className="text-center p-4">
          <p className="text-red-400 text-sm font-medium">⚠️ Stream unavailable</p>
          <p className="text-slate-500 text-xs mt-1">{error}</p>
          <button
            onClick={() => { setError(null); setToken(null) }}
            className="mt-3 text-xs text-blue-400 hover:text-blue-300 underline"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // ── Loading state ────────────────────────────────────────────────────────
  if (!token || !wsUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-900 rounded-2xl">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-xs">Connecting to meeting room…</p>
        </div>
      </div>
    )
  }

  // ── Connected ────────────────────────────────────────────────────────────
  return (
    <LiveKitRoom
      key={roomKey}
      token={token}
      serverUrl={wsUrl}
      // Host publishes camera+mic controlled by the toolbar; audience just listens
      video={role === 'host' ? isCameraOn : false}
      audio={role === 'host' ? !isMuted : false}
      data-lk-theme="default"
      className="w-full h-full relative"
      onDisconnected={() => {
        // Clear token so loading state shows and reconnect can happen
        setToken(null)
        setWsUrl(null)
      }}
    >
      {role === 'host' ? (
        <HostView isCameraOn={isCameraOn} isMuted={isMuted} />
      ) : (
        <AudienceView />
      )}
      {/* Plays remote audio tracks for the audience */}
      <RoomAudioRenderer />
    </LiveKitRoom>
  )
}

// ── Host view: shows own video feed via VideoConference ─────────────────────
function HostView({ isCameraOn, isMuted }) {
  return (
    <div className="relative w-full h-full bg-slate-900">
      {/* LiveKit's built-in conference UI — handles local track publishing */}
      <VideoConference />

      {/* Broadcasting badge */}
      {isCameraOn && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-red-600/90 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1.5 rounded-full shadow-lg pointer-events-none">
          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
          LIVE
        </div>
      )}

      {/* Camera-off placeholder */}
      {!isCameraOn && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 z-10">
          <div className="text-center px-6 py-4 rounded-2xl border border-white/10 bg-white/5">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 mx-auto mb-3 flex items-center justify-center text-xl">🎤</div>
            <p className="text-slate-300 text-sm font-medium">Camera is off</p>
            <p className="text-slate-500 text-xs mt-1">Use the toolbar below to turn it on</p>
            {!isMuted && (
              <div className="mt-2 flex items-center justify-center gap-1.5 text-green-400 text-xs">
                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                Mic is live
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Audience view: subscribes to host tracks and renders them ───────────────
function AudienceView() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )

  return (
    <div className="relative w-full h-full bg-slate-900">
      {tracks.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 animate-pulse">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4 border border-slate-700">
            <span className="text-2xl opacity-50">📡</span>
          </div>
          <p className="text-slate-400 text-sm font-medium">Waiting for host to broadcast…</p>
          <p className="text-slate-600 text-xs mt-1">The host needs to turn on their camera</p>
        </div>
      ) : (
        <GridLayout tracks={tracks} style={{ height: '100%', width: '100%' }}>
          <ParticipantTile />
        </GridLayout>
      )}

      {/* Label */}
      <div className="absolute bottom-3 left-3 z-10 bg-black/60 backdrop-blur-sm px-3 py-1 rounded-lg border border-white/10 flex items-center gap-2 pointer-events-none">
        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
        <span className="text-[10px] text-slate-300 font-semibold uppercase tracking-wider">Live Stream</span>
      </div>
    </div>
  )
}
