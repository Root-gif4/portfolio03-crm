import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { Icon } from '../components/Icon'
import { ErrorBox } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'

export function Login() {
  const { me, login } = useAuth()
  const [theme, toggleTheme] = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  if (me) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <button type="button" className="icon-btn theme-corner" onClick={toggleTheme} aria-label="明るさを切り替える">
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
      <form className="login-card" onSubmit={submit}>
        <div className="brand center">
          <img src="/favicon.svg" alt="" width={40} height={40} />
          <div>
            <strong>顧客・案件管理</strong>
            <span>ログインしてください</span>
          </div>
        </div>
        <ErrorBox error={error} />
        <div className="field">
          <label htmlFor="email">メールアドレス</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
        </div>
        <div className="field">
          <label htmlFor="password">パスワード</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={128} />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'ログインしています…' : 'ログイン'}</button>
        <p className="hint center">続けて 5 回間違えると、15 分ほどログインできなくなります。</p>
      </form>
    </div>
  )
}
