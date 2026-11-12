import { Download } from 'lucide-react'
import { academicYear, ApiFailure, downloadDocument } from './api'
import { SafeLink } from './Profile'
import { evidenceKinds, recordPath, resultKinds, statuses, waitingForDocument, type Achievement, type Attachment, type RecordInput, type RecordSummary } from './portfolio'
import { ErrorNotice, useAction } from './ui'
import type { ReactNode } from 'react'

export function RecordBadges({ record, teacher = false }: { record: RecordSummary; teacher?: boolean }) {
  const tone = { draft: 'draft', submitted: 'pending', verified: 'confirmed', clarify: 'clarify', rejected: 'clarify' }[record.status]
  return <span className="record-badges">
    <span className={'record-status ' + tone}>{teacher && record.status === 'submitted' ? 'Не перевірено' : statuses[record.status]}</span>
    {(record.has_document || record.has_link) && <span className="record-status draft">Є підтвердження</span>}
    {waitingForDocument(record) && <span className="record-status pending">Документ очікується</span>}
  </span>
}

export function ResultDetails({ record }: {
  record: RecordInput & Pick<Achievement, 'season' | 'stage_name' | 'team'> & Partial<Pick<Achievement, 'has_document'>>
}) {
  const date = (value: string) => value.split('-').reverse().join('.')
  const facts = [
    ['Сезон', record.season], ['Етап', record.stage_name], ['Секція або номінація', record.section],
    ['Тема роботи', record.topic], ['Подія', record.starts_on && (record.ends_on
      ? date(record.starts_on) + ' – ' + date(record.ends_on) : date(record.starts_on))],
    ['Навчальний рік', record.academic_year && academicYear(record.academic_year)],
    ['Заклад освіти на час результату', record.school], ['Клас або рік навчання на час результату', record.grade],
    ['Участь', record.participation === 'solo' ? 'Індивідуальна' : 'Командна'],
    ['Результат', resultKinds[record.result_kind]], ['Нагорода', record.award],
    ['Місце', record.placement], ['Бали', record.score?.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')],
  ] as const
  return <>
    <dl className="portfolio-facts">{facts.filter(([, value]) => Boolean(value)).map(([label, value]) =>
      <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {record.description && <div className="portfolio-section"><h3>Опис</h3><p className="preserve-lines">{record.description}</p></div>}
    {record.participation === 'team' && <div className="portfolio-section">
      <h3>{record.team?.name || record.declared_team || 'Команда'}</h3>
      <p className="hint">{record.team ? 'Зв’язок зі спільним командним результатом підтверджено.' : 'Назву команди вказав учень.'}</p>
      {record.declared_members && <p className="preserve-lines">Заявлений склад · {record.declared_members}</p>}
    </div>}
    {record.evidence && (record.evidence !== 'later' || !record.has_document) && <p className="hint">{evidenceKinds[record.evidence]}</p>}
    {record.results_url && <div className="portfolio-section"><h3>Посилання на результати</h3><SafeLink url={record.results_url} /></div>}
  </>
}

export function DocumentList({ record, onMissing, controls }: {
  record: Pick<Achievement, 'id' | 'attachments'>; onMissing?: () => void; controls?: (item: Attachment) => ReactNode
}) {
  const action = useAction()
  return <>
    {!record.attachments.length && <p className="hint">Файлів поки немає.</p>}
    <ul className="member-list document-list">{record.attachments.map((item) => <li key={item.id}>
      <span className="row-name"><strong>{item.filename}</strong><span>{Math.ceil(item.size / 1024)} КБ</span></span>
      <div className="actions">
        <button type="button" className="control" disabled={action.busy} onClick={() => void action.run(async () => {
          try {
            await downloadDocument(recordPath(record.id) + 'attachments/' + item.id + '/download/', item.filename)
          } catch (reason) {
            if (reason instanceof ApiFailure && reason.code === 'missing') onMissing?.()
            throw reason
          }
        })}><Download size={15} aria-hidden="true" /> Завантажити<span className="sr-only"> {item.filename}</span></button>
        {controls?.(item)}
      </div>
    </li>)}</ul>
    <ErrorNotice error={action.error} />
  </>
}
