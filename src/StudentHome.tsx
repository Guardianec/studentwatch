import { ArrowUpRight, BookOpen, Plus } from 'lucide-react'
import { academicYear, type User } from './api'
import { detailRoute, RouteLink, useNavigation } from './navigation'
import { AchievementRows, YearFilter } from './PortfolioResults'
import { apiQuery, type RecordPage } from './portfolio'
import { ErrorNotice, useResource } from './ui'

export default function StudentHome({ user, invitation }: { user: User; invitation: boolean }) {
  const { params, route, update } = useNavigation()
  const year = params.get('year') ?? ''
  const recent = useResource<RecordPage>(apiQuery('/api/achievements/', { page: '1', year }))
  const attention = useResource<RecordPage>(apiQuery('/api/achievements/', { page: '1', status: 'needs_student' }))
  const data = recent.data
  const records = data?.records.slice(0, 4) ?? []
  const open = (id: string) => detailRoute('/portfolio/' + id, route)
  return <>
    <header className="student-intro">
      <div><p className="student-overline">{user.full_name}</p><h1>Мій академічний шлях</h1>
        <p>Ваші конкурси, дослідження та результати в одному портфоліо.</p></div>
      <RouteLink to={open('new')} className="control primary"><Plus size={19} aria-hidden="true" /> Додати досягнення</RouteLink>
    </header>
    {invitation && <div className="student-callout"><strong>Є запрошення до групи</strong>
      <RouteLink className="text-link" to="/groups">Переглянути запрошення <ArrowUpRight size={15} aria-hidden="true" /></RouteLink></div>}
    <div className="section-heading spaced student-summary-heading"><h2>Моє портфоліо</h2>
      <div className="form"><YearFilter value={year} change={(next) => update({ year: next })} /></div>
    </div>
    <ErrorNotice error={recent.error} retry={recent.refresh} />
    <ErrorNotice error={attention.error} retry={attention.refresh} />
    {(recent.loading && !data) && <p role="status">Завантажуємо портфоліо…</p>}
    {data && <>
      <div className="academic-metrics student-metrics">
        <RouteLink to={'/portfolio' + (year ? '?year=' + year : '')}><strong>{data.counts.unique}</strong><span>Записів</span></RouteLink>
        <RouteLink to={'/portfolio?status=verified' + (year ? '&year=' + year : '')}><strong>{data.counts.verified}</strong><span>Підтверджено</span></RouteLink>
        <div><strong>{data.counts.categories}</strong><span>Академічні категорії</span></div>
      </div>
      {year && <p className="hint student-year">{academicYear(Number(year))} навчальний рік</p>}
    </>}
    {Boolean(attention.data?.total) && <section className="student-section" aria-labelledby="student-attention">
      <div className="section-heading spaced"><h2 id="student-attention">Потрібна ваша увага</h2>
        <RouteLink className="text-link" to="/portfolio?status=needs_student">Усі</RouteLink></div>
      <AchievementRows records={attention.data!.records.slice(0, 3)} to={(item) => open(item.id)} />
    </section>}
    <section className="student-section" aria-labelledby="student-recent">
      <div className="section-heading spaced"><h2 id="student-recent">Останні досягнення</h2>
        <RouteLink className="text-link" to="/portfolio">Усе портфоліо <ArrowUpRight size={15} aria-hidden="true" /></RouteLink></div>
      {records.length ? <AchievementRows records={records} to={(item) => open(item.id)} /> : data &&
        <div className="student-empty"><BookOpen size={26} aria-hidden="true" />
          <h3>{year ? 'За цей рік записів немає' : 'Почніть із першого досягнення'}</h3>
          <p>Додайте участь, відзнаку чи дослідження. Документ можна прикріпити пізніше.</p>
        </div>}
    </section>
  </>
}
