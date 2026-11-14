import { ChevronRight, RefreshCw } from 'lucide-react'
import { api, type Group } from './api'
import { detailRoute, RouteLink, useNavigation } from './navigation'
import { AcademicSearch, GroupFilter, PageButtons, YearFilter } from './PortfolioResults'
import { apiQuery, eventDate, recordTitle, statuses, type Catalogue, type GroupReview, type PageInfo, type RecordSummary } from './portfolio'
import { ErrorNotice, useAction, useResource } from './ui'

type QueueRow = RecordSummary & { review: GroupReview }
type Application = { id: number; full_name: string; group: string; group_id: number; requested_at: string }

export default function TeacherInbox({ groups, changed }: { groups: Group[]; changed: () => void }) {
  const { params, route, update } = useNavigation()
  const value = (key: string) => params.get(key) ?? ''
  const applications = value('tab') === 'applications'
  const change = (key: string, next: string) => update({ [key]: next, page: '' })
  const common = { group: value('group'), year: value('year'), page: value('page') || '1' }
  return <div className="academic-page">
    <header className="page-heading"><h1>Вхідні</h1><p>Подання, нові матеріали та заявки, які потребують рішення.</p></header>
    <nav className="view-switch" aria-label="Тип справ">
      <button aria-pressed={!applications} onClick={() => change('tab', '')}>Досягнення й матеріали</button>
      <button aria-pressed={applications} onClick={() => change('tab', 'applications')}>Заявки до груп</button>
    </nav>
    <div className="form field-grid">
      <GroupFilter groups={groups} value={common.group} change={(next) => change('group', next)} />
      <YearFilter label={applications ? 'Рік групи' : undefined} value={common.year} change={(next) => change('year', next)} />
    </div>
    {applications ? <Applications query={common} changed={changed} /> : <Queue query={common} current={route} />}
  </div>
}

function Applications({ query, changed }: { query: Record<string, string>; changed: () => void }) {
  const { update, route } = useNavigation()
  const resource = useResource<{ applications: Application[] } & PageInfo>(apiQuery('/api/teacher/applications/', query), '', true)
  const action = useAction()
  function decide(item: Application, status: 'approved' | 'rejected') {
    if (status === 'rejected' && !window.confirm('Відхилити заявку? Учень не зможе подати її повторно.')) return
    void action.run(async () => {
      await api('/api/groups/' + item.group_id + '/members/' + item.id + '/', 'PATCH', { status })
      resource.refreshAfterWrite()
      changed()
    })
  }
  return <>
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    <ErrorNotice error={action.error} />
    {resource.loading && !resource.data && <p role="status">Завантажуємо заявки…</p>}
    {resource.data && <><p className="portfolio-counts hint" role="status">Заявок · {resource.data.total}</p>
      {resource.data.total === 0 && <p className="empty">Нових заявок за цими умовами немає.</p>}
      <ul className="academic-rows">{resource.data.applications.map((item) => <li className="academic-row" key={item.id}>
        <div className="academic-row-content"><strong>{item.full_name}</strong>
          <RouteLink className="text-link" to={detailRoute('/groups/' + item.group_id, route)}>{item.group}</RouteLink>
          <p className="hint">{eventDate(item.requested_at)}</p></div>
        <div className="actions"><button className="control primary" disabled={action.busy} onClick={() => decide(item, 'approved')}>Прийняти</button>
          <button className="control" disabled={action.busy} onClick={() => decide(item, 'rejected')}>Відхилити</button></div>
      </li>)}</ul>
      <PageButtons data={resource.data} move={(page) => update({ page: String(page) })} />
    </>}
  </>
}

function Queue({ query, current }: { query: Record<string, string>; current: string }) {
  const { params, update } = useNavigation()
  const get = (key: string) => params.get(key) ?? ''
  const status = get('status') || 'action'
  const reason = status === 'action' ? get('reason') : ''
  const catalogue = useResource<Catalogue>('/api/catalogue/')
  const resource = useResource<{ records: QueueRow[] } & PageInfo>(apiQuery('/api/achievements/queue/', {
    ...query, status, reason, search: get('search'), document: get('document'), category: get('category'),
  }), '', true)
  const change = (key: string, value: string) => update({ [key]: value, page: '' })
  return <>
    <AcademicSearch key={get('search')} label="Учень, конкурс або результат" />
    <div className="form field-grid">
      <label>Стан <select value={status} onChange={(event) => change('status', event.target.value)}>
        <option value="action">Потребують дії</option><option value="all">Усі подання</option>
        {Object.entries(statuses).filter(([key]) => key !== 'draft').map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      {status === 'action' && <label>Причина <select value={reason} onChange={(event) => change('reason', event.target.value)}>
        <option value="">Усі причини</option><option value="new">Нове подання</option>
        <option value="revised">Повторне подання</option><option value="materials">Нові матеріали</option>
      </select></label>}
      <label>Матеріали <select value={get('document')} onChange={(event) => change('document', event.target.value)}>
        <option value="">Усі</option><option value="present">Є документ</option><option value="absent">Без документа</option>
        <option value="waiting">Документ очікується</option>
      </select></label>
      <label>Категорія <select value={get('category')} onChange={(event) => change('category', event.target.value)}>
        <option value="">Усі категорії</option>
        {catalogue.data?.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
    </div>
    <div className="section-heading spaced">
      <p className="hint" role="status">{resource.data && 'Подань за групами · ' + resource.data.total}</p>
      <button className="control" disabled={resource.loading} onClick={resource.refresh}><RefreshCw size={15} aria-hidden="true" /> Оновити</button>
    </div>
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    <ErrorNotice error={catalogue.error} retry={catalogue.refresh} />
    {resource.loading && !resource.data && <p role="status">Завантажуємо подання…</p>}
    {resource.data && <>
      {!resource.data.records.length && <p className="empty">За цими умовами немає подань.</p>}
      <ul className="academic-rows">{resource.data.records.map((item) => <li className="academic-row" key={item.id + '/' + item.review.group_id}>
        <div className="academic-row-content">
          <RouteLink className="academic-title" to={detailRoute('/achievements/' + item.id, current, item.review.group_id)}>
            {recordTitle(item)} <ChevronRight size={16} aria-hidden="true" /></RouteLink>
          <p>{item.student.full_name} · {item.review.group}</p><p className="hint">{eventDate(item.review.submitted_at)}</p>
        </div>
        <div className="academic-row-status"><strong>{statuses[item.review.status]}</strong>
          {item.resubmitted && <p className="hint">Повторне подання</p>}{item.review.new_materials && <p className="hint">Нові матеріали</p>}</div>
      </li>)}</ul>
      <PageButtons data={resource.data} move={(page) => update({ page: String(page) })} />
    </>}
  </>
}
