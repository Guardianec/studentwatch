import { useEffect, useState } from 'react'
import { ArrowLeft, Award, ChevronRight, FolderOpen, House, Inbox, Menu, Plus, Settings, Users, X } from 'lucide-react'
import { version } from '../package.json'
import { academicYear, api, type GroupSummary, type GroupDetail, type User } from './api'
import { backRoute, detailRoute, Navigation, RouteLink, useHashRoute } from './navigation'
import { PortfolioResults } from './PortfolioResults'
import { StudentWorkspace, TeacherOverview, TeacherStudents } from './TeacherAcademic'
import { TeacherRecord } from './TeacherAchievements'
import { GroupForm, GroupPanel } from './TeacherGroups'
import TeacherInbox from './TeacherInbox'
import TeacherSettings from './TeacherSettings'
import { ErrorNotice, useResource } from './ui'

const pages = {
  overview: { title: 'Огляд', icon: House },
  students: { title: 'Учні', icon: Users },
  achievements: { title: 'Досягнення', icon: Award },
  groups: { title: 'Групи', icon: FolderOpen },
  inbox: { title: 'Вхідні', icon: Inbox },
  settings: { title: 'Налаштування', icon: Settings },
}

export default function Teacher({ user, logout }: { user: User; logout: () => void }) {
  const navigation = useHashRoute('/overview')
  const { path, route, params, navigate } = navigation
  const [, current, id] = path.split('/')
  const page = Object.hasOwn(pages, current) ? current as keyof typeof pages : 'overview'
  const detail = (page === 'students' || page === 'groups') && /^\d{1,15}$/.test(id ?? '') ||
    page === 'achievements' && /^[a-f\d-]{36}$/i.test(id ?? '')
  const [menu, setMenu] = useState(false)
  const [creating, setCreating] = useState(false)
  const summary = useResource<{ groups: GroupSummary[] }>('/api/groups/', '', true)
  const groups = summary.data?.groups ?? []
  const active = groups.filter((group) => !group.archived)
  const targetGroup = Number(params.get('group')) || undefined
  const pending = active.reduce((sum, group) => sum + group.pending, 0)

  useEffect(() => {
    setMenu(false)
    window.scrollTo(0, 0)
    document.getElementById('workspace')?.focus({ preventScroll: true })
  }, [path])

  function changed(group: GroupDetail) {
    const { memberships, invitation: _invitation, ...fields } = group
    const updated = { ...fields, approved: memberships.filter((item) => item.status === 'approved').length,
      pending: memberships.filter((item) => item.status === 'pending').length }
    summary.replace((previous) => ({ groups: [updated, ...(previous?.groups ?? []).filter((item) => item.id !== group.id)] }))
    summary.refreshAfterWrite()
  }

  return <Navigation.Provider value={navigation}><div className="teacher-layout">
    <a href="#workspace" className="skip" onClick={(event) => { event.preventDefault(); document.getElementById('workspace')?.focus() }}>До вмісту</a>
    <aside className={'sidebar' + (menu ? ' menu-open' : '')}>
      <div className="sidebar-head"><RouteLink to="/overview" className="brand"><img src="/mark.svg" alt="" width="30" height="30" /><strong>Поступ</strong></RouteLink>
        <button className="icon-button menu-toggle" onClick={() => setMenu(!menu)} aria-expanded={menu}
          aria-controls="navigation" aria-label={menu ? 'Закрити меню' : 'Відкрити меню'}>
          {menu ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      <nav id="navigation" aria-label="Кабінет учителя">
        <div className="nav-group">{(Object.keys(pages) as (keyof typeof pages)[]).map((key) => {
          const { title, icon: Icon } = pages[key]
          return <RouteLink key={key} to={'/' + key} aria-current={page === key ? 'page' : undefined}>
            <Icon size={18} aria-hidden="true" />{title}{key === 'inbox' && pending > 0 && <span className="nav-count" aria-label={pending + ' заявок до груп'}>{pending}</span>}
          </RouteLink>
        })}</div>
      </nav>
      <div className="sidebar-foot"><span>Кабінет учителя</span><span>v{version}</span></div>
    </aside>
    <div className="body">
      <header className="topbar"><span className="workspace-name">{pages[page].title}</span>
        <div className="top-meta"><span className="account-name">{user.full_name}</span><button className="control" onClick={logout}>Вийти</button></div>
      </header>
      <main id="workspace" tabIndex={-1}>
        {summary.error && <div className="academic-page"><ErrorNotice error={summary.error} retry={summary.refresh} /></div>}
        <div className="view-enter" key={path}>
          {detail ? <div className="academic-page">
            <RouteLink className="back-link" to={backRoute(params, '/' + page)}><ArrowLeft size={16} aria-hidden="true" /> Назад</RouteLink>
            {page === 'students' ? <StudentWorkspace id={Number(id)} />
              : page === 'groups' ? <GroupPanel id={Number(id)} changed={changed} />
              : <TeacherRecord key={id + '/' + targetGroup} id={id} groupId={targetGroup} />}
          </div> : page === 'settings' ? <TeacherSettings />
            : page === 'overview' ? <TeacherOverview groups={active} />
            : page === 'students' ? <TeacherStudents groups={active} />
            : page === 'inbox' ? <TeacherInbox groups={active} changed={summary.refreshAfterWrite} />
            : page === 'achievements' ? <div className="academic-page">
              <header className="page-heading"><h1>Досягнення</h1><p>Академічні результати учнів у доступних вам групах.</p></header>
              <PortfolioResults teacher groups={active} studentRoute={(person) => detailRoute('/students/' + person, route)}
                recordRoute={(item) => detailRoute('/achievements/' + item.id, route)} />
            </div> : <div className="academic-page">
              <header className="page-heading academic-heading"><div><h1>Групи</h1><p>Учні та результати за навчальними групами.</p></div>
                <button className="control primary" onClick={() => setCreating(true)}><Plus size={17} aria-hidden="true" /> Створити групу</button>
              </header>
              {summary.loading && !summary.data && <p role="status">Завантажуємо групи…</p>}
              {summary.data && !groups.length && <p className="empty">Створіть першу групу, щоб запросити учнів.</p>}
              <ul className="academic-rows">{groups.map((group) => <li className="academic-row" key={group.id}>
                <div className="academic-row-content"><RouteLink className="academic-title" to={detailRoute('/groups/' + group.id, route)}>
                  {group.name}<ChevronRight size={16} aria-hidden="true" /></RouteLink>
                  <p className="hint">{academicYear(group.year)}{group.archived ? ' · Архів' : ''}</p></div>
                <div className="academic-row-status"><span>Учнів · {group.approved}</span>
                  {group.pending > 0 && <p className="hint">Заявок · {group.pending}</p>}</div>
              </li>)}</ul>
            </div>}
        </div>
      </main>
    </div>
    {creating && <GroupForm close={() => setCreating(false)} save={async (input) => {
      const result = await api<GroupDetail>('/api/groups/', 'POST', input)
      changed(result)
      setCreating(false)
      navigate(detailRoute('/groups/' + result.id, route))
    }} />}
  </div></Navigation.Provider>
}
