import { useState } from 'react'
import { api } from './api'
import { apiQuery, bases, evidenceKinds, eventDate, recordPath, resultKinds, statuses, type Achievement, type GroupReview, type PageInfo, type ReviewEvent } from './portfolio'
import { PageButtons } from './PortfolioResults'
import { ErrorNotice, useAction, useResource, useUnsaved } from './ui'

export const eventLabels: Record<string, string> = {
  created: 'Створено чернетку', draft_edited: 'Змінено чернетку', submitted: 'Подано на перевірку', resubmitted: 'Подано нову версію',
  withdrawn: 'Відкликано в чернетку', access_granted: 'Надано доступ', access_revoked: 'Припинено доступ',
  verified: 'Підтверджено', clarify: 'Потрібне уточнення', rejected: 'Відхилено', confirmation_revoked: 'Відкликано підтвердження',
  basis_removed: 'Підстава змінилася, потрібна повторна перевірка', materials_seen: 'Матеріали переглянуто',
  evidence_changed: 'Оновлено підтверджувальні матеріали', attachment_added: 'Додано документ',
  attachment_removed: 'Вилучено документ', attachment_replaced: 'Замінено документ',
  team_linked: 'Підтверджено зв’язок із командою', team_result_changed: 'Оновлено спільний результат команди',
  team_review_reset: 'Командний результат повернуто на перевірку',
}

const fields: Record<string, string> = {
  competition_name: 'Конкурс', season: 'Цикл', stage_name: 'Етап', section: 'Секція', topic: 'Тема роботи',
  starts_on: 'Початок події', ends_on: 'Завершення події', academic_year: 'Навчальний рік',
  school: 'Заклад освіти', grade: 'Клас', participation: 'Участь', result_kind: 'Вид результату', score: 'Бали',
  award: 'Нагорода', placement: 'Місце', declared_team: 'Назва команди', declared_members: 'Заявлений склад',
  description: 'Опис', team_kind: 'Вид командного результату', team_award: 'Командна нагорода',
  team_placement: 'Місце команди', team_score: 'Командні бали', evidence: 'Документ',
}

function formatValue(field: string, value: string | number | null) {
  if (value === null || value === '') return 'Не зазначено'
  if (field === 'result_kind' || field === 'team_kind') return resultKinds[value as keyof typeof resultKinds] ?? value
  if (field === 'participation') return value === 'team' ? 'Командна' : 'Індивідуальна'
  if (field === 'evidence') return evidenceKinds[value as keyof typeof evidenceKinds] ?? value
  return value
}

export function EventDetails({ item }: { item: ReviewEvent }) {
  const { details } = item
  return <>
    {details.basis && <p>{details.basis === 'protocol' && item.action === 'verified' ? 'Підтверджено за протоколом' : bases[details.basis]}</p>}
    {details.filenames?.length ? <p className="hint">{details.filenames.join(', ')}</p> : null}
    {details.url && <p className="hint preserve-lines">{details.url}</p>}
    {details.removed_documents ? <p className="hint">Недоступних документів {details.removed_documents}</p> : null}
    {details.filename && <p className="hint">{details.filename}{details.replacement && ' → ' + details.replacement}
      {!details.replacement && item.attachment_available === false && ' · файл більше недоступний'}</p>}
    {details.team_member_confirmed && <p className="hint">Участь учня в команді перевірено.</p>}
    {details.comment && <p className="preserve-lines">{details.comment}</p>}
    {details.reply && <p className="preserve-lines">Відповідь учня · {details.reply}</p>}
    {details.link_changed && <p className="hint">Оновлено посилання на результати.</p>}
    {details.changes && Object.keys(details.changes).length > 0 && <dl className="change-list">
      {Object.entries(details.changes).map(([field, [before, after]]) => <div key={field}>
        <dt>{fields[field] ?? field}</dt><dd>{formatValue(field, before)} <span aria-label="змінено на">→</span> {formatValue(field, after)}</dd>
      </div>)}
    </dl>}
  </>
}

export function History({ record, teacher, groupId }: { record: Achievement; teacher?: boolean; groupId?: number }) {
  const [page, setPage] = useState(1)
  const params = { group: groupId ? String(groupId) : '' }
  const resource = useResource<{ events: ReviewEvent[]; latest: ReviewEvent | null; previous: ReviewEvent | null } & PageInfo>(apiQuery(recordPath(record.id) + 'history/', {
    ...params, page: String(page),
  }),
    [record.revision, record.version, record.materials_revision, ...(record.reviews ?? []).map(({ revision }) => revision)].join('/'),
    Boolean(teacher))
  const items = resource.data?.events ?? []
  const latest = resource.data?.latest
  const previous = resource.data?.previous
  return <section className="portfolio-section review-history">
    {teacher && latest && <div className="latest-changes"><h3>Останні зміни</h3>
      {previous && <p className="preserve-lines"><strong>Попереднє зауваження</strong><br />{previous.details.comment}</p>}
      <EventDetails item={latest} />
    </div>}
    <details><summary>Історія змін і рішень</summary>
      <ErrorNotice error={resource.error} retry={resource.refresh} />
      {resource.loading && !resource.data && <p role="status">Завантажуємо історію…</p>}
      {resource.data && !items.length && <p className="hint">Подій поки немає.</p>}
      <ol className="history-list">{items.map((item) => <li key={item.id}>
        <strong>{eventLabels[item.action] ?? item.action}</strong>
        <p className="hint">{[eventDate(item.at), item.actor, item.group, item.version ? 'Версія ' + item.version : 'Чернетка'].filter(Boolean).join(' · ')}</p>
        <EventDetails item={item} />
      </li>)}</ol>
      {resource.data && <PageButtons data={resource.data} move={setPage} />}
    </details>
  </section>
}

export function GroupReviews({ reviews = [], detail = false }: { reviews?: GroupReview[]; detail?: boolean }) {
  if (!reviews.length) return null
  return <div className="group-reviews">
    {detail && <h3>Перевірка за групами</h3>}
    <ul>{reviews.map((review) => <li key={review.group_id}>
      <strong>{review.group}</strong> · <span>{statuses[review.status]}</span>
      {review.new_materials && <span className="hint"> · Нові матеріали</span>}
      {detail && review.decision && <>
        <p className="hint">{eventDate(review.decision.at)} · {review.decision.actor}</p>
        <EventDetails item={review.decision} />
      </>}
    </li>)}</ul>
  </div>
}

type Decision = 'verified' | 'clarify' | 'rejected' | 'confirmation_revoked'
const actions = {
  verified: 'Підтвердити', clarify: 'Попросити уточнення', rejected: 'Відхилити',
  confirmation_revoked: 'Відкликати підтвердження',
}

export function DecisionForm({ record, review, done, refresh }: {
  record: Achievement; review: GroupReview; done: (record: Achievement, message: string) => void; refresh: () => void
}) {
  const [mode, setMode] = useState<Decision>()
  const [comment, setComment] = useState('')
  const [basis, setBasis] = useState<keyof typeof bases>('protocol')
  const [documentIds, setDocuments] = useState<string[]>([])
  const [useLink, setUseLink] = useState(false)
  const [teamChecked, setTeamChecked] = useState(false)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const reviewed = { version: record.version, share_revision: review.revision, materials_revision: record.materials_revision }
  const [target, setTarget] = useState(reviewed)
  const stale = Boolean(mode && (target.version !== reviewed.version || target.share_revision !== reviewed.share_revision
    || target.materials_revision !== reviewed.materials_revision))
  const action = useAction()
  useUnsaved(Boolean(mode && comment))
  const canRevoke = review.can_revoke
  const canDecide = review.status === 'submitted'
  const modes: Decision[] = canDecide ? ['verified', 'clarify', 'rejected'] : canRevoke ? ['confirmation_revoked'] : []

  async function send(operation: Decision | 'materials_seen') {
    const updated = await api<Achievement>(recordPath(record.id) + 'review/' + review.group_id + '/', 'POST', {
      action: operation, comment, basis, attachment_ids: documentIds, use_link: useLink,
      team_member_confirmed: teamChecked, ...(mode ? target : reviewed), request_id: requestId,
    })
    setMode(undefined)
    setComment('')
    setDocuments([])
    setTeamChecked(false)
    setRequestId(crypto.randomUUID())
    done(updated, operation === 'materials_seen' ? 'Матеріали позначено переглянутими.' : 'Рішення збережено.')
  }
  return <section className="portfolio-section">
    <h3>Рішення для групи «{review.group}»</h3>
    {!mode && <div className="actions">
      {modes.map((key) => <button key={key} type="button" className={'control ' + (key === 'verified' ? 'primary' : '')}
        disabled={action.busy} onClick={() => {
          setMode(key); setTarget(reviewed); setRequestId(crypto.randomUUID()); action.clearError()
        }}>{actions[key]}</button>)}
      {review.new_materials && <button type="button" className="control" disabled={action.busy}
        onClick={() => void action.run(() => send('materials_seen'))}>Позначити матеріали переглянутими</button>}
    </div>}
    {mode && <form className="form portfolio-form" onSubmit={(event) => { event.preventDefault(); void action.run(() => send(mode)) }}>
      <fieldset disabled={action.busy}><legend>{actions[mode]}</legend>
        {mode === 'verified' && <>
          <label>Підстава підтвердження <select value={basis} onChange={(event) => setBasis(event.target.value as keyof typeof bases)}>
            {Object.entries(bases).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
          </select></label>
          {basis === 'document' && <div className="choice-list">
            {record.attachments.map((item) => <label key={item.id}><input type="checkbox" checked={documentIds.includes(item.id)}
              onChange={(event) => setDocuments(event.target.checked ? [...documentIds, item.id] : documentIds.filter((id) => id !== item.id))} />{item.filename}</label>)}
            {!record.attachments.length && <p className="hint">У записі ще немає документа. Виберіть іншу підставу.</p>}
          </div>}
          {basis === 'protocol' && record.has_link && <div className="choice-list"><label>
            <input type="checkbox" checked={useLink} onChange={(event) => setUseLink(event.target.checked)} />Використати посилання з подання
          </label></div>}
          {record.participation === 'team' && <div className="choice-list"><label>
            <input type="checkbox" checked={teamChecked} onChange={(event) => setTeamChecked(event.target.checked)} />Перевірено участь цього учня в команді
          </label></div>}
        </>}
        <label>{mode === 'verified' ? 'Пояснення підстави' : 'Коментар для учня'}
          <textarea autoFocus value={comment} maxLength={800} rows={3} onChange={(event) => setComment(event.target.value)} />
        </label>
      </fieldset>
      <div className="actions">
        {stale && modes.includes(mode) && <button className="control" type="button" onClick={() => {
          setTarget(reviewed); setDocuments([]); setTeamChecked(false); setRequestId(crypto.randomUUID()); action.clearError()
        }}>Переглянув актуальні дані</button>}
        <button className="control primary" disabled={action.busy || stale} type="submit">Зберегти рішення</button>
        <button className="control" disabled={action.busy} type="button" onClick={() => { setMode(undefined); action.clearError() }}>Скасувати</button>
      </div>
    </form>}
    {stale && <p className="hint" role="status">Дані змінилися. Перегляньте поточну версію перед рішенням.</p>}
    <ErrorNotice error={action.error} retry={action.error?.code === 'conflict' ? refresh : undefined} />
    {action.error && Object.values(action.error.fields).map((message) => <p className="field-error" key={message}>{message}</p>)}
  </section>
}
