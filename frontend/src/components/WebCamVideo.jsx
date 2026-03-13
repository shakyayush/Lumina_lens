import { useRef, useEffect } from 'react'

const WebCamVideo = ({ isCameraOn }) => {
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      } catch (err) {
        console.warn('Camera access denied or not available, using fallback', err)
      }
    }

    const stopCamera = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
    }

    if (isCameraOn) {
      startCamera()
    } else {
      stopCamera()
    }

    return () => {
      stopCamera()
    }
  }, [isCameraOn])

  return (
    <div className="relative w-full h-full bg-white flex items-center justify-center">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-cover mirror transition-opacity duration-300 ${isCameraOn ? 'opacity-100' : 'opacity-0'}`}
      />
      
      {/* Fallback pattern / camera-off state */}
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
          Recording
        </div>
      )}
      
      <div className="absolute bottom-4 left-6 py-1 px-3 glass-panel rounded-lg text-xs font-semibold tracking-wide text-slate-700 select-none">
        Presentation: Designing with AI
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .mirror {
          transform: scaleX(-1);
        }
      `}} />
    </div>
  )
}

export default WebCamVideo
