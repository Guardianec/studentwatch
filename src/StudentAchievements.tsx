import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { academicYear, api, ApiFailure, type Group, type Membership } from './api'
import { DocumentList, RecordBadges, ResultDetails } from './AchievementDetails'
import { GroupReviews, History } from './ReviewDetails'
import { currentYear } from './PortfolioResults'
import {
  academicDate, evidenceKinds, recordPath, recordTitle, resultKinds,
  type Achievement, type Attachment, type Catalogue, type Profile, type RecordInput, type UploadLimits,
} from './portfolio'
import { canLeave, ErrorNotice, useAction, useResource, useUnsaved } from './ui'

type Recipient = Pick<Group, 'id' | 'name' | 'year' | 'archived'>
type PendingFile = { id: string; file: File; replace?: Attachment }
const acceptedFiles = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

function newInput(profile: Profile): RecordInput {
  return {
    competition_id: null, cycle_id: null, stage_id: null, competition_proposal: '', season_proposal: academicYear(currentYear), stage_proposal: '',
    section: '', topic: '', starts_on: null, ends_on: null, academic_year: currentYear,
    school: profile.school, grade: profile.grade, participation: 'solo', declared_team: '', declared_members: '',
    result_kind: 'participated', award: '', placement: '', score: null, description: '', results_url: '', evidence: '',
    group_ids: [],
  }
}

function Validation({ error }: { error?: ApiFailure }) {
  return <>
    <ErrorNotice error={error} />
    {error && Object.keys(error.fields).length > 0 &&
      <ul className="validation-list" role="alert">{Object.values(error.fields).map((message, index) => <li key={index}>{message}</li>)}</ul>}
  </>
}

function MaterialsFields({ evidence, url, change }: {
  evidence: RecordInput['evidence']; url: string; change: (value: Pick<RecordInput, 'evidence' | 'results_url'>) => void
}) {
  return <>
    <label>Підтверджувальні матеріали <span className="hint">Необов’язково</span>
      <select value={evidence} onChange={(event) => change({ evidence: event.target.value as typeof evidence, results_url: url })}>
        {Object.entries(evidenceKinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
    <label>Посилання на офіційні результати
      <input type="url" value={url} maxLength={500} placeholder="https://…" aria-required={evidence === 'link'}
        onChange={(event) => change({ evidence, results_url: event.target.value })} />
    </label>
  </>
}

async function saveDocuments(record: Achievement, files: PendingFile[], changed: (value: Achievement) => void,
  finished: (id: string) => void) {
  let current = record
  for (const item of files) {
    const body = new FormData()
    body.append('file', item.file)
    body.append('id', item.id)
    body.append('revision', String(current.revision))
    if (item.replace) body.append('replace_id', item.replace.id)
    current = await api<Achievement>(recordPath(record.id) + 'attachments/', 'POST', body)
    changed(current)
    finished(item.id)
  }
  return current
}

function DocumentsEditor({ record, files, onFiles, limits, remove, busy }: {
  record?: Achievement; files: PendingFile[]; onFiles: (files: PendingFile[]) => void; limits: UploadLimits;
  remove: (item: Attachment) => void; busy: boolean
}) {
  const [error, setError] = useState('')
  const [replacing, setReplacing] = useState<Attachment>()
  const used = (record?.attachments.length ?? 0) + files.filter((item) => !item.replace).length
  function choose(selected: File[]) {
    setError('')
    if (selected.some((item) => !item.size || item.size > limits.max_bytes)) {
      setError('Перевірте розмір вибраних файлів.')
      return
    }
    if (!replacing && used + selected.length > limits.count) {
      setError('Досягнуто ліміту файлів на одне досягнення.')
      return
    }
    if (selected.length) onFiles([
      ...files.filter((item) => !replacing || item.replace?.id !== replacing.id),
      ...selected.map((file) => ({ id: crypto.randomUUID(), file, replace: replacing })),
    ])
    setReplacing(undefined)
  }
  return <div className="documents-editor">
    {record && <DocumentList record={record} controls={(item) => <>
      <button type="button" className="control" disabled={busy} onClick={() => {
        setReplacing(item)
        requestAnimationFrame(() => document.getElementById('achievement-file')?.focus())
      }}>Замінити<span className="sr-only"> {item.filename}</span></button>
      <button type="button" className="control" disabled={busy || files.some((file) => file.replace?.id === item.id)}
        onClick={() => remove(item)}>Вилучити<span className="sr-only"> {item.filename}</span></button>
    </>} />}
    {(used < limits.count || replacing) && <label>{replacing ? 'Файл на заміну · ' + replacing.filename : 'Додати файли'}
      <input id="achievement-file" type="file" accept={acceptedFiles} multiple={!replacing} disabled={busy}
        aria-describedby="attachment-hint" onChange={(event) => {
          choose(Array.from(event.target.files ?? []))
          event.target.value = ''
        }} />
    </label>}
    {replacing && <button type="button" className="control" onClick={() => setReplacing(undefined)}>Скасувати заміну</button>}
    <p className="hint" id="attachment-hint">PDF, JPEG, PNG · до {limits.max_bytes / 1024 ** 2} МБ на файл · до {limits.count} файлів.</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    {files.length > 0 && <ul className="member-list">{files.map((item) => <li key={item.id}>
      <span>{item.file.name} <span className="hint">{item.replace ? 'На заміну' : 'Очікує завантаження'}</span></span>
      <button type="button" className="control" disabled={busy}
        onClick={() => onFiles(files.filter((file) => file.id !== item.id))}>Прибрати зі списку</button>
    </li>)}</ul>}
  </div>
}

function EvidenceEditor({ record, limits, changed, close }: {
  record: Achievement; limits: UploadLimits; changed: (value: Achievement) => void; close: () => void
}) {
  const [materials, setMaterials] = useState({ evidence: record.evidence, results_url: record.results_url })
  const [files, setFiles] = useState<PendingFile[]>([])
  const action = useAction()
  const dirty = materials.evidence !== record.evidence || materials.results_url !== record.results_url
  useUnsaved(dirty || files.length > 0)
  return <form className="form portfolio-form" noValidate onSubmit={(event) => {
    event.preventDefault()
    void action.run(async () => {
      let current = record
      if (dirty) {
        current = await api<Achievement>(recordPath(record.id) + 'evidence/', 'PATCH', { ...materials, revision: record.revision })
        changed(current)
        setMaterials({ evidence: current.evidence, results_url: current.results_url })
      }
      await saveDocuments(current, files, changed, (id) => setFiles((items) => items.filter((item) => item.id !== id)))
      close()
    })
  }}>
    <fieldset disabled={action.busy}><legend>Підтверджувальні матеріали</legend>
      <MaterialsFields evidence={materials.evidence} url={materials.results_url} change={setMaterials} />
      <DocumentsEditor record={record} files={files} onFiles={setFiles} limits={limits} busy={action.busy} remove={(item) =>
        void action.run(async () => changed(await api<Achievement>(
          recordPath(record.id) + 'attachments/' + item.id + '/', 'DELETE', { revision: record.revision },
        )))} />
    </fieldset>
    <Validation error={action.error} />
    <div className="actions">
      <button type="submit" className="control primary" disabled={action.busy || (!dirty && !files.length)}>Зберегти матеріали</button>
      <button type="button" className="control" disabled={action.busy} onClick={() => { if (canLeave()) close() }}>Закрити</button>
    </div>
  </form>
}

function Editor({ initial, catalogue, profile, groups, close, saved: onSaved, initialNotice, openGroups }: {
  initial?: Achievement; catalogue: Catalogue; profile: Profile; groups: Recipient[]; close: () => void;
  saved: (id: string, message: string) => void; initialNotice?: string; openGroups: () => void
}) {
  const [id] = useState(() => initial?.id ?? crypto.randomUUID())
  const [record, setRecord] = useState(initial)
  function startingForm(current?: Achievement): RecordInput {
    const empty = newInput(profile)
    if (!current) return empty
    const values = { ...current, ...current.changes_draft }
    return {
      ...Object.fromEntries(Object.keys(empty).map((key) => [key, values[key as keyof RecordInput]])),
      group_ids: current.group_ids?.length ? current.group_ids : empty.group_ids,
    } as RecordInput
  }
  const [form, setForm] = useState<RecordInput>(() => startingForm(initial))
  const [baseline, setBaseline] = useState(JSON.stringify(form))
  const [revisionEditing, setRevisionEditing] = useState(false)
  const [reply, setReply] = useState(initial?.changes_draft?.reply ?? '')
  const [savedReply, setSavedReply] = useState(reply)
  const submitId = useRef(crypto.randomUUID())
  const [files, setFiles] = useState<PendingFile[]>([])
  const [showMaterials, setShowMaterials] = useState(false)
  const [competitionQuery, setCompetitionQuery] = useState('')
  const [saved, setSaved] = useState(initialNotice ?? '')
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const formElement = useRef<HTMLFormElement>(null)
  const action = useAction()
  const editable = !record || record.status === 'draft' || revisionEditing
  const dirty = JSON.stringify(form) !== baseline || reply !== savedReply
  useUnsaved(editable && (dirty || files.length > 0))
  useEffect(() => {
    const field = formElement.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (field) {
      const disclosure = field.closest('details')
      if (disclosure) disclosure.open = true
      field.focus()
    }
  }, [action.error])
  useEffect(() => {
    if (initial?.status === 'submitted' && !revisionEditing && !showMaterials) {
      setRecord((current) => current && initial.revision >= current.revision ? initial : current)
    }
  }, [initial, revisionEditing, showMaterials])

  const competition = catalogue.categories.flatMap((category) => category.competitions).find((item) => item.id === form.competition_id)
  const competitionOptions = catalogue.categories.map((category) => ({ ...category, competitions: category.competitions.filter((item) =>
    item.id === form.competition_id || item.name.toLocaleLowerCase('uk').includes(competitionQuery.trim().toLocaleLowerCase('uk'))) }))
  const cycle = competition?.cycles.find((item) => item.id === form.cycle_id)
  const stage = cycle?.stages.find((item) => item.id === form.stage_id)
  const selectedGroups = groups.filter((group) => form.group_ids?.includes(group.id))
  const review = { ...form, competition_name: competition?.name ?? form.competition_proposal,
    season: cycle?.season ?? form.season_proposal, stage_name: stage?.name ?? form.stage_proposal, team: null }
  const patch = (values: Partial<RecordInput>) => { setForm((previous) => ({ ...previous, ...values })); setSaved('') }
  const stored = setRecord
  const finishedFile = (finished: string) => setFiles((items) => items.filter((item) => item.id !== finished))
  async function persist(submitting: boolean) {
    let current = record
    if (!current || dirty || (revisionEditing && !current.changes_draft)) {
      const body = { ...form, reply, group_ids: selectedGroups.map(({ id }) => id) }
      current = current
        ? await api<Achievement>(recordPath(id), 'PATCH', { ...body, revision: current.revision })
        : await api<Achievement>('/api/achievements/', 'POST', { ...body, id })
      stored(current)
      setBaseline(JSON.stringify(form))
      setSavedReply(reply)
      setSaved('Чернетку збережено.')
    }
    current = await saveDocuments(current, files, stored, finishedFile)
    if (submitting) {
      stored(await api<Achievement>(recordPath(id) + 'submit/', 'POST', {
        revision: current.revision, group_ids: selectedGroups.map(({ id }) => id).sort((a, b) => a - b),
        allow_duplicate: allowDuplicate, request_id: submitId.current,
      }))
      submitId.current = crypto.randomUUID()
      setRevisionEditing(false)
    }
    const message = submitting ? 'Результат подано вибраним групам.' : 'Чернетку збережено.'
    setSaved(message)
    onSaved(id, message)
  }

  type TextField = { [Key in keyof RecordInput]-?: RecordInput[Key] extends string | null ? Key : never }[keyof RecordInput]
  const fields = action.error?.fields ?? {}
  function text(key: TextField, label: string, maximum: number, example?: string, multiline = false) {
    const props = {
      value: form[key] ?? '', maxLength: maximum, placeholder: example,
      'aria-invalid': Boolean(fields[key]), 'aria-describedby': fields[key] ? 'achievement-' + key + '-error' : undefined,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => patch({ [key]: event.target.value }),
    }
    return <label>{label}{multiline ? <textarea {...props} rows={3} /> : <input {...props} />}
      {fields[key] && <span className="field-error" id={'achievement-' + key + '-error'}>{fields[key]}</span>}
    </label>
  }

  return <>
    <button type="button" className="control portfolio-back" disabled={action.busy} onClick={() => { if (canLeave()) close() }}>
      <ArrowLeft size={16} aria-hidden="true" /> Назад
    </button>
    <header className="page-heading record-heading">
      <div><h1>{editable ? (record ? 'Редагування чернетки' : 'Додати досягнення') : recordTitle(record)}</h1>
        {record && <RecordBadges record={{ ...record, has_changes_draft: Boolean(record.changes_draft) }} />}</div>
    </header>
    {saved && !editable && <p className="invite-preview" role="status">{saved}</p>}
    {editable ? <>
      <form ref={formElement} className="form portfolio-form compact-editor" noValidate onSubmit={(event) => {
        event.preventDefault()
        if (selectedGroups.length) void action.run(() => persist(true))
      }}>
        <fieldset disabled={action.busy}><legend>Конкурс і дата</legend>
          {catalogue.categories.reduce((total, category) => total + category.competitions.length, 0) > 10 &&
            <label>Пошук конкурсу <input type="search" value={competitionQuery} onChange={(event) => setCompetitionQuery(event.target.value)} /></label>}
          <label>Конкурс
            <select aria-invalid={Boolean(fields.competition_id)} aria-describedby={fields.competition_id ? "competition-error" : undefined} value={form.competition_id ?? ''} onChange={(event) => {
              const selected = catalogue.categories.flatMap(({ competitions }) => competitions).find(({ id }) => id === Number(event.target.value))
              patch({ competition_id: selected?.id ?? null, cycle_id: null, stage_id: null,
                competition_proposal: '', stage_proposal: '', topic: '',
                participation: selected?.team_by_default ? 'team' : 'solo' })
            }}>
              <option value="">Немає у списку / ще не вибрано</option>
              {competitionOptions.filter((category) => category.competitions.length).map((category) => <optgroup label={category.name} key={category.id}>
                {category.competitions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </optgroup>)}
            </select>
            {fields.competition_id && <span className="field-error" id="competition-error">{fields.competition_id}</span>}
          </label>
          {competitionQuery && !competitionOptions.some((category) => category.competitions.length) &&
            <p className="hint">За цією назвою конкурсів немає. Ви можете запропонувати назву.</p>}
          {!competition && text('competition_proposal', 'Запропонована назва конкурсу', 160)}
          {Boolean(competition?.cycles.length) && <label>Річний цикл
            <select value={form.cycle_id ?? ''} onChange={(event) => patch({ cycle_id: Number(event.target.value) || null, stage_id: null })}>
              <option value="">Вказати сезон вручну</option>
              {competition?.cycles.map((item) => <option key={item.id} value={item.id}>{item.season}</option>)}
            </select>
          </label>}
          {!cycle && text('season_proposal', 'Сезон або рік конкурсу', 40, 'Наприклад, 2026 або 2026/27')}
          {fields.cycle_id && <p className="field-error">{fields.cycle_id}</p>}
          {Boolean(cycle?.stages.length) && <label>Етап
            <select value={form.stage_id ?? ''} onChange={(event) => patch({ stage_id: Number(event.target.value) || null })}>
              <option value="">Вказати вручну або залишити порожнім</option>
              {cycle?.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>}
          {!stage && text('stage_proposal', 'Назва етапу, якщо відома', 120)}
          {(competition?.asks_topic || form.topic) && text('topic', 'Тема дослідницької роботи', 200, 'Необов’язково')}
          <label>Дата події <span className="hint">Якщо відома</span>
            <input type="date" value={form.starts_on ?? ''} aria-invalid={Boolean(fields.starts_on)} onChange={(event) => {
              const date = event.target.value
              if (!date) { patch({ starts_on: null }); return }
              const [year, month] = date.split('-').map(Number)
              const academic = year - Number(month < 9)
              patch({ starts_on: date, academic_year: academic,
                ...(form.season_proposal === academicYear(form.academic_year ?? currentYear) ? { season_proposal: academicYear(academic) } : {}) })
            }} />
            {fields.starts_on && <span className="field-error">{fields.starts_on}</span>}
          </label>
          <details open={Boolean(fields.ends_on || fields.academic_year || fields.school || fields.grade || fields.section) || undefined}>
            <summary>Додаткові відомості про подію</summary>
            {text('section', 'Секція, номінація або дисципліна', 120)}
            <div className="field-grid">
              <label>Завершення події <input type="date" min={form.starts_on ?? undefined} value={form.ends_on ?? ''}
                aria-invalid={Boolean(fields.ends_on)} onChange={(event) => patch({ ends_on: event.target.value || null })} />
                {fields.ends_on && <span className="field-error">{fields.ends_on}</span>}
              </label>
              <label>Початок навчального року <input type="number" min={2000} max={2099} value={form.academic_year ?? ''}
                aria-invalid={Boolean(fields.academic_year)}
                onChange={(event) => patch({ academic_year: event.target.value ? Number(event.target.value) : null })} />
                <span className="hint">{fields.academic_year ?? (form.academic_year ? academicYear(form.academic_year) : '')}</span>
              </label>
              {text('school', 'Заклад освіти', 160)}{text('grade', 'Клас або рік навчання', 40)}
            </div>
          </details>
        </fieldset>
        <fieldset disabled={action.busy}><legend>Результат</legend>
          <label>Вид результату
            <select value={form.result_kind} onChange={(event) => patch({ result_kind: event.target.value as RecordInput['result_kind'] })}>
              {Object.entries(resultKinds).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </select>
          </label>
          {(form.award || ['award', 'other'].includes(form.result_kind)) && text('award', 'Нагорода за протоколом', 120, 'Наприклад, диплом II ступеня')}
          {(form.placement || form.result_kind !== 'participated') && text('placement', 'Місце за протоколом', 80, 'Якщо відоме')}
          {(form.participation === 'team' || form.declared_team) && text('declared_team', 'Назва команди', 120)}
          <details open={Boolean(fields.score || fields.description || fields.declared_members) || undefined}>
            <summary>Участь, бали й опис</summary>
            <label>Вид участі
              <select value={form.participation} onChange={(event) => patch({ participation: event.target.value as RecordInput['participation'] })}>
                <option value="solo">Індивідуальна</option><option value="team">Командна</option>
              </select>
            </label>
            {form.participation === 'team' && text('declared_members', 'Заявлений склад', 500, 'Вказуйте імена за згодою учасників.', true)}
            <label>Бали <input value={form.score ?? ''} maxLength={24} inputMode="decimal" aria-invalid={Boolean(fields.score)}
              onChange={(event) => patch({ score: event.target.value })} />
              {fields.score && <span className="field-error">{fields.score}</span>}
            </label>
            {text('description', 'Що ви зробили', 1200, 'Короткий опис, необов’язково', true)}
          </details>
        </fieldset>
        <fieldset disabled={action.busy}><legend>Подання</legend>
            {revisionEditing && <>
              <p className="hint">Вибрані групи отримають нову версію. Якщо прибрати групу, вона втратить доступ.</p>
              <label>Що виправлено <span className="hint">Необов’язково</span>
                <textarea value={reply} maxLength={600} rows={3} onChange={(event) => setReply(event.target.value)} />
              </label>
            </>}
            <h3>Кому показати результат</h3>
            {groups.length ? <div className="choice-list" role="group" aria-label="Одержувачі">
              {groups.map((group) => <label key={group.id}><input type="checkbox" checked={selectedGroups.includes(group)} onChange={(event) =>
                patch({ group_ids: event.target.checked ? [...selectedGroups.map((item) => item.id), group.id]
                  : selectedGroups.filter((item) => item.id !== group.id).map((item) => item.id) })} />
              {group.name} · {academicYear(group.year)}</label>)}
            </div> : <p className="hint">Збережіть чернетку й <button type="button" className="text-link inline-link" onClick={openGroups}>приєднайтеся до групи</button>.</p>}
            {fields.group_ids && <p className="field-error">{fields.group_ids}</p>}
            {!revisionEditing && <details open={Boolean(fields.results_url || files.length) || undefined}>
              <summary>Матеріали · необов’язково</summary>
              <p className="hint">Диплом або посилання можна додати і після подання.</p>
              <MaterialsFields evidence={form.evidence} url={form.results_url} change={patch} />
              {fields.results_url && <p className="field-error">{fields.results_url}</p>}
              <DocumentsEditor record={record} files={files} onFiles={setFiles} limits={catalogue.upload_limits} busy={action.busy} remove={(item) =>
                record && void action.run(async () => stored(await api<Achievement>(
                  recordPath(id) + 'attachments/' + item.id + '/', 'DELETE', { revision: record.revision },
                )))} />
            </details>}
        </fieldset>
        <details className="review-panel"><summary>Перегляд перед поданням</summary>
          <h3>{recordTitle(review)}</h3>
          <ResultDetails record={{ ...review, results_url: '', has_document: Boolean(record?.has_document || files.length) }} />
          <p className="hint">Одержувачі · {selectedGroups.map(({ name }) => name).join(', ') || 'Ще не вибрані'}</p>
        </details>
        {(record?.duplicate || action.error?.code === 'duplicate') && <label className="choice-list duplicate-notice">
          <span>У вас є схожий запис за цим конкурсом, сезоном, етапом і секцією.</span>
          <span><input type="checkbox" checked={allowDuplicate} onChange={(event) => setAllowDuplicate(event.target.checked)} />
            Це окремий результат</span>
        </label>}
        <Validation error={action.error} />
        {saved && <p className="invite-preview" role="status">{saved}</p>}
        <div className="actions editor-actions">
          <button type="button" className="control" disabled={action.busy} onClick={() => void action.run(() => persist(false))}>Зберегти чернетку</button>
          <button type="submit" className="control primary" disabled={action.busy || !selectedGroups.length}>
            {action.busy ? 'Зберігаємо…' : revisionEditing ? 'Повторно подати' : 'Подати досягнення'}
          </button>
        </div>
        {record && !revisionEditing && <button type="button" className="control danger-control" disabled={action.busy} onClick={() => {
          if (!window.confirm('Видалити чернетку разом із її вкладеннями?')) return
          void action.run(async () => {
            await api(recordPath(id), 'DELETE', { revision: record.revision })
            close()
          })
        }}>Видалити чернетку</button>}
        {record && revisionEditing && <div className="actions">
          <button type="button" className="control" disabled={action.busy} onClick={() => {
            if (canLeave()) { setRevisionEditing(false); setSaved(''); action.clearError() }
          }}>До поданої версії</button>
          {record.changes_draft && <button type="button" className="control danger-control" disabled={action.busy} onClick={() => {
            if (!window.confirm('Видалити приватну чернетку змін?')) return
            void action.run(async () => {
              stored(await api<Achievement>(recordPath(id) + 'changes/', 'DELETE', { revision: record.revision }))
              setRevisionEditing(false)
              setSaved('')
            })
          }}>Видалити чернетку змін</button>}
        </div>}
      </form>
    </> : <>
      <div className="result-lead"><strong>{record.result_label}</strong><span>{[record.stage_name, record.starts_on && academicDate(record.starts_on)].filter(Boolean).join(' · ')}</span></div>
      <section className="portfolio-section">
        {record.reviews?.length ? <GroupReviews reviews={record.reviews} detail /> : <p>Чинних одержувачів немає.</p>}
      </section>
      {showMaterials ? <EvidenceEditor record={record} limits={catalogue.upload_limits} changed={stored} close={() => setShowMaterials(false)} />
        : <section className="portfolio-section"><h3>Документи</h3><DocumentList record={record} /></section>}
      <Validation error={action.error} />
      {record.status === 'submitted' && <div className="actions">
        {!showMaterials && <button className="control" disabled={action.busy} onClick={() => void action.run(async () =>
          stored(await api<Achievement>(recordPath(id))))}><RefreshCw size={15} aria-hidden="true" /> Оновити рішення</button>}
        {!showMaterials && <button className="control primary" onClick={() => setShowMaterials(true)}>Додати підтвердження</button>}
        {!showMaterials && <button className="control" disabled={action.busy} onClick={() => void action.run(async () => {
          const current = await api<Achievement>(recordPath(id))
          stored(current)
          const next = startingForm(current)
          const savedText = current.changes_draft?.reply ?? ''
          setReply(savedText)
          setSavedReply(savedText)
          setForm(next)
          setBaseline(JSON.stringify(next))
          setSaved('')
          setRevisionEditing(true)
        })}>{record.changes_draft ? 'Продовжити чернетку змін' : record.reviews?.some(({ status }) =>
          status === 'clarify' || status === 'rejected') ? 'Виправити' : 'Підготувати зміни'}</button>}
        {!showMaterials && record.can_withdraw &&
          <button className="control" disabled={action.busy} onClick={() => void action.run(async () => {
          const value = await api<Achievement>(recordPath(id) + 'withdraw/', 'POST', { revision: record.revision })
          stored(value)
          const next = startingForm(value)
          setForm(next)
          setBaseline(JSON.stringify(next))
          setAllowDuplicate(false)
          setSaved('Запис повернуто до чернеток.')
        })}>Відкликати в чернетку</button>}
      </div>}
      <details className="portfolio-section"><summary>Відомості про результат</summary><ResultDetails record={record} /></details>
      <History record={record} />
    </>}
    {editable && !revisionEditing && record && <History record={record} />}
  </>
}

function SavedEditor({ id, ...props }: Omit<Parameters<typeof Editor>[0], 'initial'> & { id: string }) {
  const resource = useResource<Achievement>(recordPath(id))
  return <>
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    {resource.loading && !resource.data && <p role="status">Завантажуємо досягнення…</p>}
    {resource.data ? <Editor initial={resource.data} {...props} /> :
      <button className="control" onClick={props.close}>Назад</button>}
  </>
}

export default function StudentAchievements({ openGroups, id, close, saved, initialNotice }: {
  openGroups: () => void; id: string; close: () => void; saved: (id: string, message: string) => void; initialNotice?: string
}) {
  const catalogue = useResource<Catalogue>('/api/catalogue/')
  const profile = useResource<Profile>('/api/profile/')
  const memberships = useResource<{ memberships: Membership[] }>('/api/memberships/')
  const groups = (memberships.data?.memberships ?? []).filter((item) => item.status === 'approved' && !item.group.archived).map((item) => item.group)
  if (catalogue.data && profile.data && memberships.data) {
    const props = { catalogue: catalogue.data, profile: profile.data, groups, close, saved, initialNotice, openGroups }
    return id === 'new' ? <Editor {...props} /> : <SavedEditor id={id} {...props} />
  }
  return <>
    {[catalogue, profile, memberships].map((resource, index) =>
      <ErrorNotice key={index} error={resource.error} retry={resource.refresh} />)}
    {(catalogue.loading || profile.loading || memberships.loading) && <p role="status">Завантажуємо форму…</p>}
  </>
}
