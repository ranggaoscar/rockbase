import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, Mail, Zap, AlertCircle } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export default function Login() {
  const navigate = useNavigate()
  const setAuth = useAppStore((s) => s.setAuth)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) {
      setError('Please enter your email and password.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const { data } = await authApi.login(email, password)
      setAuth(data.user, data.token)
      navigate('/', { replace: true })
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Login failed. Check your credentials.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      {/* Subtle radial glow background */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(124,58,237,0.08) 0%, transparent 70%)',
        }}
      />

      <div className="relative w-full max-w-[400px]">
        {/* Card */}
        <div className="rounded-2xl border border-white/[0.06] bg-[#111111] p-8 shadow-2xl">

          {/* Logo */}
          <div className="mb-8 flex flex-col items-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-600 shadow-lg shadow-purple-600/30">
              <Zap className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              SocialCommand
            </h1>
            <p className="mt-1 text-sm text-white/40">
              Farm Management Platform
            </p>
          </div>

          {/* Status indicator */}
          <div className="mb-6 flex items-center justify-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse-slow" />
            <span className="text-[11px] font-medium uppercase tracking-widest text-green-400/80">
              System Online
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-white/70">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@socialcommand.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                leftIcon={<Mail />}
                autoComplete="email"
                autoFocus
                className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus-visible:ring-purple-500/50 focus-visible:border-purple-500/50"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-white/70">Password</Label>
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                leftIcon={<Lock />}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    className="cursor-pointer"
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </button>
                }
                autoComplete="current-password"
                className="bg-white/[0.04] border-white/[0.08] text-white placeholder:text-white/25 focus-visible:ring-purple-500/50 focus-visible:border-purple-500/50"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              size="xl"
              className={cn(
                'mt-2 w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold shadow-lg shadow-purple-600/25 transition-all',
                loading && 'opacity-70 cursor-not-allowed'
              )}
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Signing in…
                </span>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between px-1">
          <p className="text-[11px] text-white/20">Internal use only</p>
          <p className="text-[11px] text-white/20">v1.0.0</p>
        </div>
      </div>
    </div>
  )
}
