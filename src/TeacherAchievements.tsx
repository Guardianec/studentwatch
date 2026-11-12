import { useState } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { academicYear } from './api'
import { DocumentList, RecordBadges, ResultDetails } from './AchievementDetails'
import { TeacherProfile } from './Profile'
import { recordPath, recordTitle, waitingForDocument, type Achievement, type RecordSummary } from './portfolio'
import { ErrorNotice, Modal, useResource } from './ui'

function RecordPanel({ id, refreshList }: { id: string; refreshList: () => void }) {
  const resource = useResource<Achievement>(recordPath(id), '', true)
  const [profile, setProfile] = useState(false)
  const record = resource.data
  return <article className="group-panel teacher-record-panel" id="teacher-record" tabIndex={-1}>
    <ErrorNotice error={resource.error} retry={() => { resource.refresh(); refreshList() }} />
    {resource.loading && !record && <p role="status">Завантажуємо досягнення…</p>}
    {record && <>
      <h2 className="group-title">{recordTitle(record)}</h2>
      <button className="text-link inline-link" onClick={() => setProfile(true)}>
        {record.student.full_name} <ChevronRight size={15} aria-hidden="true" />
      </button>
      <p><RecordBadges record={record} teacher /></p>
      <ResultDetails record={record} />
      <section className="portfolio-section"><h3>Документи</h3>
        <DocumentList record={record} onMissing={() => { resource.refresh(); refreshList() }} />
      </section>
      {profile && <Modal title="Академічний профіль" onClose={() => setProfile(false)}>
        <TeacherProfile id={record.student.id} />
      </Modal>}
    </>}
  </article>
}

export default function TeacherAchievements() {
  const resource = useResource<{ records: RecordSummary[] }>('/api/achievements/', '', true)
  const [selected, setSelected] = useState<string>()
  const [student, setStudent] = useState('')
  const [competition, setCompetition] = useState('')
  const [year, setYear] = useState('')
  const [documentFilter, setDocument] = useState('')
  const records = resource.data?.records ?? []
  const competitions = Array.from(new Set(records.map((item) => item.competition_name))).sort((a, b) => a.localeCompare(b, 'uk'))
  const students = Array.from(new Map(records.map((item) => [item.student.id, item.student.full_name])))
    .sort(([, a], [, b]) => a.localeCompare(b, 'uk'))
  const years = Array.from(new Set(records.flatMap((item) => item.academic_year ?? []))).sort((a, b) => b - a)
  const visible = records.filter((item) => (!student || String(item.student.id) === student)
    && (!competition || item.competition_name === competition)
    && (!year || String(item.academic_year) === year)
    && (!documentFilter || (documentFilter === 'present' && item.has_document) || (documentFilter === 'absent' && !item.has_document)
      || (documentFilter === 'waiting' && waitingForDocument(item))))
  const open = visible.find((item) => item.id === selected)
  return <>
    <header className="page-heading record-heading">
      <div><h1>Досягнення</h1><p>Результати, надані вашим групам.</p></div>
      <button className="control" disabled={resource.loading} onClick={resource.refresh}><RefreshCw size={15} aria-hidden="true" /> Оновити</button>
    </header>
    <div className="form teacher-filters">
      <label>Учень <select value={student} onChange={(event) => setStudent(event.target.value)}>
        <option value="">Усі учні</option>{students.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>Конкурс <select value={competition} onChange={(event) => setCompetition(event.target.value)}>
        <option value="">Усі конкурси</option>{competitions.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <label>Навчальний рік <select value={year} onChange={(event) => setYear(event.target.value)}>
        <option value="">Усі роки</option>{years.map((value) => <option key={value} value={value}>{academicYear(value)}</option>)}
      </select></label>
      <label>Документ <select value={documentFilter} onChange={(event) => setDocument(event.target.value)}>
        <option value="">Усі записи</option><option value="present">Є файл</option>
        <option value="absent">Без файла</option><option value="waiting">Документ очікується</option>
      </select></label>
    </div>
    <div className="workbench group-workbench">
      <section className="worklist" aria-label="Надані досягнення">
        <ErrorNotice error={resource.error} retry={resource.refresh} />
        {resource.loading && !resource.data && <p role="status">Завантажуємо досягнення…</p>}
        {resource.data && !visible.length && <p className="hint">За цими умовами немає досягнень.</p>}
        <ul className="record-list portfolio-records">{visible.map((item) => <li key={item.id}>
          <button className="group-row" aria-current={open?.id === item.id ? 'true' : undefined} onClick={() => {
            setSelected(item.id)
            if (window.matchMedia('(max-width: 1080px)').matches) {
              requestAnimationFrame(() => document.getElementById('teacher-record')?.focus())
            }
          }}>
            <span className="row-name"><strong>{recordTitle(item)}</strong><span>{item.student.full_name}{item.season && ' · ' + item.season}</span></span>
            <RecordBadges record={item} teacher /><ChevronRight size={15} aria-hidden="true" />
          </button>
        </li>)}</ul>
      </section>
      {open && <RecordPanel key={open.id} id={open.id} refreshList={resource.refresh} />}
    </div>
  </>
}
