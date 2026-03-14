import { SignIn } from '@clerk/clerk-react'

const LoginPage = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Animated background blobs */}
      <div className="absolute top-[-15%] left-[-15%] w-[55%] h-[55%] bg-blue-600/20 rounded-full blur-[140px] pointer-events-none animate-pulse" />
      <div className="absolute bottom-[-15%] right-[-15%] w-[55%] h-[55%] bg-purple-600/20 rounded-full blur-[140px] pointer-events-none animate-pulse" style={{ animationDelay: '1s' }} />
      <div className="absolute top-[40%] right-[20%] w-[30%] h-[30%] bg-indigo-600/15 rounded-full blur-[100px] pointer-events-none" />

      {/* App header above sign-in box */}
      <div className="z-10 mb-6 text-center animate-slide-in">
        <div className="flex items-center justify-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-black text-white text-2xl shadow-xl shadow-blue-500/30">
            L
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Lumina Lens
          </h1>
        </div>
        <p className="text-slate-400 text-sm">AI-Powered Live Q&amp;A — Sign in with Google to continue</p>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-2 mt-4">
          {['🤖 AI filters duplicates', '⭐ Sharp Tokens', '🔗 Shareable links'].map(f => (
            <span key={f} className="text-[11px] px-3 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300">
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Clerk's pre-built SignIn — renders Google button automatically */}
      <div className="z-10 animate-slide-in" style={{ animationDelay: '0.1s' }}>
        <SignIn
          appearance={{
            elements: {
              card: 'bg-[rgba(15,15,25,0.85)] border border-white/10 shadow-2xl rounded-2xl backdrop-blur-xl',
              headerTitle: 'text-white',
              headerSubtitle: 'text-slate-400',
              socialButtonsBlockButton: 'bg-white text-slate-800 hover:bg-slate-100 font-semibold border-0 shadow-lg',
              socialButtonsBlockButtonText: 'font-semibold',
              dividerLine: 'bg-white/10',
              dividerText: 'text-slate-500',
              formFieldInput: 'bg-white/5 border-white/10 text-white placeholder-slate-500 focus:border-blue-500',
              formFieldLabel: 'text-slate-300',
              formButtonPrimary: 'bg-blue-600 hover:bg-blue-500 text-white font-semibold',
              footerActionText: 'text-slate-400',
              footerActionLink: 'text-blue-400 hover:text-blue-300',
              identityPreviewText: 'text-white',
              identityPreviewEditButton: 'text-blue-400',
            },
          }}
        />
      </div>
    </div>
  )
}

export default LoginPage
