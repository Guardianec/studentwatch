import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { DocumentList, ResultDetails } from './AchievementDetails'
import { academicYear } from './api'
import { detailRoute, RouteLink, useNavigation } from './navigation'
import { SafeLink } from './Profile'
import { DecisionForm, GroupReviews, History } from './ReviewDetails'
import { academicDate, recordPath, recordTitle, statuses, type Achievement } from './portfolio'
import { ErrorNotice, useResource } from './ui'

export function TeacherRecord({ id, groupId }: { id: string; groupId?: number }) {
  const { route, params } = useNavigation()
  const resource = useResource<Achievement>(recordPath(id), '', true)
  const [message, setMessage] = useState('')
  const record = resource.data
  const review = record?.reviews?.find((item) => item.group_id === groupId)
  const origin = params.get('from') || '/inbox'
  const inbox = /^\/inbox(?:\?|$)/.test(origin) ? origin : '/inbox'
  return <article className="record-page">
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    {resource.loading && !record && <p role="status">Завантажуємо досягнення…</p>}
    {record && (!groupId || review) && <>
      <header className="page-heading"><h1>{recordTitle(record)}</h1>
        <p><RouteLink className="text-link" to={detailRoute('/students/' + record.student.id, route)}>{record.student.full_name}</RouteLink>
          {review && ' · ' + review.group}{record.academic_year && ' · ' + academicYear(record.academic_year)}</p>
      </header>
      <div className="result-lead"><strong>{record.result_label}</strong>
        <span>{[record.stage_name, record.starts_on && academicDate(record.starts_on), review && statuses[review.status]].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="record-columns">
        <div>
          <section className="portfolio-section"><h2>Матеріали</h2>
            <DocumentList record={record} seen={review?.seen_materials} onMissing={resource.refresh} />
            {record.results_url && <SafeLink url={record.results_url} />}
          </section>
          {review && record.resubmitted && <History record={record} teacher groupId={groupId} />}
          {review && <DecisionForm record={record} review={review} refresh={resource.refresh} done={(updated, notice) => {
            resource.replace(() => updated)
            setMessage(notice)
          }} />}
          {message && <div className="actions decision-saved"><p role="status">{message}</p>
            <RouteLink className="control" to={inbox}>До вхідних <ArrowRight size={15} aria-hidden="true" /></RouteLink>
          </div>}
          {review ? !record.resubmitted && <History record={record} teacher groupId={groupId} /> : <section className="portfolio-section">
            <GroupReviews reviews={record.reviews} detail />
            <div className="actions">{record.reviews?.map((item) => <RouteLink className="control" key={item.group_id}
              to={detailRoute('/achievements/' + id, route, item.group_id)}>{item.group} <ArrowRight size={15} aria-hidden="true" /></RouteLink>)}</div>
          </section>}
        </div>
        <aside><section className="portfolio-section"><h2>Відомості</h2><ResultDetails record={{ ...record, results_url: '' }} /></section>
          {review?.decision && <details className="portfolio-section"><summary>Останнє рішення</summary><GroupReviews reviews={[review]} detail /></details>}
          {!review && <History record={record} teacher />}
        </aside>
      </div>
    </>}
    {record && groupId && !review && <p role="status">Доступ до подання в цю групу припинено.</p>}
  </article>
}
