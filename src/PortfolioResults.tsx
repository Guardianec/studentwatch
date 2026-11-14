import { useId, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { academicYear, type Group } from './api'
import { RecordBadges } from './AchievementDetails'
import { GroupReviews } from './ReviewDetails'
import { RouteLink, useNavigation } from './navigation'
import { academicDate, apiQuery, recordTitle, resultKinds, statuses, type Catalogue, type PageInfo, type RecordPage, type RecordSummary } from './portfolio'
import { ErrorNotice, useResource } from './ui'

export const currentYear = new Date().getFullYear() - (new Date().getMonth() < 8 ? 1 : 0)
const years = Array.from({ length: 100 }, (_, index) => 2000 + (currentYear + 1 - 2000 - index + 100) % 100)

export function PageButtons({ data, move }: { data: PageInfo; move: (page: number) => void }) {
  if (data.pages <= 1) return null
  return <nav className="actions pagination" aria-label="Сторінки результатів">
    <button className="control" disabled={data.page <= 1} onClick={() => move(data.page - 1)}>Попередня</button>
    <span className="hint">Сторінка {data.page} з {data.pages}</span>
    <button className="control" disabled={data.page >= data.pages} onClick={() => move(data.page + 1)}>Наступна</button>
  </nav>
}

export function AcademicSearch({ label, placeholder }: { label: string; placeholder?: string }) {
  const { params, update } = useNavigation()
  const [search, setSearch] = useState(params.get('search') ?? '')
  return <form className="form filter-search" onSubmit={(event) => {
    event.preventDefault()
    update({ search: search.trim(), page: '' })
  }}>
    <label>{label}<input type="search" value={search} maxLength={120}
      onChange={(event) => setSearch(event.target.value)} placeholder={placeholder} /></label>
    <button className="control" type="submit"><Search size={16} aria-hidden="true" /> Знайти</button>
  </form>
}

export function YearFilter({ value, change, label = 'Навчальний рік' }: { value: string; change: (value: string) => void; label?: string }) {
  return <label>{label} <select value={value} onChange={(event) => change(event.target.value)}>
    <option value="">Усі роки</option>
    {years.map((year) => <option key={year} value={year}>{academicYear(year)}</option>)}
  </select></label>
}

type GroupOption = Pick<Group, 'id' | 'name'>
export function GroupFilter({ groups, value, change }: { groups: GroupOption[]; value: string; change: (value: string) => void }) {
  return <label>Група <select value={value} onChange={(event) => change(event.target.value)}>
    <option value="">Усі групи</option>
    {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
  </select></label>
}

export function AchievementRows({ records, to, person }: {
  records: RecordSummary[]; to: (item: RecordSummary) => string; person?: (id: number) => string
}) {
  return <ul className="academic-rows">{records.map((item) => <li key={item.id} className="academic-row">
    <div className="academic-row-content">
      <RouteLink className="academic-title" to={to(item)}>{recordTitle(item)} <ChevronRight size={16} aria-hidden="true" /></RouteLink>
      {person && <RouteLink className="text-link hint" to={person(item.student.id)}>{item.student.full_name}</RouteLink>}
      <p className="hint">{[item.result_label, item.stage_name, item.starts_on && academicDate(item.starts_on),
        !item.starts_on && item.academic_year && academicYear(item.academic_year)].filter(Boolean).join(' · ')}</p>
    </div>
    <div className="academic-row-status">
      <RecordBadges record={item} />
      <GroupReviews reviews={item.reviews} />
    </div>
  </li>)}</ul>
}

export function PortfolioResults({ studentId, groupId, groups = [], recordRoute, studentRoute, visit = '', teacher = false }: {
  studentId?: number; groupId?: number; groups?: GroupOption[]; recordRoute: (item: RecordSummary) => string
  studentRoute?: (id: number) => string; visit?: string; teacher?: boolean
}) {
  const { params, update } = useNavigation()
  const get = (key: string) => params.get(key) ?? ''
  const change = (name: string, value: string) => update({ [name]: value, page: '',
    ...(name === 'category' ? { competition: '', stage: '' } : name === 'competition' ? { stage: '' } : {}) })
  const group = groupId ? String(groupId) : get('group')
  const filters = Object.fromEntries(['year', 'category', 'competition', 'stage', 'status', 'participation',
    'search', 'document', 'sort', 'result_kind'].map((name) => [name, get(name)]))
  const catalogue = useResource<Catalogue>('/api/catalogue/')
  const resource = useResource<RecordPage>(apiQuery('/api/achievements/', {
    ...filters, group, student: studentId ? String(studentId) : '', page: get('page') || '1',
  }), visit, teacher)
  const categories = catalogue.data?.categories ?? []
  const competitions = categories.filter((item) => !filters.category || String(item.id) === filters.category).flatMap((item) => item.competitions)
  const stages = Array.from(new Set(competitions.filter((item) => !filters.competition || item.name === filters.competition)
    .flatMap((item) => item.cycles.flatMap((cycle) => cycle.stages.map(({ name }) => name)))))
  const uid = useId()
  return <>
    <AcademicSearch key={get('search')} label={teacher ? 'Учень, конкурс або результат' : 'Пошук у портфоліо'}
      placeholder={teacher ? 'Ім’я, назва конкурсу, відзнака' : 'Назва конкурсу або результат'} />
    <div className="form field-grid portfolio-filters">
      {!groupId && groups.length > 0 && <GroupFilter groups={groups} value={group} change={(value) => change('group', value)} />}
      <YearFilter value={filters.year} change={(value) => change('year', value)} />
      <label>Категорія <select value={filters.category} onChange={(event) => change('category', event.target.value)}>
        <option value="">Усі категорії</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Статус <select value={filters.status} onChange={(event) => change('status', event.target.value)}>
        <option value="">Усі статуси</option>{Object.entries(statuses).filter(([key]) => !teacher || key !== 'draft')
          .map(([key, value]) => <option key={key} value={key}>{value}</option>)}
        {!teacher && <option value="needs_student">Потребують моєї уваги</option>}
      </select></label>
    </div>
    <details className="filter-details" open={Boolean(filters.stage || filters.competition || filters.participation || filters.document || filters.sort || filters.result_kind) || undefined}>
      <summary>Додаткові фільтри й сортування</summary>
      <div className="form field-grid">
        <label>Сортування <select value={filters.sort} onChange={(event) => change('sort', event.target.value)}>
          <option value="">Спочатку нові події</option><option value="oldest">Спочатку давні події</option>
          <option value="recent">За оновленням</option><option value="competition">За конкурсом</option>
          {teacher && <option value="student">За ім’ям учня</option>}
        </select></label>
        <label>Конкурс <input list={uid + '-competitions'} maxLength={160} value={filters.competition}
          onChange={(event) => change('competition', event.target.value)} />
          <datalist id={uid + '-competitions'}>{competitions.map((item) => <option key={item.id} value={item.name} />)}</datalist>
        </label>
        <label>Етап <input list={uid + '-stages'} maxLength={120} value={filters.stage}
          onChange={(event) => change('stage', event.target.value)} />
          <datalist id={uid + '-stages'}>{stages.map((name) => <option key={name} value={name} />)}</datalist>
        </label>
        <label>Участь <select value={filters.participation} onChange={(event) => change('participation', event.target.value)}>
          <option value="">Усі види</option><option value="solo">Індивідуальна</option><option value="team">Командна</option>
        </select></label>
        <label>Матеріали <select value={filters.document} onChange={(event) => change('document', event.target.value)}>
          <option value="">Усі</option><option value="present">Є документ</option><option value="absent">Без документа</option>
          <option value="waiting">Документ очікується</option>
        </select></label>
        <label>Вид результату <select value={filters.result_kind} onChange={(event) => change('result_kind', event.target.value)}>
          <option value="">Усі види</option>{Object.entries(resultKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
      </div>
    </details>
    <ErrorNotice error={catalogue.error} retry={catalogue.refresh} />
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    {resource.loading && !resource.data && <p role="status">Завантажуємо результати…</p>}
    {resource.data && <>
      <p className="hint portfolio-counts" role="status">Досягнень {resource.data.counts.unique} · Підтверджених {resource.data.counts.verified}
        {' · Категорій ' + resource.data.counts.categories}</p>
      {!resource.data.records.length && <p className="empty">За цими умовами немає досягнень.</p>}
      <AchievementRows records={resource.data.records} to={recordRoute} person={studentRoute} />
      <PageButtons data={resource.data} move={(value) => update({ page: String(value) })} />
    </>}
  </>
}
