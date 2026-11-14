import { useState, type FormEvent } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import { academicYear, api, inviteLink, type Group, type GroupDetail, type Member } from './api'
import { detailRoute, RouteLink, useNavigation } from './navigation'
import { PortfolioResults } from './PortfolioResults'
import { ErrorNotice, FieldError, MemberBadge, Modal, useAction, useResource } from './ui'

type GroupInput = Pick<Group, 'name' | 'year' | 'description'>

export function GroupForm({ group, save, close }: {
  group?: Group; save: (input: GroupInput) => Promise<void>; close: () => void
}) {
  const action = useAction()
  const today = new Date()
  const startYear = today.getFullYear() - (today.getMonth() < 8 ? 1 : 0)
  const [name, setName] = useState(group?.name ?? '')
  const [year, setYear] = useState(String(group?.year ?? startYear))
  const [description, setDescription] = useState(group?.description ?? '')
  const fields = action.error?.fields ?? {}
  return <Modal title={group ? 'Редагувати групу' : 'Створити групу'} onClose={close} busy={action.busy}>
    <form className="form" onSubmit={(event: FormEvent) => {
      event.preventDefault()
      void action.run(() => save({ name, year: Number(year), description }))
    }}>
      <label>Назва групи
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100}
          aria-invalid={Boolean(fields.name)} aria-describedby={fields.name ? 'group-name-error' : undefined} autoFocus />
        <FieldError id="group-name-error" message={fields.name} />
      </label>
      <label>Початок навчального року
        <input type="number" value={year} onChange={(event) => setYear(event.target.value)}
          min={2000} max={2099} required aria-invalid={Boolean(fields.year)} aria-describedby="group-year-hint" />
        <span id="group-year-hint" className="hint">{fields.year ?? 'Наприклад, 2026 для 2026/27 навчального року.'}</span>
      </label>
      <label>Опис <span className="hint">Необов’язково</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={500}
          aria-invalid={Boolean(fields.description)} aria-describedby={fields.description ? 'group-description-error' : undefined} />
        <FieldError id="group-description-error" message={fields.description} />
      </label>
      <ErrorNotice error={action.error} />
      <button type="submit" className="control primary" disabled={action.busy}>
        {action.busy ? 'Зберігаємо…' : group ? 'Зберегти зміни' : 'Створити групу'}
      </button>
    </form>
  </Modal>
}

export function GroupPanel({ id, changed }: {
  id: number; changed: (detail: GroupDetail) => void
}) {
  const path = '/api/groups/' + id + '/'
  const resource = useResource<GroupDetail>(path, '', true)
  const action = useAction()
  const [editing, setEditing] = useState(false)
  const { params, route, update: updateRoute } = useNavigation()
  const [notice, setNotice] = useState('')
  const [confirmation, setConfirmation] = useState<{ text: string; label: string; run: () => Promise<void> }>()
  const group = resource.data
  const selectedTab = params.get('tab')
  const tab = selectedTab === 'manage' || (selectedTab === 'results' && !group?.archived) ? selectedTab : ''
  const approved = (group?.memberships ?? []).filter((member) => member.status === 'approved')
    .sort((left, right) => left.full_name.localeCompare(right.full_name, 'uk'))

  function accept(result: GroupDetail) {
    resource.replace(() => result)
    changed(result)
  }

  async function update(suffix: string, method: 'PATCH' | 'PUT' | 'DELETE', body?: object) {
    accept(await api<GroupDetail>(path + suffix, method, body))
    setNotice('')
  }

  function decide(member: Member, status: 'approved' | 'rejected' | 'removed') {
    return update('members/' + member.id + '/', 'PATCH', { status })
  }

  async function copy(text: string, message: string) {
    setNotice('')
    try {
      await navigator.clipboard.writeText(text)
      setNotice(message)
    } catch {
      setNotice('Буфер обміну недоступний. Виділіть і скопіюйте текст із поля.')
    }
  }

  return <section className="group-panel" tabIndex={-1} aria-label="Відомості про групу">
    <div className="section-heading group-panel-toolbar">
      <span>{group ? academicYear(group.year) + ' навчальний рік' : 'Відомості про групу'}</span>
      <button className="control" onClick={resource.refresh} disabled={resource.loading || action.busy}>
        <RefreshCw size={15} aria-hidden="true" /> Оновити групу
      </button>
    </div>
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    {resource.loading && !group && <p role="status">Завантажуємо групу…</p>}
    {group && <>
      <h1 className="group-title">{group.name}</h1>
      {group.archived && <p className="hint">Архівна група · нові учасники не додаються</p>}
      {group.description && <p className="group-description">{group.description}</p>}
      <nav className="view-switch" aria-label="Розділи групи">
        <button aria-pressed={tab === ''} onClick={() => updateRoute({ tab: '', page: '' })}>Огляд групи</button>
        {!group.archived && <button aria-pressed={tab === 'results'} onClick={() => updateRoute({ tab: 'results', page: '' })}>Досягнення групи</button>}
        <button aria-pressed={tab === 'manage'} onClick={() => updateRoute({ tab: 'manage', page: '' })}>Керування групою</button>
      </nav>
      {!tab && <section className="group-section" aria-labelledby="members-heading">
        <h2 id="members-heading">Учні групи</h2>
        <ul className="member-list">
          {approved.slice(0, 6).map((member) => <li key={member.id}>
            {group.archived ? <span>{member.full_name}</span> :
              <RouteLink className="text-link" to={detailRoute('/students/' + member.student_id, route)}>{member.full_name}
                <ChevronRight size={15} aria-hidden="true" /></RouteLink>}
          </li>)}
        </ul>
        {!approved.length && <p className="hint">Підтверджених учасників поки немає.</p>}
        {!group.archived && approved.length > 6 && <RouteLink className="control" to={'/students?group=' + group.id}>Усі учні · {approved.length}</RouteLink>}
      </section>}
      {tab === 'results' && !group.archived && <section className="group-section"><h2>Досягнення групи</h2>
        <PortfolioResults teacher groupId={group.id}
          recordRoute={(item) => detailRoute('/achievements/' + item.id, route, group.id)} />
      </section>}
      {tab === 'manage' && <>
      <div className="actions">
        <button className="control" onClick={() => setEditing(true)} disabled={action.busy}>Редагувати</button>
        {!group.archived && <button className="control" disabled={action.busy} onClick={() => setConfirmation({
          text: 'Група залишиться в архіві разом з учасниками та заявками. Чинне запрошення буде відкликано.',
          label: 'Архівувати групу',
          run: () => update('', 'PATCH', { archive: true }),
        })}>Архівувати</button>}
      </div>
      <ErrorNotice error={action.error} />
      {!group.archived && <section className="group-section" aria-labelledby="invite-heading">
        <h3 id="invite-heading">Запросити учнів</h3>
        {group.invitation ? <>
          <p className="hint">Діє до {new Date(group.invitation.expires_at).toLocaleDateString('uk-UA')}.</p>
          <div className="copy-field">
            <input aria-label="Посилання запрошення" value={inviteLink(group.invitation.code)} readOnly onFocus={(event) => event.target.select()} />
            <button className="control" onClick={() => void copy(inviteLink(group.invitation!.code), 'Посилання скопійовано.')}>Копіювати посилання</button>
          </div>
          <div className="copy-field">
            <input aria-label="Код запрошення" value={group.invitation.code} readOnly onFocus={(event) => event.target.select()} />
            <button className="control" onClick={() => void copy(group.invitation!.code, 'Код скопійовано.')}>Копіювати код</button>
          </div>
          <div className="actions">
            <button className="control" disabled={action.busy} onClick={() => setConfirmation({
              text: 'Попереднє посилання та код одразу припинять діяти.',
              label: 'Перевипустити запрошення', run: () => update('invitation/', 'PUT'),
            })}>Перевипустити</button>
            <button className="control" disabled={action.busy} onClick={() => setConfirmation({
              text: 'За цим посиланням або кодом більше не можна подати заявку.',
              label: 'Відкликати запрошення', run: () => update('invitation/', 'DELETE'),
            })}>Відкликати</button>
          </div>
        </> : <>
          <p className="hint">Запрошення діятиме сім днів. Участь потрібно підтвердити в кабінеті.</p>
          <button className="control" disabled={action.busy} onClick={() => void action.run(() => update('invitation/', 'PUT'))}>
            {action.busy ? 'Виконуємо…' : 'Створити запрошення'}
          </button>
        </>}
        {notice && <p role="status" className="hint">{notice}</p>}
      </section>}
      <section className="group-section" aria-labelledby="applications-heading">
        <h3 id="applications-heading">Заявки</h3>
        <ul className="member-list">
          {group.memberships.filter(({ status }) => status === 'pending' || status === 'rejected').map((member) => <li key={member.id}>
            <span><strong>{member.full_name}</strong><MemberBadge status={member.status} /></span>
            {member.status === 'pending' && <div className="actions">
              {!group.archived && <button className="control primary" disabled={action.busy} onClick={() => void action.run(() => decide(member, 'approved'))}>Прийняти</button>}
              <button className="control" disabled={action.busy} onClick={() => setConfirmation({
                text: 'Учень побачить відмову. Повторну заявку до цієї групи він подати не зможе.',
                label: 'Відхилити заявку', run: () => decide(member, 'rejected'),
              })}>Відхилити</button>
            </div>}
          </li>)}
        </ul>
        {!group.memberships.some(({ status }) => status === 'pending') && <p className="hint">Заявок, що очікують рішення, немає.</p>}
      </section>
      <details className="group-section"><summary>Керування учасниками · {approved.length}</summary>
        <ul className="member-list">{approved.map((member) => <li key={member.id}>
          <strong>{member.full_name}</strong>
          <button className="control" disabled={action.busy} onClick={() => setConfirmation({
            text: 'Участь учня в цій групі завершиться. Обліковий запис і решта груп збережуться.',
            label: 'Видалити з групи', run: () => decide(member, 'removed'),
          })}>Видалити з групи</button>
        </li>)}</ul>
      </details>
      </>}
      {editing && <GroupForm group={group} close={() => setEditing(false)} save={async (input) => {
        await update('', 'PATCH', input)
        setEditing(false)
      }} />}
      {confirmation && <Modal title={confirmation.label} onClose={() => setConfirmation(undefined)} busy={action.busy}>
        <p>{confirmation.text}</p>
        <ErrorNotice error={action.error} />
        <div className="actions">
          <button className="control" onClick={() => setConfirmation(undefined)} disabled={action.busy}>Скасувати</button>
          <button className="control primary" disabled={action.busy} onClick={() => void action.run(async () => {
            await confirmation.run()
            setConfirmation(undefined)
          })}>{action.busy ? 'Виконуємо…' : confirmation.label}</button>
        </div>
      </Modal>}
    </>}
  </section>
}
