import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'

// Maps common Firebase auth error codes to friendly Vietnamese messages.
function friendlyError(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'Email không hợp lệ.'
    case 'auth/missing-password':
      return 'Nhập mật khẩu nhé.'
    case 'auth/weak-password':
      return 'Mật khẩu quá yếu (tối thiểu 6 ký tự).'
    case 'auth/email-already-in-use':
      return 'Email này đã được đăng ký — thử đăng nhập.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email hoặc mật khẩu không đúng.'
    case 'auth/operation-not-allowed':
      return 'Email/Password chưa được bật trong Firebase Console → Authentication.'
    case 'auth/too-many-requests':
      return 'Thử quá nhiều lần, đợi chút rồi thử lại.'
    default:
      return 'Có lỗi xảy ra, thử lại nhé.'
  }
}

export function LoginPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signin') await signIn(email.trim(), password)
      else await signUp(email.trim(), password)
    } catch (err) {
      const code = (err as { code?: string }).code ?? ''
      setError(friendlyError(code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={submit}>
        <h1 className="auth__title">J AI Trade</h1>
        <p className="auth__subtitle">
          {mode === 'signin' ? 'Đăng nhập để tiếp tục' : 'Tạo tài khoản mới'}
        </p>

        <input
          className="auth__input"
          type="email"
          placeholder="Email"
          value={email}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="auth__input"
          type="password"
          placeholder="Mật khẩu"
          value={password}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <div className="auth__error">⚠️ {error}</div>}

        <button className="auth__btn" type="submit" disabled={busy}>
          {busy ? '…' : mode === 'signin' ? 'Đăng nhập' : 'Đăng ký'}
        </button>

        <button
          type="button"
          className="auth__switch"
          onClick={() => {
            setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
            setError(null)
          }}
        >
          {mode === 'signin' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
        </button>
      </form>
    </div>
  )
}
