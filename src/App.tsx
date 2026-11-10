import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight, Award, ChevronRight, ClipboardList,
  FlaskConical, House, Menu, RefreshCw, Search, Settings, Trophy, Users, X,
} from 'lucide-react'
import { version as appVersion } from '../package.json'
import { achievements, groups, pending, students, type Status, type Student } from './demo'
import { apiOrigin, checkServer } from './health'

const pages = {
  overview: { name: 'Огляд', icon: House },
  students: { name: 'Учні', icon: Users },
  achievements: { name: 'Досягнення', icon: Award },
  review: { name: 'На перевірці', icon: ClipboardList },
  ratings: { name: 'Рейтинги', icon: Trophy },
  analysis: { name: 'Аналіз', icon: FlaskConical },
  settings: { name: 'Налаштування', icon: Settings },
}

type Page = keyof typeof pages
type RecordPage = 'overview' | 'achievements' | 'review'
type Achievement = typeof achievements[number]
type Preview = { student: Student } | { record: Achievement }
type ServerState = { kind: 'checking' | 'offline' } | { kind: 'online'; version: string }

const navigation: { title: string; pages: Page[] }[] = [
  { title: 'Портфоліо', pages: ['overview', 'students', 'achievements', 'review'] },
  { title: 'Інструменти', pages: ['ratings', 'analysis', 'settings'] },
]

const statusTone: Record<Status, string> = {
  'На перевірці': 'pending',
  'Підтверджено': 'confirmed',
  'Потребує уточнення': 'clarify',
  'Чернетка': 'draft',
}

const serverLabels = { checking: 'Перевіряємо сервер', online: 'Сервер відповідає', offline: 'Сервер недоступний' }
const shortDate = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const longDate = new Intl.DateTimeFormat('uk-UA', { dateStyle: 'long', timeZone: 'UTC' })
const recent = achievements.filter(({ status }) => status === 'Підтверджено' || status === 'Потребує уточнення').slice(0, 3)

function currentPage(): Page {
  const hash = window.location.hash.slice(1)
  return Object.hasOwn(pages, hash) ? hash as Page : 'overview'
}

function getStudent(id: Student['id']) {
  return students.find((student) => student.id === id)!
}

function RecordStatus({ status }: { status: Status }) {
  return <span className={'record-status ' + statusTone[status]}>{status}</span>
}

function DateLabel({ date, full = false }: { date: string; full?: boolean }) {
  return <time dateTime={date}>{(full ? longDate : shortDate).format(new Date(date))}</time>
}

function RecordList({ items, selected, onSelect, showStatus = false }: {
  items: Achievement[]
  selected: string
  onSelect: (record: Achievement) => void
  showStatus?: boolean
}) {
  return <ul className="record-list">
    {items.map((record) => {
      const student = getStudent(record.student)
      return <li key={record.id}>
        <button className={'record-row' + (showStatus ? ' with-status' : '')}
          aria-current={selected === record.id ? 'true' : undefined} onClick={() => onSelect(record)}>
          <span className="row-name"><strong>{student.name}</strong><span>{record.contest}</span></span>
          {showStatus && <RecordStatus status={record.status} />}
          <span className="row-group">{student.group}</span>
          <DateLabel date={record.date} />
          <ChevronRight className="row-chevron" size={15} aria-hidden="true" />
        </button>
      </li>
    })}
  </ul>
}

function RecordFacts({ record }: { record: Achievement }) {
  return <dl className="facts">
    <div className="result-fact"><dt>Результат</dt><dd>{record.result}</dd></div>
    <div><dt>Дата запису</dt><dd><DateLabel date={record.date} full /></dd></div>
    <div><dt>Статус</dt><dd><RecordStatus status={record.status} /></dd></div>
  </dl>
}

function RecordWorkspace({ page, onOpen }: { page: RecordPage; onOpen: (preview: Preview) => void }) {
  const overview = page === 'overview'
  const items = page === 'achievements' ? achievements : pending
  const [selected, setSelected] = useState(items[0])
  const inspector = useRef<HTMLElement>(null)
  const student = getStudent(selected.student)

  function select(record: Achievement) {
    if (inspector.current?.offsetWidth) setSelected(record)
    else onOpen({ record })
  }

  return <>
    <header className="page-heading record-heading">
      <div>
        <h1>{overview ? 'Огляд досягнень' : pages[page].name}</h1>
        {overview ? <p className="overview-summary">
          <a href="#students">{students.length} учнів</a><span aria-hidden="true">·</span>
          <a href="#achievements">{achievements.length} досягнень</a>
        </p> : <p>{page === 'review' ? 'Заявки, які очікують на рішення вчителя.' : 'Результати конкурсів і дослідницьких робіт.'}</p>}
      </div>
      <div className="year"><span>Навчальний рік</span><strong>2026/27</strong></div>
    </header>
    <div className="workbench">
      <div className="worklist">
        <section aria-labelledby="worklist-title">
          <div className="section-heading">
            <h2 id="worklist-title">{page === 'achievements' ? 'Записи портфоліо' : 'Черга перевірки'}</h2>
            <span className="list-count">{items.length}</span>
            {overview && <a className="text-link" href="#review">Уся черга <ArrowRight size={15} aria-hidden="true" /></a>}
          </div>
          <div className={'column-labels' + (page === 'achievements' ? ' with-status' : '')} aria-hidden="true">
            <span>Учень і конкурс</span>
            {page === 'achievements' && <span>Статус</span>}
            <span>Клас</span>
            <span>Дата</span>
          </div>
          <RecordList items={items} selected={selected.id} onSelect={select} showStatus={page === 'achievements'} />
        </section>
        {overview && <section className="recent" aria-labelledby="recent-title">
          <div className="section-heading"><h2 id="recent-title">Останні зміни</h2></div>
          <ul>
            {recent.map((record) => <li key={record.id}>
              <button className="activity-row" aria-current={selected.id === record.id ? 'true' : undefined}
                onClick={() => select(record)}>
                <span className="row-name"><strong>{getStudent(record.student).name}</strong><span>{record.contest}</span></span>
                <RecordStatus status={record.status} />
                <DateLabel date={record.date} />
              </button>
            </li>)}
          </ul>
        </section>}
      </div>
      <section className="inspector" ref={inspector} aria-labelledby="inspector-title">
        <div className="inspector-content">
          <h2 className="inspector-heading" id="inspector-title">Запис <span>№ {selected.id.padStart(2, '0')}</span></h2>
          <div aria-live="polite" aria-atomic="true">
            <h3>{selected.contest}</h3>
            <p>{student.name} · {student.group}</p>
            <RecordFacts record={selected} />
          </div>
        </div>
      </section>
    </div>
  </>
}

function StudentList({ onOpen }: { onOpen: (preview: Preview) => void }) {
  const search = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('')
  const visible = students.filter((student) =>
    (!group || student.group === group) && student.name.toLocaleLowerCase('uk').includes(query.trim().toLocaleLowerCase('uk')),
  )

  return <div className="standard-page">
    <header className="page-heading">
      <h1>Учні</h1>
      <p>Портфоліо учнів за 2026/27 навчальний рік.</p>
    </header>
    <section aria-label="Список учнів">
      <div className="filters">
        <label className="search"><Search size={16} aria-hidden="true" /><input ref={search} type="search" value={query}
          onChange={(event) => setQuery(event.target.value)} placeholder="Пошук за ім’ям" aria-label="Пошук за ім’ям" /></label>
        <label className="class-filter">Клас
          <select value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="">Усі класи</option>
            {groups.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
        <p className="results-count" role="status">Знайдено учнів: {visible.length}</p>
      </div>
      {visible.length ? <>
        <div className="student-row column-labels" aria-hidden="true"><span>Учень</span><span>Клас</span><span>Записи</span></div>
        <ul className="record-list">
          {visible.map((student) => {
            const count = achievements.filter((record) => record.student === student.id).length
            return <li key={student.id}>
              <button className="student-row" onClick={() => onOpen({ student })}>
                <strong>{student.name}</strong>
                <span>{student.group}</span>
                <span><span className="sr-only">Записів: </span>{count}</span>
                <ChevronRight className="row-chevron" size={15} aria-hidden="true" />
              </button>
            </li>
          })}
        </ul>
      </> : <div className="empty">
        <h2>Збігів немає</h2><p>Спробуйте інше ім’я або виберіть усі класи.</p>
        <button className="control" onClick={() => {
          setQuery('')
          setGroup('')
          search.current?.focus()
        }}>Скинути фільтри</button>
      </div>}
    </section>
  </div>
}

function PreviewDialog({ preview, onClose }: { preview: Preview; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])

  const record = 'record' in preview ? preview.record : undefined
  const student = 'student' in preview ? preview.student : getStudent(preview.record.student)

  return <dialog ref={dialog} onClose={onClose} aria-labelledby="preview-title">
    <div className="dialog-top">
      <span>{record ? 'Відомості про запис' : 'Портфоліо учня'}</span>
      <button className="icon-button" aria-label="Закрити" onClick={() => dialog.current?.close()} autoFocus>
        <X size={20} aria-hidden="true" />
      </button>
    </div>
    <div className="dialog-content">
      <h2 id="preview-title">{record ? record.contest : student.name}</h2>
      <p>{record ? student.name + ' · ' : ''}{student.group} клас · Вигадані дані</p>
      {record ? <RecordFacts record={record} /> : <ul className="portfolio">
        {achievements.filter((item) => item.student === student.id).map((item) => <li key={item.id}>
          <div className="row-name"><strong>{item.contest}</strong><span>{item.result} · <DateLabel date={item.date} /></span></div>
          <RecordStatus status={item.status} />
        </li>)}
      </ul>}
    </div>
  </dialog>
}

function SettingsPage({ server, retry }: { server: ServerState; retry: () => void }) {
  return <div className="standard-page">
    <header className="page-heading"><h1>Налаштування</h1><p>Підключення та відомості про застосунок.</p></header>
    <section aria-labelledby="connection-title">
      <div className="section-heading"><h2 id="connection-title">Локальний сервер</h2></div>
      <dl className="facts">
        <div><dt>Адреса</dt><dd><code>{apiOrigin}</code></dd></div>
        <div><dt>Стан</dt><dd>{serverLabels[server.kind]}</dd></div>
        <div><dt>Версія сервера</dt><dd>{server.kind === 'online' ? server.version : '—'}</dd></div>
      </dl>
      <div className="settings-actions">
        <button className="control" onClick={retry} disabled={server.kind === 'checking'}>
          <RefreshCw size={16} aria-hidden="true" /> Перевірити зв’язок
        </button>
        <p>Демозаписи доступні без підключення.</p>
      </div>
    </section>
    <section className="about" aria-labelledby="about-title">
      <div className="section-heading"><h2 id="about-title">Про застосунок</h2></div>
      <dl className="facts"><div><dt>Версія застосунку</dt><dd>{appVersion}</dd></div></dl>
    </section>
  </div>
}

function FuturePage({ page }: { page: 'ratings' | 'analysis' }) {
  return <div className="standard-page">
    <header className="page-heading"><h1>{pages[page].name}</h1></header>
    <section className="empty future">
      <h2>{page === 'ratings' ? 'Рейтинги з’являться у версії 0.5.0' : 'Перші звіти з’являться у версії 0.6.0'}</h2>
      <p>{page === 'ratings' ? 'Поки можна переглянути окремі результати конкурсів.' : 'Поки можна переглянути портфоліо окремих учнів.'}</p>
      <a className="text-link" href={page === 'ratings' ? '#achievements' : '#students'}>
        {page === 'ratings' ? 'До досягнень' : 'До учнів'} <ArrowRight size={16} aria-hidden="true" />
      </a>
    </section>
  </div>
}

export default function App() {
  const [page, setPage] = useState(currentPage)
  const [menuOpen, setMenuOpen] = useState(false)
  const [preview, setPreview] = useState<Preview>()
  const [server, setServer] = useState<ServerState>({ kind: 'checking' })
  const [check, setCheck] = useState(0)
  const main = useRef<HTMLElement>(null)

  useEffect(() => {
    function navigate() {
      setPage(currentPage())
      setMenuOpen(false)
      setPreview(undefined)
      main.current?.focus({ preventScroll: true })
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])

  useEffect(() => { document.title = pages[page].name + ' — Поступ' }, [page])

  useEffect(() => {
    const controller = new AbortController()
    checkServer(controller.signal).then(
      (version) => { if (!controller.signal.aborted) setServer({ kind: 'online', version }) },
      () => { if (!controller.signal.aborted) setServer({ kind: 'offline' }) },
    )
    return () => controller.abort()
  }, [check])

  function retry() {
    setServer({ kind: 'checking' })
    setCheck((value) => value + 1)
  }

  return <>
    <a className="skip" href="#workspace" onClick={(event) => { event.preventDefault(); main.current?.focus() }}>До вмісту</a>
    <aside className={'sidebar' + (menuOpen ? ' menu-open' : '')}>
      <div className="sidebar-head">
        <a href="#overview" className="brand" onClick={() => setMenuOpen(false)}>
          <img src="/mark.svg" alt="" width="30" height="30" />
          <strong>Поступ</strong>
        </a>
        <button className="icon-button menu-toggle" aria-label={menuOpen ? 'Закрити меню' : 'Відкрити меню'}
          aria-controls="navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </div>
      <nav id="navigation" aria-label="Розділи">
        {navigation.map((group) => <div className="nav-group" key={group.title}>
          <span className="nav-label">{group.title}</span>
          {group.pages.map((id) => {
            const { icon: Icon, name } = pages[id]
            return <a key={id} href={'#' + id} aria-current={page === id ? 'page' : undefined} onClick={() => {
              if (menuOpen && page === id) main.current?.focus()
              setMenuOpen(false)
            }}>
              <Icon size={17} aria-hidden="true" /><span>{name}</span>{id === 'review' && <span className="nav-count">{pending.length}</span>}
            </a>
          })}
        </div>)}
      </nav>
      <div className="sidebar-foot"><span>Вигадані дані</span><span>v{appVersion}</span></div>
    </aside>
    <div className="body">
      <header className="topbar">
        <span className="workspace-name">Кабінет учителя</span>
        <div className="top-meta">
          <span className="demo-mode" title="Усі записи вигадані">Деморежим</span>
          <a className={'server ' + server.kind} href="#settings"><span role="status">{serverLabels[server.kind]}</span></a>
        </div>
      </header>
      <main id="workspace" ref={main} tabIndex={-1}>
        {(page === 'overview' || page === 'achievements' || page === 'review') && <RecordWorkspace key={page} page={page} onOpen={setPreview} />}
        {page === 'students' && <StudentList onOpen={setPreview} />}
        {(page === 'ratings' || page === 'analysis') && <FuturePage page={page} />}
        {page === 'settings' && <SettingsPage server={server} retry={retry} />}
      </main>
    </div>
    {preview && <PreviewDialog preview={preview} onClose={() => setPreview(undefined)} />}
  </>
}
