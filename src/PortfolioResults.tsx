import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { academicYear, type Group } from './api'
import { RecordBadges } from './AchievementDetails'
import { GroupReviews } from './ReviewDetails'
import { apiQuery, recordTitle, statuses, type Catalogue, type PageInfo, type RecordPage } from './portfolio'
import { ErrorNotice, useResource } from './ui'

type GroupOption = Pick<Group, 'id' | 'name'>
const recentYear = new Date().getFullYear()
export const years = Array.from({ length: Math.max(1, recentYear + 2 - 2000) }, (_, index) => recentYear + 1 - index)

export function PageButtons({ data, move }: { data: PageInfo; move: (page: number) => void }) {
  if (data.pages <= 1) return null
  return <nav className="actions pagination" aria-label="Сторінки результатів">
    <button className="control" disabled={data.page <= 1} onClick={() => move(data.page - 1)}>Попередня</button>
    <span className="hint">Сторінка {data.page} з {data.pages}</span>
    <button className="control" disabled={data.page >= data.pages} onClick={() => move(data.page + 1)}>Наступна</button>
  </nav>
}

export function PortfolioResults({ studentId, groupId, groups = [], onOpen, document = '', visit = '', disabled }: {
  studentId?: number; groupId?: number; groups?: GroupOption[]; onOpen: (id: string) => void
  document?: string; visit?: string; disabled?: boolean
}) {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState({ group: '', year: '', category: '', competition: '', stage: '', status: '', participation: '' })
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const catalogue = useResource<Catalogue>('/api/catalogue/')
  const resource = useResource<RecordPage>(apiQuery('/api/achievements/', {
    ...filter, group: groupId ? String(groupId) : filter.group, student: studentId ? String(studentId) : '',
    document, search: query, page: String(page),
  }), visit, Boolean(studentId))
  const categories = catalogue.data?.categories ?? []
  const competitions = categories.filter((item) => !filter.category || String(item.id) === filter.category).flatMap((item) => item.competitions)
  const stages = Array.from(new Set(competitions.filter((item) => !filter.competition || item.name === filter.competition)
    .flatMap((item) => item.cycles.flatMap((cycle) => cycle.stages.map(({ name }) => name)))))
  function change(values: Partial<typeof filter>) {
    setFilter((current) => ({ ...current, ...values }))
    setPage(1)
  }
  return <>
    <form className="form filter-search" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); setPage(1) }}>
      <label>Пошук за конкурсом <input type="search" value={search} maxLength={120}
        onChange={(event) => setSearch(event.target.value)} placeholder="Назва конкурсу" /></label>
      <button className="control" type="submit">Знайти</button>
    </form>
    <div className="form field-grid portfolio-filters">
      {!groupId && groups.length > 1 && <label>Група <select value={filter.group} onChange={(event) => change({ group: event.target.value })}>
        <option value="">Усі групи</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select></label>}
      <label>Навчальний рік <select value={filter.year} onChange={(event) => change({ year: event.target.value })}>
        <option value="">Усі роки</option>{years.map((year) => <option key={year} value={year}>{academicYear(year)}</option>)}
      </select></label>
      <label>Категорія <select value={filter.category} onChange={(event) => change({ category: event.target.value, competition: '', stage: '' })}>
        <option value="">Усі категорії</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Конкурс <input list="portfolio-competitions" maxLength={160} value={filter.competition}
        onChange={(event) => change({ competition: event.target.value, stage: '' })} placeholder="Усі конкурси" />
        <datalist id="portfolio-competitions">{competitions.map((item) => <option key={item.id} value={item.name} />)}</datalist>
      </label>
      <label>Етап <input list="portfolio-stages" maxLength={120} value={filter.stage}
        onChange={(event) => change({ stage: event.target.value })} placeholder="Усі етапи" />
        <datalist id="portfolio-stages">{stages.map((name) => <option key={name} value={name} />)}</datalist>
      </label>
      <label>Статус <select value={filter.status} onChange={(event) => change({ status: event.target.value })}>
        <option value="">Усі статуси</option>{Object.entries(statuses).filter(([key]) => !studentId || key !== 'draft')
          .map(([key, value]) => <option key={key} value={key}>{value}</option>)}
      </select></label>
      <label>Участь <select value={filter.participation} onChange={(event) => change({ participation: event.target.value })}>
        <option value="">Усі види</option><option value="solo">Індивідуальна</option><option value="team">Командна</option>
      </select></label>
    </div>
    <ErrorNotice error={catalogue.error} retry={catalogue.refresh} />
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    {resource.loading && !resource.data && <p role="status">Завантажуємо результати…</p>}
    {resource.data && <>
      <p className="hint portfolio-counts" role="status">Досягнень {resource.data.counts.unique} · Підтверджених {resource.data.counts.verified}
        {' · Категорій ' + resource.data.counts.categories}</p>
      {!resource.data.records.length && <p>За цими умовами немає досягнень.</p>}
      <ul className="record-list portfolio-records">{resource.data.records.map((item) => <li key={item.id}>
        <button className="group-row" disabled={disabled} onClick={() => onOpen(item.id)}>
          <span className="row-name"><strong>{recordTitle(item)}</strong>
            <span>{[item.stage_name, item.academic_year && academicYear(item.academic_year), item.result_label].filter(Boolean).join(' · ')}</span>
            <RecordBadges record={item} />
          </span><ChevronRight size={15} aria-hidden="true" />
        </button>
        <GroupReviews reviews={item.reviews?.filter((review) => !(groupId || filter.group) || String(review.group_id) === String(groupId || filter.group))} />
      </li>)}</ul>
      <PageButtons data={resource.data} move={setPage} />
    </>}
  </>
}
