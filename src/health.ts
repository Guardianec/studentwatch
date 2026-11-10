export const apiOrigin = (import.meta.env.VITE_API_ORIGIN || 'http://127.0.0.1:8000').replace(/\/$/, '')

export async function checkServer(signal: AbortSignal): Promise<string> {
  const response = await fetch(`${apiOrigin}/api/health/`, {
    cache: 'no-store',
    credentials: 'omit',
    signal: AbortSignal.any([signal, AbortSignal.timeout(3500)]),
  })
  if (!response.ok) throw new Error('Сервер повернув помилку')

  const info = await response.json()
  if (info?.service !== 'postup' || info.status !== 'ok' || typeof info.version !== 'string') {
    throw new Error('Невідома відповідь сервера')
  }
  return info.version
}
