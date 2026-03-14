import { useRef, useEffect, useState, useCallback } from 'react'

/**
 * WebCamVideo
 * -----------
 * Real-time camera and microphone using the browser's native getUserMedia API.
 * LiveKit RTC is attempted first for multi-participant support; if unavailable
 * (no RTC_PROVIDER_URL configured), falls back to direct getUserMedia — so
 * camera and mic always work in local dev without any external service.
 */

const WebCamVideo = ({
  isCameraOn,
  isMuted,
  sessionId,
  apiUrl,
  role,
  rtcUserId,
  enableMultimodal = false,
}) => {
  const videoRef = useRef(null)
  const remoteTracksRef = useRef(null)
  const streamRef = useRef(null)        // Local MediaStream (getUserMedia)
  const roomRef = useRef(null)          // LiveKit room (if available)
  const speechRecognitionRef = useRef(null)
  const transcriptQueueRef = useRef([])
  const frameIntervalRef = useRef(null)
  const transcriptIntervalRef = useRef(null)
  const fpsIntervalRef = useRef(null)
  const restartedByUsRef = useRef(false)
  const [isConnected, setIsConnected] = useState(false)
  const [usingNative, setUsingNative] = useState(false) // true = native getUserMedia mode

  // ── Multimodal context push ──────────────────────────────────────────────
  const postMultimodal = useCallback(async ({ transcript = null, frameDataUrl = null, frameRate = null }) => {
    if (!enableMultimodal || !sessionId || !apiUrl) return
    if (!transcript && !frameDataUrl && frameRate == null) return
    try {
      await fetch(`${apiUrl}/session/${sessionId}/multimodal-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, frame_data_url: frameDataUrl, frame_rate: frameRate }),
      })
    } catch (err) {
      console.debug('Multimodal push failed', err)
    }
  }, [enableMultimodal, sessionId, apiUrl])

  // ── Native getUserMedia helpers ──────────────────────────────────────────
  const stopNativeStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  const startNativeStream = useCallback(async (wantCamera, wantMic) => {
    stopNativeStream()
    if (!wantCamera && !wantMic) return
    try {
      const constraints = {
        video: wantCamera ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
        audio: wantMic,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true // prevent echo
      }
      setIsConnected(true)
    } catch (err) {
      console.warn('getUserMedia failed:', err.message)
      // Camera/mic permission denied or hardware issue
      setIsConnected(false)
    }
  }, [stopNativeStream])

  // ── Update audio/video tracks on existing native stream ──────────────────
  const applyNativeTrackState = useCallback(async (wantCamera, wantMic) => {
    // If stream not started, start it
    if (!streamRef.current) {
      await startNativeStream(wantCamera, wantMic)
      return
    }
    // Toggle existing video tracks
    streamRef.current.getVideoTracks().forEach(t => { t.enabled = wantCamera })
    // Toggle existing audio tracks
    streamRef.current.getAudioTracks().forEach(t => { t.enabled = wantMic })

    // If camera was turned on but no video track exists yet, restart stream
    const hasVideo = streamRef.current.getVideoTracks().length > 0
    const hasAudio = streamRef.current.getAudioTracks().length > 0
    if ((wantCamera && !hasVideo) || (wantMic && !hasAudio)) {
      await startNativeStream(wantCamera, wantMic)
    }
  }, [startNativeStream])

  // ── LiveKit connect (optional – only if server configured) ───────────────
  const connectLiveKit = useCallback(async () => {
    try {
      const { Room, RoomEvent, Track } = await import('livekit-client')
      const tokenRes = await fetch(`${apiUrl}/session/${sessionId}/rtc-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, user_id: rtcUserId }),
      })
      if (!tokenRes.ok) throw new Error('Token request failed')
      const tokenData = await tokenRes.json()
      if (!tokenData.ws_url || tokenData.ws_url.includes('your-livekit')) {
        throw new Error('LiveKit not configured')
      }

      const room = new Room({ adaptiveStream: true, dynacast: true })
      roomRef.current = room

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Video || !remoteTracksRef.current) return
        const el = track.attach()
        el.className = 'w-28 h-20 rounded-lg object-cover border border-white/20 bg-black/50'
        el.setAttribute('playsinline', 'true')
        el.muted = true
        remoteTracksRef.current.appendChild(el)
      })
      room.on(RoomEvent.Disconnected, () => setIsConnected(false))

      await room.connect(tokenData.ws_url, tokenData.token)
      await room.localParticipant.setMicrophoneEnabled(!isMuted)
      await room.localParticipant.setCameraEnabled(isCameraOn)
      setIsConnected(true)
      return true // LiveKit connected successfully
    } catch (err) {
      console.info('LiveKit unavailable, using native getUserMedia:', err.message)
      return false
    }
  }, [apiUrl, sessionId, role, rtcUserId, isCameraOn, isMuted])

  // ── Initialise connection on mount ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    const init = async () => {
      const lkSuccess = await connectLiveKit()
      if (cancelled) return
      if (!lkSuccess) {
        setUsingNative(true)
        // Start native stream with whatever the current toggle states are
        await startNativeStream(isCameraOn, !isMuted)
      }
    }
    init()

    return () => {
      cancelled = true
      // Cleanup LiveKit
      if (roomRef.current) {
        roomRef.current.disconnect()
        roomRef.current = null
      }
      // Cleanup native stream
      stopNativeStream()
      setIsConnected(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, sessionId, role, rtcUserId])

  // ── React to camera/mic toggle changes ───────────────────────────────────
  useEffect(() => {
    if (usingNative) {
      // Native path: toggle track enabled state
      applyNativeTrackState(isCameraOn, !isMuted)
    } else if (roomRef.current && roomRef.current.state === 'connected') {
      // LiveKit path
      roomRef.current.localParticipant.setMicrophoneEnabled(!isMuted).catch(() => {})
      roomRef.current.localParticipant.setCameraEnabled(isCameraOn).catch(() => {})
    }
  }, [isCameraOn, isMuted, usingNative, applyNativeTrackState])

  // ── Speech recognition (for host multimodal context) ─────────────────────
  useEffect(() => {
    const stop = () => {
      restartedByUsRef.current = false
      try { speechRecognitionRef.current?.stop() } catch (err) { console.debug('Stop warning', err) }
      speechRecognitionRef.current = null
    }

    if (!enableMultimodal || isMuted) { stop(); return }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return

    stop()
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += (e.results[i][0]?.transcript || '') + ' '
      }
      if (final.trim()) transcriptQueueRef.current.push(final.trim())
    }
    rec.onend = () => {
      if (restartedByUsRef.current && !isMuted && enableMultimodal) {
        try { rec.start() } catch (err) { console.debug('Start warning', err) }
      }
    }
    try {
      restartedByUsRef.current = true
      rec.start()
      speechRecognitionRef.current = rec
    } catch (err) {
      console.debug('Recognition start error', err)
    }

    return stop
  }, [isMuted, enableMultimodal])

  // ── Frame / FPS / transcript loops for multimodal context ────────────────
  useEffect(() => {
    const stopFrame = () => { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null }
    const stopFps = () => { clearInterval(fpsIntervalRef.current); fpsIntervalRef.current = null }
    const stopTranscript = () => { clearInterval(transcriptIntervalRef.current); transcriptIntervalRef.current = null }

    if (enableMultimodal && isCameraOn && isConnected) {
      frameIntervalRef.current = setInterval(async () => {
        const video = videoRef.current
        if (!video || video.readyState < 2 || !video.videoWidth) return
        const canvas = document.createElement('canvas')
        canvas.width = Math.min(video.videoWidth, 640)
        canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth))
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const frameDataUrl = canvas.toDataURL('image/jpeg', 0.72)
        const track = streamRef.current?.getVideoTracks?.()[0]
        const frameRate = Number(track?.getSettings?.().frameRate || 0) || null
        await postMultimodal({ frameDataUrl, frameRate })
      }, 12000)

      fpsIntervalRef.current = setInterval(async () => {
        const track = streamRef.current?.getVideoTracks?.()[0]
        const frameRate = Number(track?.getSettings?.().frameRate || 0) || null
        if (frameRate) await postMultimodal({ frameRate })
      }, 2000)
    }

    if (enableMultimodal && isConnected) {
      transcriptIntervalRef.current = setInterval(async () => {
        if (!transcriptQueueRef.current.length) return
        const transcript = transcriptQueueRef.current.splice(0).join(' ').trim()
        if (transcript) await postMultimodal({ transcript })
      }, 6000)
    }

    return () => { stopFrame(); stopFps(); stopTranscript() }
  }, [isCameraOn, isConnected, enableMultimodal, postMultimodal])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-cover transition-opacity duration-300 ${isCameraOn ? 'opacity-100' : 'opacity-0'}`}
        style={{ transform: 'scaleX(-1)' }} // Mirror self-view
      />

      {/* Remote participant video tiles (LiveKit only) */}
      <div ref={remoteTracksRef} className="absolute bottom-3 left-3 right-3 flex gap-2 overflow-x-auto pb-1" />

      {/* Camera-off placeholder */}
      {!isCameraOn && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950">
          <div className="text-center px-6 py-4 rounded-2xl border border-white/10 bg-white/5">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 mx-auto mb-3 flex items-center justify-center text-2xl font-bold text-white">
              {role === 'host' ? '🎤' : '👤'}
            </div>
            <p className="text-slate-300 text-sm font-medium">Camera is off</p>
            <p className="text-slate-500 text-xs mt-1">Click "Turn Camera On" below</p>
          </div>
        </div>
      )}

      {/* Live indicator */}
      {isCameraOn && (
        <div className="absolute top-3 right-3 bg-red-600/90 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-lg">
          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
          {enableMultimodal ? (isMuted ? 'Video Live' : 'Audio + Video') : 'Live'}
        </div>
      )}

      {/* Mic muted indicator */}
      {!isMuted && isCameraOn && (
        <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm text-green-400 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
          Mic On
        </div>
      )}
      {isMuted && isCameraOn && (
        <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm text-red-400 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5">
          🔇 Muted
        </div>
      )}
    </div>
  )
}

export default WebCamVideo
