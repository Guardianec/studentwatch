import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, Plus } from 'lucide-react'
import { academicYear, api, ApiFailure, type Group, type Membership } from './api'
import { DocumentList, RecordBadges, ResultDetails } from './AchievementDetails'
import {
  evidenceKinds, recordPath, recordTitle, resultKinds, waitingForDocument,
  type Achievement, type Attachment, type Catalogue, type Profile, type RecordInput, type RecordSummary, type UploadLimits,
} from './portfolio'
import { canLeave, ErrorNotice, useAction, useResource, useUnsaved } from './ui'

type Recipient = Pick<Group, 'id' | 'name' | 'year' | 'archived'>
type PendingFile = { id: string; file: File; replace?: Attachment }
const steps = ['Конкурс', 'Результат', 'Підтвердження й доступ']
const acceptedFiles = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

function newInput(profile: Profile, groups: Recipient[]): RecordInput {
  const now = new Date()
  return {
    competition_id: null, cycle_id: null, stage_id: null, competition_proposal: '', season_proposal: '', stage_proposal: '',
    section: '', topic: '', starts_on: null, ends_on: null, academic_year: now.getFullYear() - Number(now.getMonth() < 8),
    school: profile.school, grade: profile.grade, participation: 'solo', declared_team: '', declared_members: '',
    result_kind: 'participated', award: '', placement: '', score: null, description: '', results_url: '', evidence: '',
    group_ids: groups.length === 1 ? [groups[0].id] : [],
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

function Editor({ initial, catalogue, profile, groups, close, changed, openGroups }: {
  initial?: Achievement; catalogue: Catalogue; profile: Profile; groups: Recipient[]; close: () => void;
  changed: () => void; openGroups: () => void
}) {
  const [id] = useState(() => initial?.id ?? crypto.randomUUID())
  const [record, setRecord] = useState(initial)
  const [form, setForm] = useState<RecordInput>(() => {
    const empty = newInput(profile, groups)
    if (!initial) return empty
    return {
      ...Object.fromEntries(Object.keys(empty).map((key) => [key, initial[key as keyof RecordInput]])),
      group_ids: initial.group_ids?.length ? initial.group_ids : empty.group_ids,
    } as RecordInput
  })
  const [baseline, setBaseline] = useState(JSON.stringify(form))
  const [step, setStep] = useState(0)
  const [files, setFiles] = useState<PendingFile[]>([])
  const [showMaterials, setShowMaterials] = useState(false)
  const [saved, setSaved] = useState('')
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const action = useAction()
  const editable = !record || record.status === 'draft'
  const dirty = JSON.stringify(form) !== baseline
  useUnsaved(editable && (dirty || files.length > 0))
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [step])

  const competition = catalogue.categories.flatMap((category) => category.competitions).find((item) => item.id === form.competition_id)
  const cycle = competition?.cycles.find((item) => item.id === form.cycle_id)
  const stage = cycle?.stages.find((item) => item.id === form.stage_id)
  const selectedGroups = groups.filter((group) => form.group_ids?.includes(group.id))
  const review = { ...form, competition_name: competition?.name ?? form.competition_proposal,
    season: cycle?.season ?? form.season_proposal, stage_name: stage?.name ?? form.stage_proposal, team: null }
  const patch = (values: Partial<RecordInput>) => { setForm((previous) => ({ ...previous, ...values })); setSaved('') }
  const stored = (value: Achievement) => { setRecord(value); changed() }
  const finishedFile = (finished: string) => setFiles((items) => items.filter((item) => item.id !== finished))
  function goToStep(index: number) {
    setStep(index)
    window.scrollTo(0, 0)
  }

  async function persist(submitting: boolean) {
    let current = record
    if (!current || dirty) {
      const body = { ...form, group_ids: selectedGroups.map(({ id }) => id) }
      current = current
        ? await api<Achievement>(recordPath(id), 'PATCH', { ...body, revision: current.revision })
        : await api<Achievement>('/api/achievements/', 'POST', { ...body, id })
      stored(current)
      setBaseline(JSON.stringify(form))
      setSaved('Чернетку збережено.')
    }
    current = await saveDocuments(current, files, stored, finishedFile)
    if (submitting) {
      stored(await api<Achievement>(recordPath(id) + 'submit/', 'POST', {
        revision: current.revision, group_ids: selectedGroups.map(({ id }) => id).sort((a, b) => a - b),
        allow_duplicate: allowDuplicate,
      }))
      setSaved('Результат подано вибраним групам.')
    } else setSaved('Чернетку збережено.')
  }

  type TextField = { [Key in keyof RecordInput]-?: RecordInput[Key] extends string | null ? Key : never }[keyof RecordInput]
  function text(key: TextField, label: string, maximum: number, example?: string, multiline = false) {
    const props = {
      value: form[key] ?? '', maxLength: maximum, placeholder: example,
      'aria-invalid': Boolean(action.error?.fields[key]),
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => patch({ [key]: event.target.value }),
    }
    return <label>{label}{multiline ? <textarea {...props} rows={3} /> : <input {...props} />}</label>
  }

  return <>
    <button type="button" className="control portfolio-back" disabled={action.busy} onClick={() => { if (canLeave()) close() }}>
      <ArrowLeft size={16} aria-hidden="true" /> До списку
    </button>
    <header className="page-heading record-heading">
      <div><h1>{editable ? (record ? 'Редагування чернетки' : 'Нове досягнення') : recordTitle(record)}</h1>
        {record && <RecordBadges record={record} />}</div>
    </header>
    {saved && !editable && <p className="invite-preview" role="status">{saved}</p>}
    {editable ? <>
      <ol className="achievement-steps" aria-label="Кроки внесення результату">
        {steps.map((name, index) => <li key={name}><button className="control" type="button" aria-current={step === index ? 'step' : undefined}
          disabled={action.busy} onClick={() => goToStep(index)}>{name}</button></li>)}
      </ol>
      <form className="form portfolio-form" noValidate onSubmit={(event) => event.preventDefault()}>
        <h2 className="sr-only" tabIndex={-1} ref={heading}>{steps[step]}</h2>
        {step === 0 && <fieldset disabled={action.busy}><legend>Відомості про конкурс</legend>
          <label>Конкурс
            <select value={form.competition_id ?? ''} onChange={(event) => {
              const selected = catalogue.categories.flatMap(({ competitions }) => competitions).find(({ id }) => id === Number(event.target.value))
              patch({ competition_id: selected?.id ?? null, cycle_id: null, stage_id: null,
                competition_proposal: '', stage_proposal: '', topic: '',
                participation: selected?.team_by_default ? 'team' : form.participation })
            }}>
              <option value="">Немає у списку / ще не вибрано</option>
              {catalogue.categories.map((category) => <optgroup label={category.name} key={category.id}>
                {category.competitions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </optgroup>)}
            </select>
          </label>
          {!competition && text('competition_proposal', 'Запропонована назва конкурсу', 160)}
          {Boolean(competition?.cycles.length) && <label>Річний цикл
            <select value={form.cycle_id ?? ''} onChange={(event) => patch({ cycle_id: Number(event.target.value) || null, stage_id: null })}>
              <option value="">Вказати сезон вручну</option>
              {competition?.cycles.map((item) => <option key={item.id} value={item.id}>{item.season}</option>)}
            </select>
          </label>}
          {!cycle && text('season_proposal', 'Сезон або рік конкурсу', 40, 'Наприклад, 2026 або 2026/27')}
          {Boolean(cycle?.stages.length) && <label>Етап
            <select value={form.stage_id ?? ''} onChange={(event) => patch({ stage_id: Number(event.target.value) || null })}>
              <option value="">Вказати вручну або залишити порожнім</option>
              {cycle?.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>}
          {!stage && text('stage_proposal', 'Назва етапу, якщо відома', 120)}
          {text('section', 'Секція, номінація або дисципліна', 120, 'Необов’язково')}
          {(competition?.asks_topic || form.topic) && text('topic', 'Тема дослідницької роботи', 200, 'Необов’язково')}
          <div className="field-grid">
            <label>Дата події
              <input type="date" value={form.starts_on ?? ''} onChange={(event) => patch({ starts_on: event.target.value || null })} />
            </label>
            <label>Завершення, якщо це період
              <input type="date" min={form.starts_on ?? undefined} value={form.ends_on ?? ''}
                onChange={(event) => patch({ ends_on: event.target.value || null })} />
            </label>
          </div>
          <label>Початок навчального року
            <input type="number" min={2000} max={2099} value={form.academic_year ?? ''}
              onChange={(event) => patch({ academic_year: event.target.value ? Number(event.target.value) : null })} />
            <span className="hint">{form.academic_year ? academicYear(form.academic_year) : 'Наприклад, 2026 для 2026/27.'}</span>
          </label>
          <details><summary>Заклад і клас на час результату</summary><div className="field-grid">
            {text('school', 'Заклад освіти', 160)}{text('grade', 'Клас або рік навчання', 40)}
          </div></details>
        </fieldset>}
        {step === 1 && <fieldset disabled={action.busy}><legend>Участь і результат</legend>
          <label>Вид участі
            <select value={form.participation} onChange={(event) => patch({ participation: event.target.value as RecordInput['participation'] })}>
              <option value="solo">Індивідуальна</option><option value="team">Командна</option>
            </select>
          </label>
          {form.participation === 'team' && <>
            {text('declared_team', 'Назва команди', 120)}
            {text('declared_members', 'Заявлений склад', 500, 'Необов’язково. Вказуйте імена за згодою учасників.', true)}
            <p className="hint">Уповноважений адміністратор може зв’язати подані записи учасників у спільний результат.</p>
          </>}
          <label>Вид результату
            <select value={form.result_kind} onChange={(event) => patch({ result_kind: event.target.value as RecordInput['result_kind'] })}>
              {Object.entries(resultKinds).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </select>
          </label>
          {(form.award || ['award', 'other'].includes(form.result_kind)) && text('award', 'Нагорода за протоколом', 120, 'Наприклад, диплом II ступеня')}
          {(form.placement || form.result_kind !== 'participated') && text('placement', 'Місце за протоколом', 80, 'Якщо відоме')}
          <label>Бали <span className="hint">Якщо відомі</span>
            <input value={form.score ?? ''} maxLength={24} inputMode="decimal" onChange={(event) => patch({ score: event.target.value })} />
          </label>
          {text('description', 'Що ви зробили', 1200, 'Короткий опис, необов’язково', true)}
        </fieldset>}
        {step === 2 && <>
          <fieldset disabled={action.busy}><legend>Матеріали й одержувачі</legend>
            <p className="hint">Диплом можна додати після подання. Учителі вибраних груп побачать результат і прикріплені матеріали.</p>
            <MaterialsFields evidence={form.evidence} url={form.results_url} change={patch} />
            <DocumentsEditor record={record} files={files} onFiles={setFiles} limits={catalogue.upload_limits} busy={action.busy} remove={(item) =>
              record && void action.run(async () => stored(await api<Achievement>(
                recordPath(id) + 'attachments/' + item.id + '/', 'DELETE', { revision: record.revision },
              )))} />
            <h3>Кому показати результат</h3>
            {groups.length ? <div className="choice-list" role="group" aria-label="Одержувачі">
              {groups.map((group) => <label key={group.id}><input type="checkbox" checked={selectedGroups.includes(group)} onChange={(event) =>
                patch({ group_ids: event.target.checked ? [...selectedGroups.map((item) => item.id), group.id]
                  : selectedGroups.filter((item) => item.id !== group.id).map((item) => item.id) })} />
              {group.name} · {academicYear(group.year)}</label>)}
            </div> : <p className="hint">Збережіть чернетку й <button type="button" className="text-link inline-link" onClick={openGroups}>приєднайтеся до групи</button>.</p>}
          </fieldset>
          <section className="portfolio-section review-panel"><h2>Перегляд перед поданням</h2>
            <h3>{recordTitle(review)}</h3>
            <ResultDetails record={{ ...review, results_url: '', has_document: Boolean(record?.has_document || files.length) }} />
            {form.results_url && <p className="hint">Посилання на результати · {form.results_url}</p>}
            <p className="hint">Одержувачі · {selectedGroups.map(({ name }) => name).join(', ') || 'Ще не вибрані'}</p>
          </section>
          {(record?.duplicate || action.error?.code === 'duplicate') && <label className="choice-list duplicate-notice">
            <span>У вас є схожий запис за цим конкурсом, сезоном, етапом і секцією.</span>
            <span><input type="checkbox" checked={allowDuplicate} onChange={(event) => setAllowDuplicate(event.target.checked)} />
              Це окремий результат</span>
          </label>}
        </>}
        <Validation error={action.error} />
        {saved && <p className="invite-preview" role="status">{saved}</p>}
        <div className="actions wizard-actions">
          {step > 0 && <button type="button" className="control" disabled={action.busy} onClick={() => goToStep(step - 1)}>Назад</button>}
          <button type="button" className="control" disabled={action.busy} onClick={() => void action.run(() => persist(false))}>Зберегти чернетку</button>
          {step < 2 ? <button type="button" className="control primary" disabled={action.busy} onClick={() => goToStep(step + 1)}>Далі</button>
            : <button type="button" className="control primary" disabled={action.busy || !selectedGroups.length}
              onClick={() => void action.run(() => persist(true))}>Подати на перевірку</button>}
        </div>
        {record && <button type="button" className="control danger-control" disabled={action.busy} onClick={() => {
          if (!window.confirm('Видалити чернетку разом із її вкладеннями?')) return
          void action.run(async () => {
            await api(recordPath(id), 'DELETE', { revision: record.revision })
            changed()
            close()
          })
        }}>Видалити чернетку</button>}
      </form>
    </> : <>
      <ResultDetails record={record} />
      <section className="portfolio-section"><h3>Одержувачі</h3>
        <p>{groups.filter((group) => record.group_ids?.includes(group.id)).map((group) => group.name).join(', ') || 'Чинних одержувачів немає.'}</p>
      </section>
      {showMaterials ? <EvidenceEditor record={record} limits={catalogue.upload_limits} changed={stored} close={() => setShowMaterials(false)} />
        : <section className="portfolio-section"><h3>Документи</h3><DocumentList record={record} /></section>}
      <Validation error={action.error} />
      {record.status === 'submitted' && <div className="actions">
        {!showMaterials && <button className="control primary" onClick={() => setShowMaterials(true)}>Додати підтвердження</button>}
        {!showMaterials && <button className="control" disabled={action.busy} onClick={() => void action.run(async () => {
          const value = await api<Achievement>(recordPath(id) + 'withdraw/', 'POST', { revision: record.revision })
          stored(value)
          const next = { ...form, evidence: value.evidence, results_url: value.results_url,
            group_ids: groups.length === 1 ? [groups[0].id] : [] }
          setForm(next)
          setBaseline(JSON.stringify(next))
          setAllowDuplicate(false)
          setSaved('Запис повернуто до чернеток.')
          goToStep(0)
        })}>Відкликати в чернетку</button>}
      </div>}
    </>}
  </>
}

function SavedEditor({ id, ...props }: Omit<Parameters<typeof Editor>[0], 'initial'> & { id: string }) {
  const resource = useResource<Achievement>(recordPath(id))
  return <>
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    {resource.loading && !resource.data && <p role="status">Завантажуємо досягнення…</p>}
    {resource.data ? <Editor initial={resource.data} {...props} /> :
      <button className="control" onClick={props.close}>До списку</button>}
  </>
}

export default function StudentAchievements({ openGroups }: { openGroups: () => void }) {
  const records = useResource<{ records: RecordSummary[] }>('/api/achievements/')
  const catalogue = useResource<Catalogue>('/api/catalogue/')
  const profile = useResource<Profile>('/api/profile/')
  const memberships = useResource<{ memberships: Membership[] }>('/api/memberships/')
  const groups = (memberships.data?.memberships ?? []).filter((item) => item.status === 'approved' && !item.group.archived).map((item) => item.group)
  const [selected, setSelected] = useState<string>()
  const [waiting, setWaiting] = useState(false)
  const editorReady = Boolean(catalogue.data && profile.data && memberships.data)
  const visible = (records.data?.records ?? []).filter((item) => !waiting || waitingForDocument(item))
  function open(id: string) {
    setSelected(id)
    window.scrollTo(0, 0)
  }
  if (selected && catalogue.data && profile.data && editorReady) {
    const props = { catalogue: catalogue.data, profile: profile.data, groups, openGroups,
      close: () => setSelected(undefined), changed: records.refreshAfterWrite }
    return selected === 'new' ? <Editor key="new" {...props} /> : <SavedEditor key={selected} id={selected} {...props} />
  }
  return <>
    <header className="page-heading record-heading"><div><h1>Мої досягнення</h1></div>
      <button className="control primary" disabled={!editorReady} onClick={() => open('new')}>
        <Plus size={16} aria-hidden="true" /> Нове досягнення
      </button>
    </header>
    {[records, catalogue, profile, memberships].map((resource, index) =>
      <ErrorNotice key={index} error={resource.error} retry={resource.refresh} />)}
    {!records.data && records.loading && <p role="status">Завантажуємо досягнення…</p>}
    {Boolean(records.data?.records.length) && <label className="choice-list filter-choice">
      <input type="checkbox" checked={waiting} onChange={(event) => setWaiting(event.target.checked)} /> Потрібно додати документ
    </label>}
    {records.data && !visible.length && <p className="hint">{waiting ? 'Немає записів з очікуваним документом.' : 'Ви ще не додали жодного досягнення.'}</p>}
    <ul className="record-list portfolio-records">{visible.map((item) => <li key={item.id}>
      <button className="group-row" disabled={!editorReady} onClick={() => open(item.id)}>
        <span className="row-name"><strong>{recordTitle(item)}</strong><span>{[item.season, item.stage_name].filter(Boolean).join(' · ')}</span></span>
        <RecordBadges record={item} /><ChevronRight size={15} aria-hidden="true" />
      </button>
    </li>)}</ul>
  </>
}
