import { useEffect, useState } from 'react'
import { Bell, BookOpen, FolderOpen, House, Plus, UserRound } from 'lucide-react'
import { api, type Membership, type User } from './api'
import { backRoute, detailRoute, Navigation, RouteLink, useHashRoute, useNavigation } from './navigation'
import { StudentProfile } from './Profile'
import StudentAchievements from './StudentAchievements'
import StudentGroups from './StudentGroups'
import StudentHome from './StudentHome'
import { apiQuery, eventDate, type Notification, type PageInfo } from './portfolio'
import { eventLabels } from './ReviewDetails'
import { PageButtons, PortfolioResults } from './PortfolioResults'
import { ErrorNotice, useAction, useResource } from './ui'

const pages = {
  home: { title: 'Головна', icon: House },
  portfolio: { title: 'Портфоліо', icon: BookOpen },
  groups: { title: 'Групи', icon: FolderOpen },
  profile: { title: 'Профіль', icon: UserRound },
  notifications: { title: 'Сповіщення', icon: Bell },
}

export default function Student({ user, update, invite, setInvite }: {
  user: User; update: (user: User) => void; invite: string; setInvite: (code: string) => void
}) {
  const navigation = useHashRoute('/home')
  const { path, route, params, navigate } = navigation
  const [, current, id] = path.split('/')
  const page = Object.hasOwn(pages, current) ? current as keyof typeof pages : 'home'
  const detail = page === 'portfolio' && (id === 'new' || /^[a-f\d-]{36}$/i.test(id ?? ''))
  const [recentSave, setRecentSave] = useState<{ id: string; message: string }>()
  const notices = useResource<{ unread: number; notifications: Notification[] } & PageInfo>(
    apiQuery('/api/notifications/', { page: page === 'notifications' ? params.get('page') || '1' : '1' }),
    page === 'notifications' ? 'open' : '',
  )
  const noticeAction = useAction()

  useEffect(() => {
    window.scrollTo(0, 0)
    document.getElementById('student-content')?.focus({ preventScroll: true })
  }, [path])

  function markRead(item: Notification) {
    void noticeAction.run(async () => {
      await api('/api/notifications/' + item.id + '/read/', 'POST', {})
      notices.refreshAfterWrite()
    })
  }

  const open = (recordId: string) => detailRoute('/portfolio/' + recordId, route)
  return <Navigation.Provider value={navigation}><div className="student-frame">
    <a href="#student-content" className="skip" onClick={(event) => { event.preventDefault(); document.getElementById('student-content')?.focus() }}>До вмісту</a>
    <nav className="student-nav" aria-label="Кабінет учня">
      {(Object.keys(pages) as (keyof typeof pages)[]).map((key) => {
        const { title, icon: Icon } = pages[key]
        return <RouteLink key={key} aria-current={page === key ? 'page' : undefined} to={'/' + key}>
          <Icon size={18} aria-hidden="true" /><span>{title}</span>
          {key === 'notifications' && Boolean(notices.data?.unread) && <span className="student-unread">{notices.data?.unread}</span>}
        </RouteLink>
      })}
    </nav>
    <main className="standard-page student-page view-enter" id="student-content" key={path} tabIndex={-1}>
      {page === 'home' && <StudentHome user={user} invitation={Boolean(invite)} />}
      {page === 'groups' && <StudentGroups invite={invite} setInvite={setInvite} />}
      {page === 'profile' && <StudentProfile user={user} update={update} />}
      {page === 'portfolio' && (detail ?
        <StudentAchievements key={id} id={id} close={() => navigate(backRoute(params, '/portfolio'), true, false)}
          initialNotice={recentSave?.id === id ? recentSave.message : undefined}
          saved={(recordId, message) => {
            if (id !== 'new') return
            setRecentSave({ id: recordId, message })
            navigate(detailRoute('/portfolio/' + recordId, backRoute(params, '/portfolio')), true, false)
          }} openGroups={() => navigate('/groups')} /> : <StudentPortfolio />)}
      {page === 'notifications' && <>
        <header className="page-heading"><h1>Сповіщення</h1></header>
        <ErrorNotice error={notices.error} retry={notices.refresh} />
        <ErrorNotice error={noticeAction.error} />
        {notices.loading && !notices.data && <p role="status">Завантажуємо сповіщення…</p>}
        {notices.data?.notifications.length === 0 && <p className="empty">Повідомлень поки немає.</p>}
        <ul className="academic-rows notification-list">{notices.data?.notifications.map((item) => <li key={item.id}>
          <strong>{item.competition} · {eventLabels[item.action] ?? item.action}</strong>
          <p className="hint">{[item.group, eventDate(item.at), item.read ? 'Прочитане' : 'Нове'].filter(Boolean).join(' · ')}</p>
          {item.details.comment && <p className="preserve-lines">{item.details.comment}</p>}
          <div className="actions">
            <RouteLink className="control" to={open(item.record_id)}>Відкрити запис</RouteLink>
            {!item.read && <button className="control" disabled={noticeAction.busy} onClick={() => markRead(item)}>Позначити прочитаним</button>}
          </div>
        </li>)}</ul>
        {notices.data && <PageButtons data={notices.data} move={(noticePage) => navigation.update({ page: String(noticePage) })} />}
      </>}
    </main>
  </div></Navigation.Provider>
}

function StudentPortfolio() {
  const { route } = useNavigation()
  const memberships = useResource<{ memberships: Membership[] }>('/api/memberships/')
  const groups = (memberships.data?.memberships ?? []).filter((item) => item.status === 'approved' && !item.group.archived).map((item) => item.group)
  return <>
    <header className="page-heading academic-heading"><div><h1>Портфоліо</h1>
      <p>Результати, чернетки й відгуки вчителів.</p></div>
      <RouteLink className="control primary" to={detailRoute('/portfolio/new', route)}><Plus size={17} aria-hidden="true" /> Додати досягнення</RouteLink>
    </header>
    <ErrorNotice error={memberships.error} retry={memberships.refresh} />
    <PortfolioResults groups={groups} recordRoute={(item) => detailRoute('/portfolio/' + item.id, route)} />
  </>
}
