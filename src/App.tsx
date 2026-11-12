import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { ApiFailure, authenticate, desktop, session, signOut, type User } from './api'
import Student from './Student'
import Teacher from './Teacher'
import { asFailure, canLeave, ErrorNotice, FieldError, useAction } from './ui'

const pendingLogout = 'postup-logout-pending'
const inviteKey = 'postup-invitation'

function inviteFromUrl() {
  return /^#join\/([0-9a-f]{24})$/i.exec(window.location.hash)?.[1] ?? ''
}

function SiteFrame({ children, user, logout }: { children: ReactNode; user?: User; logout?: () => void }) {
  return <div className="site-frame">
    <header className="topbar site-topbar">
      <div className="brand"><img src="/mark.svg" alt="" width="30" height="30" /><strong>Поступ</strong></div>
      <div className="top-meta">
        <span className="workspace-name">{desktop ? 'Кабінет учителя' : 'Кабінет учня'}</span>
        {user && <button className="control" onClick={logout}>Вийти</button>}
      </div>
    </header>
    {children}
  </div>
}

function AuthForm({ invite, setInvite, onLogin }: {
  invite: string; setInvite: (code: string) => void; onLogin: (user: User) => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const action = useAction()
  const fields = action.error?.fields ?? {}
  const register = mode === 'register'

  return <main className="standard-page auth-page">
    <header className="page-heading"><h1>{register ? 'Створити обліковий запис' : desktop ? 'Вхід для вчителя' : 'Вхід для учня'}</h1>
      <p>{desktop ? 'Увійдіть, щоб переглянути свої групи та заявки.' : 'Увійдіть, щоб приєднатися до групи й перевіряти заявки.'}</p>
    </header>
    <form className="form" onSubmit={(event) => {
      event.preventDefault()
      void action.run(async () => {
        try {
          const user = await authenticate(mode, { username, full_name: name, password })
          if (!user) throw new ApiFailure('session', 'Вхід не завершено. Спробуйте ще раз.')
          onLogin(user)
        } finally {
          setPassword('')
          setShowPassword(false)
        }
      })
    }}>
      {register && <label>ПІБ
        <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength={120}
          aria-invalid={Boolean(fields.full_name)} aria-describedby={fields.full_name ? 'auth-name-error' : undefined} />
        <FieldError id="auth-name-error" message={fields.full_name} />
      </label>}
      <label>Логін
        <input value={username} onChange={(event) => setUsername(event.target.value)} required maxLength={register ? 40 : 150}
          autoComplete="username" autoCapitalize="none" spellCheck={false}
          aria-invalid={Boolean(fields.username)} aria-describedby={fields.username ? 'auth-login-error' : register ? 'auth-login-hint' : undefined} />
        {register && <span className="hint" id="auth-login-hint">3–40 латинських літер, цифр, крапок, дефісів або підкреслень.</span>}
        <FieldError id="auth-login-error" message={fields.username} />
      </label>
      <div className="password-field">
        <label htmlFor="password">Пароль</label>
        <div className="input-with-action">
          <input id="password" type={showPassword ? 'text' : 'password'} value={password}
            onChange={(event) => setPassword(event.target.value)} autoComplete={register ? 'new-password' : 'current-password'}
            required minLength={register ? 12 : undefined} maxLength={128} aria-invalid={Boolean(fields.password)}
            aria-describedby={fields.password ? 'auth-password-error' : register ? 'auth-password-hint' : undefined} />
          <button className="icon-button" type="button" onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Приховати пароль' : 'Показати пароль'}>
            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        </div>
        {register && <span className="hint" id="auth-password-hint">Від 12 символів. Уникайте поширених паролів і повторення логіна.</span>}
        <FieldError id="auth-password-error" message={fields.password} />
      </div>
      {!desktop && <label>Код запрошення <span className="hint">Необов’язково</span>
        <input value={invite} onChange={(event) => setInvite(event.target.value)} maxLength={80}
          autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </label>}
      <ErrorNotice error={action.error} />
      <button className="control primary" type="submit" disabled={action.busy}>
        {action.busy ? 'Виконуємо…' : register ? 'Зареєструватися' : 'Увійти'}
      </button>
    </form>
    <div className="auth-footer">
      {!desktop && <button className="text-link" disabled={action.busy} onClick={() => {
        setMode(register ? 'login' : 'register')
        setPassword('')
        setShowPassword(false)
        action.clearError()
      }}>{register ? 'Уже є обліковий запис? Увійти' : 'Створити обліковий запис'}</button>}
      {!register && <p className="hint">Для відновлення доступу зверніться до адміністратора.</p>}
    </div>
  </main>
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [initialError, setInitialError] = useState<ApiFailure>()
  const [notice, setNotice] = useState<ApiFailure>()
  const [logoutRequired, setLogoutRequired] = useState(false)
  const restoring = useRef(false)
  const [invite, setInviteState] = useState(() => desktop ? '' : inviteFromUrl() || sessionStorage.getItem(inviteKey) || '')
  const matchingRole = user?.role === (desktop ? 'teacher' : 'student')

  const restore = useCallback(async () => {
    if (restoring.current) return
    restoring.current = true
    setInitialError(undefined)
    setLoading(true)
    try {
      if (!desktop && localStorage.getItem(pendingLogout)) {
        await signOut()
        localStorage.removeItem(pendingLogout)
      }
      const current = await session()
      setUser(current.user)
      setLogoutRequired(false)
    } catch (reason) {
      setInitialError(asFailure(reason))
    } finally {
      restoring.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void restore()
    function expired() {
      setUser(null)
      setNotice(new ApiFailure('session', 'Сесія завершилася. Увійдіть знову.'))
    }
    function storage(event: StorageEvent) {
      if (event.key === pendingLogout && event.newValue) expired()
    }
    function invitationChanged() {
      const code = inviteFromUrl()
      if (!desktop && code) {
        sessionStorage.setItem(inviteKey, code)
        setInviteState(code)
      }
    }
    window.addEventListener('postup-session-expired', expired)
    window.addEventListener('storage', storage)
    window.addEventListener('hashchange', invitationChanged)
    return () => {
      window.removeEventListener('postup-session-expired', expired)
      window.removeEventListener('storage', storage)
      window.removeEventListener('hashchange', invitationChanged)
    }
  }, [restore])

  function setInvite(code: string) {
    if (code) sessionStorage.setItem(inviteKey, code)
    else sessionStorage.removeItem(inviteKey)
    setInviteState(code)
  }

  async function logout() {
    if (!canLeave()) return
    setUser(null)
    setLoading(true)
    setNotice(undefined)
    setInitialError(undefined)
    setLogoutRequired(false)
    if (!desktop) {
      localStorage.setItem(pendingLogout, '1')
      setInvite('')
      window.history.replaceState(null, '', window.location.pathname)
    }
    try {
      await signOut()
      if (!desktop) localStorage.removeItem(pendingLogout)
    } catch (reason) {
      const failure = asFailure(reason)
      if (!desktop || failure.code === 'storage') {
        setLogoutRequired(true)
        setInitialError(failure)
      } else {
        setNotice(new ApiFailure('logout', 'Кабінет закрито на цьому пристрої. Сервер не підтвердив вихід.'))
      }
    } finally {
      setLoading(false)
    }
  }

  if (user && matchingRole && desktop) return <Teacher key={user.id} user={user} logout={() => void logout()} />
  return <SiteFrame user={user ?? undefined} logout={() => void logout()}>
    {loading ? <main className="standard-page auth-page"><p role="status">Перевіряємо сесію…</p></main>
      : initialError ? <main className="standard-page auth-page">
        <h1>{logoutRequired ? 'Завершення виходу' : 'Підключення'}</h1>
        <ErrorNotice error={initialError} retry={() => void (logoutRequired ? logout() : restore())} />
      </main> : user && matchingRole ? <Student key={user.id} user={user} update={setUser} invite={invite} setInvite={setInvite} />
      : user ? <main className="standard-page auth-page"><h1>Інший кабінет</h1>
        <p>Вийдіть із цього облікового запису й увійдіть з відповідною роллю.</p></main>
      : <>
        {notice && <div className="standard-page auth-notice"><ErrorNotice error={notice} /></div>}
        <AuthForm invite={invite} setInvite={setInvite} onLogin={(value) => { setNotice(undefined); setUser(value) }} />
      </>}
  </SiteFrame>
}
