import { useEffect, useState, type FormEvent } from 'react'
import { Award, ChevronRight, ClipboardList, FolderOpen, House, Menu, Plus, RefreshCw, Settings, ThumbsUp, X } from 'lucide-react'
import { version } from '../package.json'
import { academicYear, api, apiAddress, inviteLink, type Group, type GroupDetail, type GroupSummary, type Member, type User } from './api'
import { canLeave, ErrorNotice, FieldError, MemberBadge, Modal, useAction, useResource } from './ui'
import { TeacherProfile } from './Profile'
import TeacherAchievements, { TeacherRecord } from './TeacherAchievements'

const pages = {
  overview: { title: 'Огляд', icon: House },
  groups: { title: 'Групи', icon: FolderOpen },
  achievements: { title: 'На перевірці', icon: Award },
  requests: { title: 'Заявки', icon: ClipboardList },
  settings: { title: 'Налаштування', icon: Settings },
}
type Page = keyof typeof pages
type GroupInput = Pick<Group, 'name' | 'year' | 'description'>
type Summary = { groups: GroupSummary[] }

function currentPage(): Page {
  const hash = window.location.hash.slice(1)
  return Object.hasOwn(pages, hash) ? hash as Page : 'overview'
}

function GroupForm({ group, save, close }: {
  group?: Group; save: (input: GroupInput) => Promise<void>; close: () => void
}) {
  const action = useAction()
  const today = new Date()
  const startYear = today.getFullYear() - (today.getMonth() < 8 ? 1 : 0)
  const [name, setName] = useState(group?.name ?? '')
  const [year, setYear] = useState(String(group?.year ?? startYear))
  const [description, setDescription] = useState(group?.description ?? '')
  const fields = action.error?.fields ?? {}
  return <Modal title={group ? 'Редагувати групу' : 'Створити групу'} onClose={close} busy={action.busy}>
    <form className="form" onSubmit={(event: FormEvent) => {
      event.preventDefault()
      void action.run(() => save({ name, year: Number(year), description }))
    }}>
      <label>Назва групи
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100}
          aria-invalid={Boolean(fields.name)} aria-describedby={fields.name ? 'group-name-error' : undefined} autoFocus />
        <FieldError id="group-name-error" message={fields.name} />
      </label>
      <label>Початок навчального року
        <input type="number" value={year} onChange={(event) => setYear(event.target.value)}
          min={2000} max={2099} required aria-invalid={Boolean(fields.year)} aria-describedby="group-year-hint" />
        <span id="group-year-hint" className="hint">{fields.year ?? 'Наприклад, 2026 для 2026/27 навчального року.'}</span>
      </label>
      <label>Опис <span className="hint">Необов’язково</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={500}
          aria-invalid={Boolean(fields.description)} aria-describedby={fields.description ? 'group-description-error' : undefined} />
        <FieldError id="group-description-error" message={fields.description} />
      </label>
      <ErrorNotice error={action.error} />
      <button type="submit" className="control primary" disabled={action.busy}>
        {action.busy ? 'Зберігаємо…' : group ? 'Зберегти зміни' : 'Створити групу'}
      </button>
    </form>
  </Modal>
}

function GroupPanel({ id, page, changed }: {
  id: number; page: Page; changed: (detail: GroupDetail) => void
}) {
  const path = '/api/groups/' + id + '/'
  const resource = useResource<GroupDetail>(path, page)
  const action = useAction()
  const [editing, setEditing] = useState(false)
  const [person, setPerson] = useState<Member>()
  const [portfolioRecord, setPortfolioRecord] = useState<string>()
  const [notice, setNotice] = useState('')
  const [confirmation, setConfirmation] = useState<{ text: string; label: string; run: () => Promise<void> }>()
  const group = resource.data

  function accept(result: GroupDetail) {
    resource.replace(() => result)
    changed(result)
  }

  async function update(suffix: string, method: 'PATCH' | 'PUT' | 'DELETE', body?: object) {
    accept(await api<GroupDetail>(path + suffix, method, body))
    setNotice('')
  }

  function decide(member: Member, status: 'approved' | 'rejected' | 'removed') {
    return update('members/' + member.id + '/', 'PATCH', { status })
  }

  async function copy(text: string, message: string) {
    setNotice('')
    try {
      await navigator.clipboard.writeText(text)
      setNotice(message)
    } catch {
      setNotice('Буфер обміну недоступний. Виділіть і скопіюйте текст із поля.')
    }
  }

  return <section className="group-panel" id="group-panel" tabIndex={-1} aria-label="Відомості про групу">
    <div className="section-heading group-panel-toolbar">
      <span>{group ? academicYear(group.year) + ' навчальний рік' : 'Відомості про групу'}</span>
      <button className="control" onClick={resource.refresh} disabled={resource.loading || action.busy}>
        <RefreshCw size={15} aria-hidden="true" /> Оновити групу
      </button>
    </div>
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    {resource.loading && !group && <p role="status">Завантажуємо групу…</p>}
    {group && <>
      <h2 className="group-title">{group.name}</h2>
      {group.archived && <p className="hint">Архівна група · нові учасники не додаються</p>}
      {group.description && <p className="group-description">{group.description}</p>}
      <div className="actions">
        <button className="control" onClick={() => setEditing(true)} disabled={action.busy}>Редагувати</button>
        {!group.archived && <button className="control" disabled={action.busy} onClick={() => setConfirmation({
          text: 'Група залишиться в архіві разом з учасниками та заявками. Чинне запрошення буде відкликано.',
          label: 'Архівувати групу',
          run: () => update('', 'PATCH', { archive: true }),
        })}>Архівувати</button>}
      </div>
      <ErrorNotice error={action.error} />
      {!group.archived && <section className="group-section" aria-labelledby="invite-heading">
        <h3 id="invite-heading">Запросити учнів</h3>
        {group.invitation ? <>
          <p className="hint">Діє до {new Date(group.invitation.expires_at).toLocaleDateString('uk-UA')}.</p>
          <div className="copy-field">
            <input aria-label="Посилання запрошення" value={inviteLink(group.invitation.code)} readOnly onFocus={(event) => event.target.select()} />
            <button className="control" onClick={() => void copy(inviteLink(group.invitation!.code), 'Посилання скопійовано.')}>Копіювати посилання</button>
          </div>
          <div className="copy-field">
            <input aria-label="Код запрошення" value={group.invitation.code} readOnly onFocus={(event) => event.target.select()} />
            <button className="control" onClick={() => void copy(group.invitation!.code, 'Код скопійовано.')}>Копіювати код</button>
          </div>
          <div className="actions">
            <button className="control" disabled={action.busy} onClick={() => setConfirmation({
              text: 'Попереднє посилання та код одразу припинять діяти.',
              label: 'Перевипустити запрошення', run: () => update('invitation/', 'PUT'),
            })}>Перевипустити</button>
            <button className="control" disabled={action.busy} onClick={() => setConfirmation({
              text: 'За цим посиланням або кодом більше не можна подати заявку.',
              label: 'Відкликати запрошення', run: () => update('invitation/', 'DELETE'),
            })}>Відкликати</button>
          </div>
        </> : <>
          <p className="hint">Запрошення діятиме сім днів. Участь потрібно підтвердити в кабінеті.</p>
          <button className="control" disabled={action.busy} onClick={() => void action.run(() => update('invitation/', 'PUT'))}>
            {action.busy ? 'Виконуємо…' : 'Створити запрошення'}
          </button>
        </>}
        {notice && <p role="status" className="hint">{notice}</p>}
      </section>}
      <section className="group-section" aria-labelledby="applications-heading">
        <h3 id="applications-heading">Заявки</h3>
        <ul className="member-list">
          {group.memberships.filter(({ status }) => status === 'pending' || status === 'rejected').map((member) => <li key={member.id}>
            <span><strong>{member.full_name}</strong><MemberBadge status={member.status} /></span>
            {member.status === 'pending' && <div className="actions">
              {!group.archived && <button className="control primary" disabled={action.busy} onClick={() => void action.run(() => decide(member, 'approved'))}>Прийняти</button>}
              <button className="control" disabled={action.busy} onClick={() => setConfirmation({
                text: 'Учень побачить відмову. Повторну заявку до цієї групи він подати не зможе.',
                label: 'Відхилити заявку', run: () => decide(member, 'rejected'),
              })}>Відхилити</button>
            </div>}
          </li>)}
        </ul>
        {!group.memberships.some(({ status }) => status === 'pending') && <p className="hint">Заявок, що очікують рішення, немає.</p>}
      </section>
      <section className="group-section" aria-labelledby="members-heading">
        <h3 id="members-heading">Учасники</h3>
        <ul className="member-list">
          {group.memberships.filter(({ status }) => status === 'approved').map((member) => <li key={member.id}>
            <button className="text-link" onClick={() => setPerson(member)}>{member.full_name} <ChevronRight size={15} aria-hidden="true" /></button>
            <button className="control" disabled={action.busy} onClick={() => setConfirmation({
              text: 'Участь учня в цій групі завершиться. Обліковий запис і решта груп збережуться.',
              label: 'Видалити з групи', run: () => decide(member, 'removed'),
            })}>Видалити з групи</button>
          </li>)}
        </ul>
        {!group.memberships.some(({ status }) => status === 'approved') && <p className="hint">Підтверджених учасників поки немає.</p>}
      </section>
      {editing && <GroupForm group={group} close={() => setEditing(false)} save={async (input) => {
        await update('', 'PATCH', input)
        setEditing(false)
      }} />}
      {person && <Modal title="Академічний профіль" onClose={() => setPerson(undefined)}>
        <TeacherProfile key={person.student_id} id={person.student_id} groupId={group.id} openRecord={(record) => {
          setPerson(undefined); setPortfolioRecord(record)
        }} />
      </Modal>}
      {portfolioRecord && <Modal title="Досягнення з портфоліо" onClose={() => setPortfolioRecord(undefined)} beforeClose={canLeave}>
        <TeacherRecord id={portfolioRecord} groupId={group.id} />
      </Modal>}
      {confirmation && <Modal title={confirmation.label} onClose={() => setConfirmation(undefined)} busy={action.busy}>
        <p>{confirmation.text}</p>
        <ErrorNotice error={action.error} />
        <div className="actions">
          <button className="control" onClick={() => setConfirmation(undefined)} disabled={action.busy}>Скасувати</button>
          <button className="control primary" disabled={action.busy} onClick={() => void action.run(async () => {
            await confirmation.run()
            setConfirmation(undefined)
          })}>{action.busy ? 'Виконуємо…' : confirmation.label}</button>
        </div>
      </Modal>}
    </>}
  </section>
}

function SettingsPage() {
  const [address, setAddress] = useState('—')
  const health = useResource<{ version: string }>('/api/health/')
  type Review = { version: string; approved: boolean }
  const review = useResource<Review>('/api/review/')
  const action = useAction()
  useEffect(() => { void apiAddress().then(setAddress).catch(() => {}) }, [])
  return <div className="standard-page">
    <header className="page-heading"><h1>Налаштування</h1><p>Підключення до центрального сервера.</p></header>
    <dl className="facts">
      <div><dt>API</dt><dd><code>{address}</code></dd></div>
      <div><dt>Версія сервера</dt><dd>{health.data?.version ?? '—'}</dd></div>
      <div><dt>Версія застосунку</dt><dd>{version}</dd></div>
    </dl>
    <ErrorNotice error={health.error} />
    <button className="control" onClick={health.refresh} disabled={health.loading}>Перевірити зв’язок</button>
    <section className="group-section" aria-labelledby="review-heading">
      <h3 id="review-heading">Перевірка версії</h3>
      <ErrorNotice error={review.error} retry={review.refresh} />
      <ErrorNotice error={action.error} />
      {review.data && (review.data.version !== version
        ? <p className="hint">На сервері версія {review.data.version}. Оновіть застосунок для її перевірки.</p>
        : review.data.approved
          ? <p role="status">Вподобайку за версію {version} збережено.</p>
          : <button className="control" disabled={action.busy || Boolean(review.error)} onClick={() => void action.run(async () => {
            const result = await api<Review>('/api/review/', 'POST', { version })
            review.replace(() => result)
          })}><ThumbsUp size={16} aria-hidden="true" /> {action.busy ? 'Зберігаємо…' : 'Вподобати версію ' + version}</button>)}
    </section>
  </div>
}

export default function Teacher({ user, logout }: { user: User; logout: () => void }) {
  const [page, setPage] = useState(currentPage)
  const [menu, setMenu] = useState(false)
  const [selected, setSelected] = useState<number>()
  const [creating, setCreating] = useState(false)
  const summary = useResource<Summary>('/api/groups/', page)
  const groups = summary.data?.groups ?? []
  const pending = groups.reduce((sum, group) => sum + (group.archived ? 0 : group.pending), 0)
  const visible = groups.filter((group) => page === 'groups' || (!group.archived && (page !== 'requests' || group.pending > 0)))
  const open = groups.some((group) => group.id === selected) ? selected : visible[0]?.id

  useEffect(() => {
    function navigate() {
      setPage(currentPage())
      setSelected(undefined)
      setMenu(false)
      document.getElementById('workspace')?.focus({ preventScroll: true })
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])

  function changed(detail: GroupDetail) {
    setSelected(detail.id)
    const { memberships, invitation: _invitation, ...group } = detail
    const updated = { ...group, pending: memberships.filter((member) => member.status === 'pending').length,
      approved: memberships.filter((member) => member.status === 'approved').length }
    summary.replace((previous) => {
      const list = previous?.groups ?? []
      return { groups: list.some(({ id }) => id === group.id) ? list.map((entry) => entry.id === group.id ? updated : entry) : [updated, ...list] }
    })
  }

  function select(id: number) {
    setSelected(id)
    if (window.matchMedia('(max-width: 1080px)').matches) {
      requestAnimationFrame(() => {
        const panel = document.getElementById('group-panel')
        panel?.scrollIntoView()
        panel?.focus({ preventScroll: true })
      })
    }
  }

  return <div className="teacher-layout">
    <a href="#workspace" className="skip" onClick={(event) => { event.preventDefault(); document.getElementById('workspace')?.focus() }}>До вмісту</a>
    <aside className={'sidebar' + (menu ? ' menu-open' : '')}>
      <div className="sidebar-head">
        <a href="#overview" className="brand"><img src="/mark.svg" alt="" width="30" height="30" /><strong>Поступ</strong></a>
        <button className="icon-button menu-toggle" onClick={() => setMenu(!menu)} aria-expanded={menu}
          aria-controls="navigation" aria-label={menu ? 'Закрити меню' : 'Відкрити меню'}>
          {menu ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      <nav id="navigation" aria-label="Розділи">
        <div className="nav-group">
          <span className="nav-label">Кабінет учителя</span>
          {(Object.keys(pages) as Page[]).map((id) => {
            const { title, icon: Icon } = pages[id]
            return <a key={id} href={'#' + id} aria-current={page === id ? 'page' : undefined} onClick={(event) => {
              if (id !== page && !canLeave()) event.preventDefault()
              else setMenu(false)
            }}>
              <Icon size={17} aria-hidden="true" />{title}{id === 'requests' && pending > 0 && <span className="nav-count">{pending}</span>}
            </a>
          })}
        </div>
      </nav>
      <div className="sidebar-foot"><span>Поступ</span><span>v{version}</span></div>
    </aside>
    <div className="body">
      <header className="topbar"><span className="workspace-name">Кабінет учителя</span>
        <div className="top-meta"><span className="account-name">{user.full_name}</span>
          <button className="control" onClick={logout}>Вийти</button></div>
      </header>
      <main id="workspace" tabIndex={-1}>
        {page === 'settings' ? <SettingsPage /> : page === 'achievements' ? <TeacherAchievements groups={groups} /> : <>
          <header className="page-heading record-heading">
            <div><h1>{pages[page].title}</h1>
              <p>{summary.data ? 'Заявок, що очікують рішення: ' + pending : 'Ваші групи та заявки учнів.'}</p></div>
            <div className="actions">
              <button className="control" disabled={summary.loading} onClick={summary.refresh}><RefreshCw size={15} aria-hidden="true" /> Оновити</button>
              {page !== 'requests' && <button className="control primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> Створити групу</button>}
            </div>
          </header>
          <div className="workbench group-workbench">
            <section className="worklist" aria-label="Список груп">
              <ErrorNotice error={summary.error} retry={summary.refresh} />
              {summary.loading && !summary.data && <p role="status">Завантажуємо групи…</p>}
              {page === 'overview' && <a className="text-link" href="#requests">Переглянути заявки <ChevronRight size={15} aria-hidden="true" /></a>}
              {summary.data && !visible.length && <div className="empty"><h2>{page === 'requests' ? 'Нових заявок немає' : 'Груп поки немає'}</h2>
                <p>{page === 'requests' ? 'Нові заявки з’являться тут після подання учнями.' : 'Створіть групу, щоб запросити учнів.'}</p></div>}
              <ul className="record-list">
                {visible.map((group) => <li key={group.id}>
                  <button className="group-row" aria-current={open === group.id ? 'true' : undefined} onClick={() => select(group.id)}>
                    <span className="row-name"><strong>{group.name}</strong><span>{academicYear(group.year)}{group.archived ? ' · Архів' : ''}</span></span>
                    <span className="hint">{group.pending > 0 ? 'Заявок: ' + group.pending : 'Учасників: ' + group.approved}</span>
                    <ChevronRight className="row-chevron" size={15} aria-hidden="true" />
                  </button>
                </li>)}
              </ul>
            </section>
            {open !== undefined && <GroupPanel key={open} id={open} page={page} changed={changed} />}
          </div>
        </>}
      </main>
    </div>
    {creating && <GroupForm close={() => setCreating(false)} save={async (input) => {
      const result = await api<GroupDetail>('/api/groups/', 'POST', input)
      changed(result)
      setCreating(false)
      select(result.id)
    }} />}
  </div>
}
