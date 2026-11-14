import { useEffect, useState } from 'react'
import { ThumbsUp } from 'lucide-react'
import { version } from '../package.json'
import { api, apiAddress } from './api'
import { ErrorNotice, useAction, useResource } from './ui'

export default function TeacherSettings() {
  const [address, setAddress] = useState('—')
  const health = useResource<{ version: string }>('/api/health/')
  type Review = { version: string; approved: boolean }
  const review = useResource<Review>('/api/review/')
  const action = useAction()
  useEffect(() => { void apiAddress().then(setAddress).catch(() => {}) }, [])
  return <div className="standard-page">
    <header className="page-heading"><h1>Налаштування</h1><p>Підключення до центрального сервера.</p></header>
    <dl className="facts">
      <div><dt>API</dt><dd><code>{address}</code></dd></div>
      <div><dt>Версія сервера</dt><dd>{health.data?.version ?? '—'}</dd></div>
      <div><dt>Версія застосунку</dt><dd>{version}</dd></div>
    </dl>
    <ErrorNotice error={health.error} />
    <button className="control" onClick={health.refresh} disabled={health.loading}>Перевірити зв’язок</button>
    <section className="group-section" aria-labelledby="review-heading">
      <h3 id="review-heading">Перевірка версії</h3>
      <ErrorNotice error={review.error} retry={review.refresh} />
      <ErrorNotice error={action.error} />
      {review.data && (review.data.version !== version
        ? <p className="hint">На сервері версія {review.data.version}. Оновіть застосунок для її перевірки.</p>
        : review.data.approved
          ? <p role="status">Вподобайку за версію {version} збережено.</p>
          : <button className="control" disabled={action.busy || Boolean(review.error)} onClick={() => void action.run(async () => {
            const result = await api<Review>('/api/review/', 'POST', { version })
            review.replace(() => result)
          })}><ThumbsUp size={16} aria-hidden="true" /> {action.busy ? 'Зберігаємо…' : 'Вподобати версію ' + version}</button>)}
    </section>
  </div>
}
