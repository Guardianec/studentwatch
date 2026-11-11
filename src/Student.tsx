import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { academicYear, api, type InvitePreview, type Membership, type User } from './api'
import { ErrorNotice, FieldError, MemberBadge, useAction, useResource } from './ui'

export default function Student({ user, update, invite, setInvite }: {
  user: User; update: (user: User) => void; invite: string; setInvite: (code: string) => void
}) {
  const groups = useResource<{ memberships: Membership[] }>('/api/memberships/')
  const joining = useAction()
  const editing = useAction()
  const [preview, setPreview] = useState<{ code: string; result: InvitePreview }>()
  const found = preview?.code === invite ? preview.result : undefined
  const [name, setName] = useState(user.full_name)
  const [saved, setSaved] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function lookup(submit: boolean) {
    const result = await api<InvitePreview>('/api/join/', 'POST', { code: invite, submit })
    setPreview({ code: invite, result })
    if (submit && result.status === 'pending') {
      setSubmitted(true)
      setPreview(undefined)
      setInvite('')
      window.history.replaceState(null, '', window.location.pathname)
      groups.refreshAfterWrite()
    }
  }

  return <main className="standard-page student-page">
    <header className="page-heading"><h1>Мої групи</h1><p>Запрошення та статуси ваших заявок.</p></header>
    <section aria-labelledby="join-title" className="student-section">
      <div className="section-heading"><h2 id="join-title">Приєднатися до групи</h2></div>
      <form className="form" onSubmit={(event) => {
        event.preventDefault()
        setPreview(undefined)
        setSubmitted(false)
        void joining.run(() => lookup(false))
      }}>
        <label>Код запрошення
          <input value={invite} onChange={(event) => { setInvite(event.target.value); setPreview(undefined); setSubmitted(false) }}
            maxLength={80} required autoComplete="off" spellCheck={false}
            disabled={joining.busy}
            aria-invalid={Boolean(joining.error?.fields.code)}
            aria-describedby={joining.error?.fields.code ? 'join-code-error' : 'join-hint'} />
          <FieldError id="join-code-error" message={joining.error?.fields.code} />
          <span className="hint" id="join-hint">Введіть код, який надіслав учитель.</span>
        </label>
        <button type="submit" className="control" disabled={joining.busy}>{joining.busy ? 'Перевіряємо…' : 'Знайти групу'}</button>
      </form>
      <ErrorNotice error={joining.error} />
      {found && <div className="invite-preview">
        <strong>{found.group.name}</strong><span className="hint">{academicYear(found.group.year)} навчальний рік</span>
        {found.status && <MemberBadge status={found.status} />}
        {found.status === 'rejected' && <p className="hint">Повторне подання до цієї групи недоступне. Зверніться до вчителя.</p>}
        {(!found.status || found.status === 'removed') && <button className="control primary"
          disabled={joining.busy} onClick={() => void joining.run(() => lookup(true))}>Подати заявку</button>}
      </div>}
      {submitted && <p role="status" className="invite-preview">Заявку подано. Поточний статус видно в розділі «Заявки та членство».</p>}
    </section>

    <section aria-labelledby="my-groups-title" className="student-section">
      <div className="section-heading spaced"><h2 id="my-groups-title">Заявки та членство</h2>
        <button className="control" onClick={groups.refresh} disabled={groups.loading}><RefreshCw size={15} aria-hidden="true" /> Оновити</button></div>
      <ErrorNotice error={groups.error} retry={groups.refresh} />
      {groups.loading && !groups.data && <p role="status">Завантажуємо заявки…</p>}
      {groups.data?.memberships.length === 0 && <p className="hint">Ви ще не подали жодної заявки.</p>}
      <ul className="member-list">
        {groups.data?.memberships.map((item) => <li key={item.id}>
          <span className="row-name"><strong>{item.group.name}</strong>
            <span>{academicYear(item.group.year)}{item.group.archived ? ' · Архів' : ''}</span></span>
          <MemberBadge status={item.status} />
        </li>)}
      </ul>
    </section>

    <section aria-labelledby="profile-title" className="student-section">
      <div className="section-heading"><h2 id="profile-title">Мій профіль</h2></div>
      <p className="hint">Логін · {user.username}</p>
      <form className="form" onSubmit={(event) => {
        event.preventDefault()
        setSaved(false)
        void editing.run(async () => {
          const result = await api<{ user: User }>('/api/profile/', 'POST', { full_name: name })
          update(result.user)
          setName(result.user.full_name)
          setSaved(true)
        })
      }}>
        <label>ПІБ
          <input value={name} onChange={(event) => { setName(event.target.value); setSaved(false) }} maxLength={120}
            required autoComplete="name" aria-invalid={Boolean(editing.error?.fields.full_name)}
            aria-describedby={editing.error?.fields.full_name ? 'profile-name-error' : undefined} />
          <FieldError id="profile-name-error" message={editing.error?.fields.full_name} />
        </label>
        <ErrorNotice error={editing.error} />
        <button className="control" type="submit" disabled={editing.busy}>{editing.busy ? 'Зберігаємо…' : 'Зберегти профіль'}</button>
        {saved && <p role="status">Профіль оновлено.</p>}
      </form>
    </section>
  </main>
}
