import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { academicYear, api, type InvitePreview, type Membership, type User } from './api'
import { StudentProfile } from './Profile'
import StudentAchievements from './StudentAchievements'
import { apiQuery, eventDate, type Notification, type PageInfo } from './portfolio'
import { eventLabels } from './ReviewDetails'
import { PageButtons } from './PortfolioResults'
import { canLeave, ErrorNotice, FieldError, MemberBadge, useAction, useResource } from './ui'

export default function Student({ user, update, invite, setInvite }: {
  user: User; update: (user: User) => void; invite: string; setInvite: (code: string) => void
}) {
  const pages = { groups: 'Мої групи', profile: 'Мій профіль', achievements: 'Мої досягнення', notifications: 'Сповіщення' }
  const [page, setPage] = useState<keyof typeof pages>('groups')
  const [record, setRecord] = useState<string>()
  const [noticePage, setNoticePage] = useState(1)
  const notices = useResource<{ unread: number; notifications: Notification[] } & PageInfo>(
    apiQuery('/api/notifications/', { page: String(noticePage) }),
  )
  const noticeAction = useAction()
  function navigate(next: typeof page) {
    if (page !== next && canLeave()) {
      setPage(next)
      setRecord(undefined)
      if (next === 'notifications') notices.refresh()
      window.scrollTo(0, 0)
    }
  }
  function openRecord(id: string) {
    setRecord(id)
    setPage('achievements')
    window.scrollTo(0, 0)
  }
  function markRead(item: Notification) {
    void noticeAction.run(async () => {
      await api('/api/notifications/' + item.id + '/read/', 'POST', {})
      notices.refreshAfterWrite()
    })
  }
  return <main className="standard-page student-page">
    <nav className="student-nav" aria-label="Кабінет учня">
      {(Object.keys(pages) as (keyof typeof pages)[]).map((id) => <button key={id}
        aria-current={page === id ? 'page' : undefined} type="button" onClick={() => navigate(id)}>{pages[id]}
        {id === 'notifications' && Boolean(notices.data?.unread) && ' · ' + notices.data?.unread}</button>)}
    </nav>
    {page === 'groups' && <StudentGroups invite={invite} setInvite={setInvite} />}
    {page === 'profile' && <StudentProfile user={user} update={update} openRecord={openRecord} />}
    {page === 'achievements' && <StudentAchievements key={record ?? 'list'} initialId={record} openGroups={() => navigate('groups')} />}
    {page === 'notifications' && <>
      <header className="page-heading"><h1>Сповіщення</h1></header>
      <ErrorNotice error={notices.error} retry={notices.refresh} />
      <ErrorNotice error={noticeAction.error} />
      {notices.loading && !notices.data && <p role="status">Завантажуємо сповіщення…</p>}
      {notices.data?.notifications.length === 0 && <p>Повідомлень поки немає.</p>}
      <ul className="record-list history-list">{notices.data?.notifications.map((item) => <li key={item.id}>
        <strong>{item.competition} · {eventLabels[item.action]}</strong>
        <p className="hint">{[item.group, eventDate(item.at), item.read ? 'Прочитане' : 'Нове'].filter(Boolean).join(' · ')}</p>
        {item.details.comment && <p className="preserve-lines">{item.details.comment}</p>}
        <div className="actions">
          <button className="control" onClick={() => openRecord(item.record_id)}>Відкрити запис</button>
          {!item.read && <button className="control" disabled={noticeAction.busy} onClick={() => markRead(item)}>Позначити прочитаним</button>}
        </div>
      </li>)}</ul>
      {notices.data && <PageButtons data={notices.data} move={setNoticePage} />}
    </>}
  </main>
}

function StudentGroups({ invite, setInvite }: { invite: string; setInvite: (code: string) => void }) {
  const groups = useResource<{ memberships: Membership[] }>('/api/memberships/')
  const joining = useAction()
  const [preview, setPreview] = useState<{ code: string; result: InvitePreview }>()
  const found = preview?.code === invite ? preview.result : undefined
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

  return <>
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

  </>
}
