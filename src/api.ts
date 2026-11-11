import { invoke, isTauri } from '@tauri-apps/api/core'

export const desktop = isTauri()
export type User = { id: number; username: string; full_name: string; role: 'student' | 'teacher' | 'admin' }
export type Session = { user: User | null; csrf: string }
export type MemberStatus = 'pending' | 'approved' | 'rejected' | 'removed'
export type Group = { id: number; name: string; year: number; description: string; archived: boolean }
export type GroupSummary = Group & { pending: number; approved: number }
export type Member = { id: number; full_name: string; username: string; status: MemberStatus; requested_at: string }
export type GroupDetail = Group & { invitation: { code: string; expires_at: string } | null; memberships: Member[] }
export type Membership = { id: number; status: MemberStatus; group: Pick<Group, 'name' | 'year' | 'archived'> }
export type InvitePreview = { status: MemberStatus | null; group: Pick<Group, 'name' | 'year'> }
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export const statusText: Record<MemberStatus, string> = {
  pending: 'Очікує підтвердження',
  approved: 'Підтверджено',
  rejected: 'Відхилено',
  removed: 'Членство завершено',
}

export class ApiFailure extends Error {
  constructor(public code: string, message: string, public fields: Record<string, string> = {}) {
    super(message)
  }
}

let csrf = ''
let sessionRequest: Promise<Session> | undefined
let identity = 0
const reads = new Map<string, Promise<unknown>>()

function identityChanged() {
  identity += 1
  csrf = ''
  sessionRequest = undefined
  reads.clear()
}

function networkFailure(reason?: unknown) {
  if (reason === 'storage') return new ApiFailure('storage', 'Сховище облікових даних Windows недоступне. Перевірте його та повторіть дію.')
  if (!navigator.onLine) return new ApiFailure('offline', 'Немає мережевого з’єднання. Підключіться до мережі й повторіть дію.')
  return new ApiFailure('server', 'Сервер недоступний. Спробуйте оновити дані пізніше.')
}

async function send<T>(path: string, method: Method, body?: object): Promise<T> {
  let reply: { status: number; data: unknown }
  try {
    if (desktop) {
      reply = await invoke('api_request', { path, method, body, csrf: method === 'GET' ? undefined : csrf })
    } else {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(method !== 'GET' ? { 'X-CSRFToken': csrf } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8000),
      })
      reply = { status: response.status, data: await response.json().catch(() => null) }
    }
  } catch (reason) {
    throw networkFailure(reason)
  }

  const data = reply.data as { code?: string; message?: string; fields?: Record<string, string> } | null
  if (reply.status >= 200 && reply.status < 300 && data) return reply.data as T
  if (reply.status >= 500 || (reply.status < 400 && !data)) throw networkFailure()
  throw new ApiFailure(data?.code ?? 'request', data?.message ?? 'Запит не виконано. Спробуйте ще раз.', data?.fields)
}

export function session(): Promise<Session> {
  if (!sessionRequest) {
    const current = identity
    sessionRequest = send<Session>('/api/session/', 'GET').then((value) => {
      if (typeof value.csrf !== 'string') throw networkFailure()
      if (current === identity) csrf = value.csrf
      return value
    }).finally(() => { if (current === identity) sessionRequest = undefined })
  }
  return sessionRequest
}

export async function api<T>(path: string, method: Method = 'GET', body?: object): Promise<T> {
  const caller = identity
  function expire() {
    if (caller === identity) {
      identityChanged()
      window.dispatchEvent(new Event('postup-session-expired'))
    }
  }
  try {
    return await send<T>(path, method, body)
  } catch (reason) {
    if (!(reason instanceof ApiFailure) || caller !== identity) throw reason
    if (reason.code === 'csrf') {
      const current = await session()
      if (caller !== identity) throw reason
      if (current.user || ['/api/login/', '/api/register/', '/api/logout/'].includes(path)) {
        // The CSRF middleware rejected the first request before it reached the handler.
        try {
          return await send<T>(path, method, body)
        } catch (retryError) {
          if (retryError instanceof ApiFailure && retryError.code === 'session') {
            expire()
          }
          throw retryError
        }
      }
      expire()
      throw new ApiFailure('session', 'Сесія завершилася. Увійдіть знову.')
    }
    if (reason.code === 'session') expire()
    throw reason
  }
}

export function read<T>(path: string): Promise<T> {
  const pending = reads.get(path)
  if (pending) return pending as Promise<T>
  const request = api<T>(path).finally(() => { if (reads.get(path) === request) reads.delete(path) })
  reads.set(path, request)
  return request
}

export async function authenticate(mode: 'login' | 'register', form: object) {
  const value = await api<Session>('/api/' + mode + '/', 'POST', { ...form, client: desktop ? 'teacher' : 'student' })
  identityChanged()
  csrf = value.csrf
  return value.user
}

export async function signOut() {
  const token = csrf
  identityChanged()
  csrf = token
  try {
    await api('/api/logout/', 'POST')
  } finally {
    csrf = ''
    if (desktop) {
      try {
        await invoke('forget_session')
      } catch (reason) {
        throw networkFailure(reason)
      }
    }
  }
}

export function apiAddress() {
  return desktop ? invoke<string>('api_origin') : Promise.resolve(window.location.origin)
}

export function inviteLink(code: string) {
  const origin = import.meta.env.VITE_STUDENT_ORIGIN || 'http://127.0.0.1:1420'
  return new URL('/#join/' + code, origin).href
}

export const academicYear = (year: number) => year + '/' + String(year + 1).slice(-2)
