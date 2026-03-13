import { useRef, useEffect, useState } from 'react'
import { Room, RoomEvent, Track } from 'livekit-client'

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
  const streamRef = useRef(null)
  const roomRef = useRef(null)
  const identityRef = useRef('')
  const localVideoTrackRef = useRef(null)
  const remoteElementsRef = useRef(new Map())
  const speechRecognitionRef = useRef(null)
  const transcriptQueueRef = useRef([])
  const frameIntervalRef = useRef(null)
  const transcriptIntervalRef = useRef(null)
  const fpsIntervalRef = useRef(null)
  const restartedByUsRef = useRef(false)
  const [isConnected, setIsConnected] = useState(false)

  const postMultimodal = async ({ transcript = null, frameDataUrl = null, frameRate = null }) => {
    if (!enableMultimodal || !sessionId || !apiUrl) return
    if (!transcript && !frameDataUrl && frameRate == null) return
    try {
      await fetch(`${apiUrl}/session/${sessionId}/multimodal-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript,
          frame_data_url: frameDataUrl,
          frame_rate: frameRate,
        }),
      })
    } catch (err) {
      console.debug('Multimodal context push failed', err)
    }
  }

  const updatePresence = async (state) => {
    if (!identityRef.current) return
    try {
      await fetch(
        `${apiUrl}/session/${sessionId}/rtc-presence?identity=${encodeURIComponent(identityRef.current)}&state=${state}`,
        { method: 'POST' }
      )
    } catch (err) {
      console.debug('RTC presence update failed', err)
    }
  }

  const attachLocalVideoTrack = (track) => {
    localVideoTrackRef.current = track || null
    if (!track || !videoRef.current) return
    track.attach(videoRef.current)
    const mediaTrack = track.mediaStreamTrack
    streamRef.current = mediaTrack ? new MediaStream([mediaTrack]) : null
  }

  const detachLocalVideoTrack = () => {
    if (localVideoTrackRef.current && videoRef.current) {
      localVideoTrackRef.current.detach(videoRef.current)
    }
    localVideoTrackRef.current = null
    streamRef.current = null
  }

  useEffect(() => {
    let isCancelled = false

    const clearRemoteElements = () => {
      for (const [, item] of remoteElementsRef.current.entries()) {
        try {
          item.track.detach(item.el)
        } catch (e) {}
        item.el.remove()
      }
      remoteElementsRef.current.clear()
    }

    const attachRemoteTrack = (track, publication) => {
      if (track.kind !== Track.Kind.Video || !remoteTracksRef.current) return
      const key = publication?.trackSid || `${Date.now()}_${Math.random()}`
      if (remoteElementsRef.current.has(key)) return
      const el = track.attach()
      el.className = 'w-28 h-20 rounded-lg object-cover border border-white/20 bg-black/50'
      el.setAttribute('playsinline', 'true')
      el.muted = true
      remoteTracksRef.current.appendChild(el)
      remoteElementsRef.current.set(key, { el, track })
    }

    const detachRemoteTrack = (track, publication) => {
      const key = publication?.trackSid
      if (!key || !remoteElementsRef.current.has(key)) return
      const item = remoteElementsRef.current.get(key)
      try {
        track.detach(item.el)
      } catch (e) {}
      item.el.remove()
      remoteElementsRef.current.delete(key)
    }

    const getAndAttachCurrentLocalTrack = (room) => {
      const pubs = Array.from(room.localParticipant.videoTrackPublications.values())
      const camPub = pubs.find(pub => pub.source === Track.Source.Camera)
      if (camPub?.track) {
        attachLocalVideoTrack(camPub.track)
      } else {
        detachLocalVideoTrack()
      }
    }

    const connectRoom = async () => {
      if (!sessionId || !apiUrl) return
      try {
        const tokenRes = await fetch(`${apiUrl}/session/${sessionId}/rtc-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role,
            user_id: rtcUserId,
          }),
        })
        if (!tokenRes.ok) {
          console.warn('RTC token request failed')
          return
        }
        const tokenData = await tokenRes.json()
        if (isCancelled) return

        identityRef.current = tokenData.identity
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
        })
        roomRef.current = room

        room.on(RoomEvent.TrackSubscribed, (track, publication) => attachRemoteTrack(track, publication))
        room.on(RoomEvent.TrackUnsubscribed, (track, publication) => detachRemoteTrack(track, publication))
        room.on(RoomEvent.LocalTrackPublished, (publication) => {
          if (publication.source === Track.Source.Camera && publication.track) {
            attachLocalVideoTrack(publication.track)
          }
        })
        room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
          if (publication.source === Track.Source.Camera) {
            detachLocalVideoTrack()
          }
        })
        room.on(RoomEvent.Disconnected, () => {
          setIsConnected(false)
          clearRemoteElements()
          detachLocalVideoTrack()
        })

        await room.connect(tokenData.ws_url, tokenData.token)
        await updatePresence('join')
        setIsConnected(true)
        await room.localParticipant.setMicrophoneEnabled(!isMuted)
        await room.localParticipant.setCameraEnabled(isCameraOn)
        getAndAttachCurrentLocalTrack(room)
      } catch (err) {
        console.warn('RTC connect failed', err)
      }
    }

    connectRoom()
    return () => {
      isCancelled = true
      updatePresence('leave')
      clearRemoteElements()
      detachLocalVideoTrack()
      if (roomRef.current) {
        roomRef.current.disconnect()
        roomRef.current = null
      }
      setIsConnected(false)
    }
  }, [apiUrl, sessionId, role, rtcUserId])

  useEffect(() => {
    const applyTrackState = async () => {
      const room = roomRef.current
      if (!room || room.state !== 'connected') return
      try {
        await room.localParticipant.setMicrophoneEnabled(!isMuted)
        await room.localParticipant.setCameraEnabled(isCameraOn)
        const pubs = Array.from(room.localParticipant.videoTrackPublications.values())
        const camPub = pubs.find(pub => pub.source === Track.Source.Camera)
        if (camPub?.track) attachLocalVideoTrack(camPub.track)
        if (!isCameraOn) detachLocalVideoTrack()
      } catch (err) {
        console.warn('Track state update failed', err)
      }
    }
    applyTrackState()
  }, [isMuted, isCameraOn])

  useEffect(() => {
    const stopSpeech = () => {
      if (speechRecognitionRef.current) {
        restartedByUsRef.current = false
        try {
          speechRecognitionRef.current.stop()
        } catch (e) {}
        speechRecognitionRef.current = null
      }
    }

    const startSpeech = () => {
      if (!enableMultimodal || isMuted) {
        stopSpeech()
        return
      }
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      if (!SpeechRecognition) return

      stopSpeech()
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'

      recognition.onresult = (event) => {
        let finalText = ''
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i]
          if (result.isFinal) {
            finalText += (result[0]?.transcript || '') + ' '
          }
        }
        if (finalText.trim()) transcriptQueueRef.current.push(finalText.trim())
      }

      recognition.onend = () => {
        if (restartedByUsRef.current && !isMuted && enableMultimodal) {
          try {
            recognition.start()
          } catch (e) {}
        }
      }

      try {
        restartedByUsRef.current = true
        recognition.start()
        speechRecognitionRef.current = recognition
      } catch (e) {}
    }

    const stopFrameLoop = () => {
      if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current)
        frameIntervalRef.current = null
      }
    }

    const startFrameLoop = () => {
      stopFrameLoop()
      if (!enableMultimodal || !isCameraOn || !isConnected) return
      frameIntervalRef.current = setInterval(async () => {
        const video = videoRef.current
        if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return
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
    }

    const stopFpsLoop = () => {
      if (fpsIntervalRef.current) {
        clearInterval(fpsIntervalRef.current)
        fpsIntervalRef.current = null
      }
    }

    const startFpsLoop = () => {
      stopFpsLoop()
      if (!enableMultimodal || !isCameraOn || !isConnected) return
      fpsIntervalRef.current = setInterval(async () => {
        const track = streamRef.current?.getVideoTracks?.()[0]
        const frameRate = Number(track?.getSettings?.().frameRate || 0) || null
        if (frameRate) await postMultimodal({ frameRate })
      }, 2000)
    }

    const startTranscriptFlushLoop = () => {
      if (transcriptIntervalRef.current) clearInterval(transcriptIntervalRef.current)
      if (!enableMultimodal || !isConnected) return
      transcriptIntervalRef.current = setInterval(async () => {
        if (!transcriptQueueRef.current.length) return
        const transcript = transcriptQueueRef.current.splice(0).join(' ').trim()
        if (!transcript) return
        await postMultimodal({ transcript })
      }, 6000)
    }

    startSpeech()
    startFrameLoop()
    startFpsLoop()
    startTranscriptFlushLoop()

    return () => {
      stopSpeech()
      stopFrameLoop()
      stopFpsLoop()
      if (transcriptIntervalRef.current) {
        clearInterval(transcriptIntervalRef.current)
        transcriptIntervalRef.current = null
      }
    }
  }, [isCameraOn, isMuted, isConnected, sessionId, apiUrl, enableMultimodal])

  return (
    <div className="relative w-full h-full bg-white flex items-center justify-center">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-cover mirror transition-opacity duration-300 ${isCameraOn ? 'opacity-100' : 'opacity-0'}`}
      />

      <div ref={remoteTracksRef} className="absolute bottom-3 left-3 right-3 flex gap-2 overflow-x-auto pb-1" />

      {!isCameraOn && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-blue-50 via-slate-50 to-indigo-50">
          <div className="text-center px-6 py-4 rounded-2xl border border-blue-100 bg-white/80 shadow-sm">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 mx-auto mb-3 flex items-center justify-center text-2xl font-bold text-white">
              L
            </div>
            <p className="text-slate-700 text-sm font-medium">Camera is currently turned off</p>
            <p className="text-slate-500 text-xs mt-1">Use the controls below to start your video.</p>
          </div>
        </div>
      )}

      {isCameraOn && (
        <div className="absolute top-4 right-4 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 shadow-md">
          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
          {enableMultimodal ? (isMuted ? 'Video Live' : 'Audio+Video Live') : 'Recording'}
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .mirror {
          transform: scaleX(-1);
        }
      `}} />
    </div>
  )
}

export default WebCamVideo
