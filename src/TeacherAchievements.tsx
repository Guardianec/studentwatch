import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { academicYear, type Group } from './api'
import { DocumentList, RecordBadges, ResultDetails } from './AchievementDetails'
import { PageButtons, years } from './PortfolioResults'
import { TeacherProfile } from './Profile'
import { DecisionForm, GroupReviews, History } from './ReviewDetails'
import {
  apiQuery, eventDate, recordPath, recordTitle, statuses, type Achievement, type Catalogue,
  type GroupReview, type RecordPage, type RecordSummary,
} from './portfolio'
import { canLeave, ErrorNotice, Modal, useResource } from './ui'

function RecordPanel({ id, groupId, refreshList, next, changeRecord, visit = '' }: {
  id: string; groupId?: number; refreshList: () => void; next?: () => void; changeRecord?: (id: string) => void; visit?: string
}) {
  const resource = useResource<Achievement>(recordPath(id), visit, true)
  const [profile, setProfile] = useState(false)
  const [message, setMessage] = useState('')
  const record = resource.data
  const review = record?.reviews?.find((item) => item.group_id === groupId)
  return <article className="group-panel teacher-record-panel" id={groupId ? 'teacher-record' : undefined} tabIndex={-1}>
    <ErrorNotice error={resource.error} retry={() => { resource.refresh(); refreshList() }} />
    {resource.loading && !record && <p role="status">Завантажуємо досягнення…</p>}
    {record && (!groupId || review) && <>
      <h2 className="group-title">{recordTitle(record)}</h2>
      {changeRecord ? <button className="text-link inline-link" onClick={() => { if (canLeave()) setProfile(true) }}>
        {record.student.full_name} <ChevronRight size={15} aria-hidden="true" />
      </button> : <p>{record.student.full_name}</p>}
      <p className="hint">Версія {record.version}</p>
      <GroupReviews reviews={review ? [review] : record.reviews} detail />
      <ResultDetails record={record} />
      <section className="portfolio-section"><h3>Документи</h3>
        <DocumentList record={record} seen={review?.seen_materials} onMissing={() => { resource.refresh(); refreshList() }} />
        {!review && record.reviews?.some((item) => item.new_materials) && <p className="hint">Є ще не переглянуті матеріали.</p>}
      </section>
      <History record={record} teacher groupId={groupId} />
      {review && <DecisionForm record={record} review={review} refresh={resource.refresh} done={(updated, notice) => {
        resource.replace(() => updated)
        setMessage(notice)
        refreshList()
      }} />}
      {message && <div className="actions decision-saved"><p role="status">{message}</p>
        {next && <button className="control" onClick={next}>Наступне досягнення <ChevronRight size={15} aria-hidden="true" /></button>}
      </div>}
      {profile && changeRecord && <Modal title="Академічний профіль" onClose={() => setProfile(false)}>
        <TeacherProfile id={record.student.id} groupId={groupId} openRecord={(recordId) => {
          setProfile(false)
          changeRecord(recordId)
        }} />
      </Modal>}
    </>}
    {record && groupId && !review && <p role="status">Доступ до подання в цю групу припинено.</p>}
  </article>
}

export function TeacherRecord({ id, groupId }: { id: string; groupId?: number }) {
  return <RecordPanel key={id} id={id} groupId={groupId} refreshList={() => {}} />
}

type QueueRow = RecordSummary & { review: GroupReview }

export default function TeacherAchievements({ groups }: { groups: Group[] }) {
  const [selected, setSelected] = useState<{ id: string; group: number }>()
  const [profileRecord, setProfileRecord] = useState<string>()
  const [nextItem, setNextItem] = useState<QueueRow>()
  const [openFirst, setOpenFirst] = useState(false)
  const [page, setPage] = useState(1)
  const [visit, setVisit] = useState(0)
  const [draftSearch, setDraftSearch] = useState('')
  const [filter, setFilter] = useState({ search: '', group: '', status: 'action', category: '', year: '', document: '' })
  const catalogue = useResource<Catalogue>('/api/catalogue/')
  const resource = useResource<RecordPage<QueueRow>>(apiQuery('/api/achievements/queue/', { ...filter, page: String(page) }), '', true)
  const records = resource.data?.records ?? []
  useEffect(() => {
    if (!openFirst || !resource.data || resource.loading) return
    setOpenFirst(false)
    const [first, following] = resource.data.records
    if (first) {
      setSelected({ id: first.id, group: first.review.group_id })
      setNextItem(following)
    }
  }, [openFirst, resource.data, resource.loading])
  function change(values: Partial<typeof filter>) {
    if (!canLeave()) return
    setFilter((current) => ({ ...current, ...values }))
    setPage(1)
    setSelected(undefined)
  }
  function open(item: QueueRow) {
    if (!canLeave()) return
    const index = records.indexOf(item)
    setSelected({ id: item.id, group: item.review.group_id })
    setNextItem(index < 0 ? undefined : records[index + 1])
    if (window.matchMedia('(max-width: 1080px)').matches) {
      requestAnimationFrame(() => document.getElementById('teacher-record')?.focus())
    }
  }
  const next = nextItem && records.find((item) => item.id === nextItem.id && item.review.group_id === nextItem.review.group_id)
  const nextPage = resource.data && resource.data.page < resource.data.pages ? resource.data.page + 1 : undefined
  const firstOnPage = records.find((item) => item.id !== selected?.id || item.review.group_id !== selected.group)
  function nextRecord() {
    if (next || firstOnPage) open(next ?? firstOnPage!)
    else if (nextPage) { setPage(nextPage); setSelected(undefined); setOpenFirst(true) }
  }
  return <>
    <header className="page-heading record-heading">
      <div><h1>На перевірці</h1><p>Подання до ваших груп і нові матеріали.</p></div>
      <button className="control" disabled={resource.loading} onClick={() => {
        resource.refresh()
        setVisit((value) => value + 1)
      }}><RefreshCw size={15} aria-hidden="true" /> Оновити</button>
    </header>
    <form className="teacher-search form filter-search" onSubmit={(event) => { event.preventDefault(); change({ search: draftSearch.trim() }) }}>
      <label>Учень або конкурс <input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} type="search" maxLength={120} /></label>
      <button className="control" type="submit">Знайти</button>
    </form>
    <div className="form teacher-filters review-filters">
      <label>Група <select value={filter.group} onChange={(event) => change({ group: event.target.value })}>
        <option value="">Усі групи</option>{groups.filter((group) => !group.archived).map((group) =>
          <option key={group.id} value={group.id}>{group.name}</option>)}
      </select></label>
      <label>Статус <select value={filter.status} onChange={(event) => change({ status: event.target.value })}>
        <option value="action">Потребують дії</option><option value="all">Усі подання</option>
        {Object.entries(statuses).filter(([key]) => key !== 'draft').map(([key, value]) => <option key={key} value={key}>{value}</option>)}
      </select></label>
      <label>Категорія <select value={filter.category} onChange={(event) => change({ category: event.target.value })}>
        <option value="">Усі категорії</option>{catalogue.data?.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Навчальний рік <select value={filter.year} onChange={(event) => change({ year: event.target.value })}>
        <option value="">Усі роки</option>{years.map((value) => <option key={value} value={value}>{academicYear(value)}</option>)}
      </select></label>
      <label>Документ <select value={filter.document} onChange={(event) => change({ document: event.target.value })}>
        <option value="">Усі записи</option><option value="present">Є файл</option>
        <option value="absent">Без файла</option><option value="waiting">Документ очікується</option>
      </select></label>
    </div>
    <div className="workbench group-workbench">
      <section className="worklist" aria-label="Подання до груп">
        <ErrorNotice error={resource.error} retry={resource.refresh} />
        {resource.loading && !resource.data && <p role="status">Завантажуємо подання…</p>}
        {resource.data && !records.length && <p className="hint">За цими умовами немає подань.</p>}
        <ul className="record-list portfolio-records">{records.map((item) => <li key={item.id + '/' + item.review.group_id}>
          <button className="group-row" aria-current={selected?.id === item.id && selected.group === item.review.group_id ? 'true' : undefined}
            onClick={() => open(item)}>
            <span className="row-name"><strong>{item.student.full_name} · {recordTitle(item)}</strong>
              <span>{[item.stage_name, item.academic_year && academicYear(item.academic_year), item.result_label].filter(Boolean).join(' · ')}</span>
              <span>{item.review.group} · {eventDate(item.review.submitted_at)}</span>
              <RecordBadges record={{ ...item, status: item.review.status }} teacher />
              {(item.resubmitted || item.review.new_materials) && <span>{[item.resubmitted && 'Повторно подано',
                item.review.new_materials && 'Нові матеріали'].filter(Boolean).join(' · ')}</span>}
            </span><ChevronRight size={15} aria-hidden="true" />
          </button>
        </li>)}</ul>
        {resource.data && <PageButtons data={resource.data} move={(value) => {
          if (canLeave()) { setPage(value); setSelected(undefined) }
        }} />}
      </section>
      {selected && <RecordPanel key={selected.id + '/' + selected.group} id={selected.id} groupId={selected.group} visit={String(visit)}
        refreshList={resource.refreshAfterWrite} next={next || firstOnPage || nextPage ? nextRecord : undefined} changeRecord={setProfileRecord} />}
    </div>
    {profileRecord && <Modal title="Досягнення з портфоліо" onClose={() => setProfileRecord(undefined)} beforeClose={canLeave}>
      <TeacherRecord id={profileRecord} groupId={selected?.group} />
      <button className="control" onClick={() => { if (canLeave()) setProfileRecord(undefined) }}><ChevronLeft size={15} aria-hidden="true" /> До черги</button>
    </Modal>}
  </>
}
