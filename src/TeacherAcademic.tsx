import { ArrowRight, ChevronRight, Inbox } from 'lucide-react'
import { academicYear, type Group } from './api'
import { detailRoute, RouteLink, useNavigation } from './navigation'
import { AchievementRows, AcademicSearch, GroupFilter, PageButtons, PortfolioResults, YearFilter } from './PortfolioResults'
import { ProfileDetails } from './Profile'
import { academicDate, apiQuery, type PageInfo, type Profile, type RecordSummary } from './portfolio'
import { ErrorNotice, useResource } from './ui'

type StudentRow = { id: number; full_name: string; achievement_count: number; recent: string | null; groups: Group[] }
type Overview = {
  students: number; achievements: number; verified: number; categories: number; recent: RecordSummary[]
  directions: { name: string; count: number }[]
  attention: { achievements: number; applications: number }
}

export function TeacherOverview({ groups }: { groups: Group[] }) {
  const { params, update, route } = useNavigation()
  const year = params.get('year') ?? ''
  const group = params.get('group') ?? ''
  const overview = useResource<Overview>(apiQuery('/api/teacher/overview/', { year, group }), '', true)
  const data = overview.data
  const scope = new URLSearchParams()
  if (group) scope.set('group', group)
  if (year) scope.set('year', year)
  const scoped = (path: string) => path + (scope.size ? '?' + scope : '')
  return <div className="academic-page">
    <header className="page-heading academic-heading"><div><h1>Академічний огляд</h1>
      <p>Результати, участь і напрями роботи ваших учнів.</p></div>
      <RouteLink className="control" to="/inbox"><Inbox size={17} aria-hidden="true" /> Вхідні</RouteLink>
    </header>
    <div className="form field-grid overview-scope">
      <YearFilter value={year} change={(value) => update({ year: value })} />
      <GroupFilter groups={groups} value={group} change={(value) => update({ group: value })} />
    </div>
    <ErrorNotice error={overview.error} retry={overview.refresh} />
    {overview.loading && !data && <p role="status">Завантажуємо огляд…</p>}
    {data && <>
      <div className="academic-metrics" aria-label="Підсумок за вибраними умовами">
        <RouteLink to={scoped('/students')}><strong>{data.students}</strong><span>Учні</span></RouteLink>
        <RouteLink to={scoped('/achievements')}><strong>{data.achievements}</strong><span>Досягнення</span></RouteLink>
        <RouteLink to={scoped('/achievements') + (scope.size ? '&' : '?') + 'status=verified'}><strong>{data.verified}</strong><span>Підтверджені записи</span></RouteLink>
        <div><strong>{data.categories}</strong><span>Академічні категорії</span></div>
      </div>
      <div className="overview-layout">
        <section aria-labelledby="recent-heading"><div className="section-heading spaced">
          <h2 id="recent-heading">Останні досягнення</h2>
          <RouteLink className="text-link" to={scoped('/achievements')}>Усі <ArrowRight size={15} aria-hidden="true" /></RouteLink>
        </div>
          {data.recent.length ? <AchievementRows records={data.recent}
            to={(item) => detailRoute('/achievements/' + item.id, route, group ? Number(group) : undefined)}
            person={(id) => detailRoute('/students/' + id, route)} />
            : <p className="empty">У вибраних групах і роках поки немає доступних досягнень.</p>}
        </section>
        <aside className="overview-secondary">
          <section aria-labelledby="attention-heading"><h2 id="attention-heading">Потребують уваги</h2>
            <RouteLink className="summary-link" to={scoped('/inbox')}><span>Досягнення й матеріали</span><strong>{data.attention.achievements}</strong></RouteLink>
            <RouteLink className="summary-link" to={scoped('/inbox') + (scope.size ? '&' : '?') + 'tab=applications'}><span>Заявки до груп</span><strong>{data.attention.applications}</strong></RouteLink>
          </section>
          <section aria-labelledby="directions-heading"><h2 id="directions-heading">Академічні напрями</h2>
            {data.directions.length ? <ul className="directions">{data.directions.map((item) => <li key={item.name}>
              <span>{item.name}</span><strong>{item.count}</strong>
              <meter min={0} max={data.achievements} value={item.count} aria-label={item.name}>{item.count}</meter>
            </li>)}</ul> : <p className="hint">Напрями з’являться, коли будуть результати конкурсів із довідника.</p>}
          </section>
        </aside>
      </div>
    </>}
  </div>
}

export function TeacherStudents({ groups }: { groups: Group[] }) {
  const { route, params, update } = useNavigation()
  const value = (name: string) => params.get(name) ?? ''
  const change = (name: string, next: string) => update({ [name]: next, page: '' })
  const resource = useResource<{ students: StudentRow[] } & PageInfo>(apiQuery('/api/teacher/students/', {
    search: value('search'), year: value('year'), group: value('group'), sort: value('sort'), page: value('page') || '1',
  }), '', true)
  return <div className="academic-page">
    <header className="page-heading"><h1>Учні</h1><p>Знайдіть учня й відкрийте його академічне портфоліо.</p></header>
    <AcademicSearch key={value('search')} label="Ім’я учня" placeholder="Наприклад, Софія" />
    <div className="form field-grid">
      <GroupFilter groups={groups} value={value('group')} change={(next) => change('group', next)} />
      <YearFilter value={value('year')} change={(next) => change('year', next)} />
      <label>Сортування <select value={value('sort')} onChange={(event) => change('sort', event.target.value)}>
        <option value="">За іменем</option><option value="recent">За останньою подією</option><option value="achievements">За кількістю досягнень</option>
      </select></label>
    </div>
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    {resource.loading && !resource.data && <p role="status">Завантажуємо учнів…</p>}
    {resource.data && <><p className="hint portfolio-counts" role="status">Учнів · {resource.data.total}</p>
      {!resource.data.students.length && <p className="empty">За цими умовами учнів немає.</p>}
      <ul className="academic-rows">{resource.data.students.map((item) => <li className="academic-row" key={item.id}>
        <div className="academic-row-content"><RouteLink className="academic-title" to={detailRoute('/students/' + item.id, route)}>
          <span className="initials" aria-hidden="true">{initials(item.full_name)}</span>{item.full_name}<ChevronRight size={16} aria-hidden="true" />
        </RouteLink><p className="hint">{item.groups.map(({ name }) => name).join(' · ')}</p></div>
        <div className="academic-row-status"><span>Досягнень · {item.achievement_count}</span>
          {item.recent && <p className="hint">{academicDate(item.recent)}</p>}</div>
      </li>)}</ul>
      <PageButtons data={resource.data} move={(page) => update({ page: String(page) })} />
    </>}
  </div>
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join('')
}

export function StudentWorkspace({ id }: { id: number }) {
  const { route } = useNavigation()
  const student = useResource<Profile & { groups: Group[] }>('/api/students/' + id + '/profile/', '', true)
  const profile = student.data
  return <>
    <ErrorNotice error={student.error} retry={student.refresh} />
    {student.loading && !profile && <p role="status">Завантажуємо профіль…</p>}
    {profile && <>
      <header className="page-heading person-heading"><span className="initials" aria-hidden="true">{initials(profile.full_name)}</span>
        <div><h1>{profile.full_name}</h1><p>{[profile.school, profile.grade].filter(Boolean).join(' · ')}</p></div>
      </header>
      <ul className="group-tags" aria-label="Групи учня">{profile.groups.map((item) => <li key={item.id}>
        <RouteLink to={detailRoute('/groups/' + item.id, route)}>{item.name} · {academicYear(item.year)}</RouteLink>
      </li>)}</ul>
      <section className="portfolio-section"><h2>Академічне портфоліо</h2>
        <PortfolioResults teacher studentId={id} groups={profile.groups}
          recordRoute={(item) => detailRoute('/achievements/' + item.id, route)} />
      </section>
      <details className="portfolio-section"><summary>Про учня</summary><ProfileDetails profile={profile} /></details>
    </>}
  </>
}
