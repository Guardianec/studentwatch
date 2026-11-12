import { useState } from 'react'
import { api, desktop, type User } from './api'
import { type Profile } from './portfolio'
import { canLeave, ErrorNotice, FieldError, useAction, useResource, useUnsaved } from './ui'

const suggested = ['Інформатика', 'ШІ', 'Математика', 'Дослідницькі роботи']
const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean)

export function SafeLink({ url }: { url: string }) {
  const action = useAction()
  const [copied, setCopied] = useState(false)
  return desktop ? <span className="link-copy">
    <span>{url}</span>
    <button type="button" className="control" onClick={() => void action.run(async () => {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    })}>{copied ? 'Скопійовано' : 'Копіювати посилання'}</button>
    <ErrorNotice error={action.error} />
  </span> : <a className="text-link" href={url} target="_blank" rel="noreferrer noopener">{url}</a>
}

export function ProfileDetails({ profile }: { profile: Profile }) {
  return <>
    <section className="portfolio-section"><h3>Навчання</h3>
      <dl className="portfolio-facts">
        <div><dt>Заклад освіти</dt><dd>{profile.school || 'Не зазначено'}</dd></div>
        <div><dt>Клас або рік навчання</dt><dd>{profile.grade || 'Не зазначено'}</dd></div>
        {profile.locality && <div><dt>Населений пункт</dt><dd>{profile.locality}</dd></div>}
      </dl>
    </section>
    <section className="portfolio-section"><h3>Інтереси та розвиток</h3>
      <dl className="portfolio-facts">
        {profile.interests.length > 0 && <div><dt>Інтереси</dt><dd>{profile.interests.join(', ')}</dd></div>}
        {profile.about && <div><dt>Про себе</dt><dd>{profile.about}</dd></div>}
        {profile.goals && <div><dt>Навчальні цілі</dt><dd>{profile.goals}</dd></div>}
        {profile.skills && <div><dt>Навички та технології</dt><dd>{profile.skills}</dd></div>}
        {!profile.interests.length && !profile.about && !profile.goals && !profile.skills &&
          <div><dd className="hint">Поки немає відомостей.</dd></div>}
      </dl>
    </section>
    {profile.links.length > 0 && <section className="portfolio-section"><h3>Академічні посилання</h3>
      <ul className="portfolio-links">{profile.links.map((url) => <li key={url}><SafeLink url={url} /></li>)}</ul>
    </section>}
  </>
}

function ProfileForm({ profile, save, cancel }: {
  profile: Profile; save: (profile: Profile & { user: User }) => void; cancel: () => void
}) {
  const [form, setForm] = useState(profile)
  const [custom, setCustom] = useState(profile.interests.filter((item) => !suggested.includes(item)).join('\n'))
  const [links, setLinks] = useState(profile.links.join('\n'))
  const action = useAction()
  const interests = [...form.interests.filter((item) => suggested.includes(item)), ...lines(custom)]
  useUnsaved(JSON.stringify({ ...form, interests, links: lines(links) }) !== JSON.stringify(profile))
  type TextField = 'full_name' | 'school' | 'grade' | 'locality' | 'about' | 'goals' | 'skills'

  function field(key: TextField, label: string, maxLength: number, example?: string, multiline = false) {
    const error = action.error?.fields[key]
    const properties = {
      value: form[key], maxLength, placeholder: example, 'aria-invalid': Boolean(error),
      'aria-describedby': error ? key + '-error' : undefined,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((previous) => ({ ...previous, [key]: event.target.value })),
    }
    return <label>{label}{multiline ? <textarea {...properties} rows={3} /> :
      <input {...properties} required={key === 'full_name'} autoComplete={key === 'full_name' ? 'name' : undefined} />}
      <FieldError id={key + '-error'} message={error} /></label>
  }

  return <form className="form portfolio-form" onSubmit={(event) => {
    event.preventDefault()
    void action.run(async () => {
      save(await api<Profile & { user: User }>('/api/profile/', 'PATCH', { ...form, interests, links: lines(links) }))
    })
  }}>
    <fieldset disabled={action.busy}>
      <legend>Навчання</legend>
      <p className="hint">Усі поля, крім ПІБ, необов’язкові.</p>
      {field('full_name', 'ПІБ', 120)}
      {field('school', 'Заклад освіти', 160, 'Наприклад, Ліцей № 7')}
      <div className="field-grid">
        {field('grade', 'Клас або рік навчання', 40, 'Наприклад, 10-Б')}
        {field('locality', 'Населений пункт', 100, 'Наприклад, Львів')}
      </div>
    </fieldset>
    <fieldset disabled={action.busy}>
      <legend>Інтереси та розвиток</legend>
      <div className="choice-list" role="group" aria-label="Академічні інтереси">
        {suggested.map((item) => <label key={item}><input type="checkbox" checked={form.interests.includes(item)}
          onChange={(event) => setForm({ ...form, interests: event.target.checked
            ? [...form.interests, item] : form.interests.filter((interest) => interest !== item) })} />{item}</label>)}
      </div>
      <label>Власні інтереси
        <textarea value={custom} onChange={(event) => setCustom(event.target.value)} maxLength={730} rows={2}
          placeholder="Кожен інтерес з нового рядка" aria-describedby="interests-hint"
          aria-invalid={Boolean(action.error?.fields.interests)} />
        <span id="interests-hint" className="hint">До 12 інтересів загалом, по 60 символів.</span>
        <FieldError id="interests-error" message={action.error?.fields.interests} />
      </label>
      {field('about', 'Про себе', 800, 'Наприклад, беру участь у шкільному гуртку робототехніки.', true)}
      {field('goals', 'Навчальні цілі', 800, 'Наприклад, підготувати дослідницьку роботу.', true)}
      {field('skills', 'Навички та технології', 500, 'Наприклад, Python, Git, Arduino.', true)}
    </fieldset>
    <fieldset disabled={action.busy}>
      <legend>Академічні посилання</legend>
      <label>Посилання на профілі
        <textarea value={links} onChange={(event) => setLinks(event.target.value)} maxLength={2510} rows={3}
          placeholder="https://github.com/…" aria-describedby="profile-links-hint"
          aria-invalid={Boolean(action.error?.fields.links)} />
        <span id="profile-links-hint" className="hint">До 5 адрес GitHub, Codeforces, AtCoder чи портфоліо, кожна з нового рядка.</span>
        <FieldError id="links-error" message={action.error?.fields.links} />
      </label>
    </fieldset>
    <ErrorNotice error={action.error} />
    <div className="actions">
      <button className="control primary" type="submit" disabled={action.busy}>Зберегти профіль</button>
      <button className="control" type="button" disabled={action.busy} onClick={() => { if (canLeave()) cancel() }}>Скасувати</button>
    </div>
  </form>
}

export function StudentProfile({ user, update }: { user: User; update: (user: User) => void }) {
  const profile = useResource<Profile>('/api/profile/')
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  return <>
    <header className="page-heading record-heading"><div><h1>Мій профіль</h1>
      <p>{profile.data?.full_name || user.full_name}</p></div>
      {profile.data && !editing && <button className="control" onClick={() => { setEditing(true); setSaved(false) }}>Редагувати</button>}
    </header>
    <details className="profile-privacy"><summary>Хто бачить ці дані</summary>
      <p className="hint">Профіль бачите ви та вчителі груп, у яких ваше членство підтверджено. Логін бачите лише ви.</p>
    </details>
    <ErrorNotice error={profile.error} retry={profile.refresh} />
    {profile.loading && !profile.data && <p role="status">Завантажуємо профіль…</p>}
    {saved && <p role="status" className="invite-preview">Профіль оновлено.</p>}
    {profile.data && (editing ? <ProfileForm profile={profile.data} cancel={() => setEditing(false)} save={({ user: current, ...value }) => {
      profile.replace(() => value)
      update(current)
      setEditing(false)
      setSaved(true)
    }} /> : <>
      <ProfileDetails profile={profile.data} />
      <section className="portfolio-section"><h3>Обліковий запис</h3><p className="hint">Логін · {user.username}</p></section>
    </>)}
  </>
}

export function TeacherProfile({ id }: { id: number }) {
  const resource = useResource<Profile>('/api/students/' + id + '/profile/', '', true)
  return <>
    <ErrorNotice error={resource.error} retry={resource.refresh} />
    {resource.loading && !resource.data && <p role="status">Завантажуємо профіль…</p>}
    {resource.data && <><h2>{resource.data.full_name}</h2><ProfileDetails profile={resource.data} /></>}
  </>
}
