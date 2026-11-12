import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { read, ApiFailure, statusText, type MemberStatus } from './api'

export function asFailure(reason: unknown) {
  return reason instanceof ApiFailure ? reason : new ApiFailure('request', 'Дію не виконано. Спробуйте ще раз.')
}

export function useResource<T>(path: string, visit = '', privateView = false) {
  const [state, setState] = useState<{ data?: T; error?: ApiFailure; loading: boolean }>({ loading: true })
  const run = useRef<(afterPending?: boolean) => void>(() => {})
  const epoch = useRef(0)
  useEffect(() => {
    let active = true
    let pending = false
    let again = false
    let failed = false
    setState({ loading: true })
    function load(afterPending = false) {
      if (!active) return
      if (pending) {
        again ||= afterPending
        return
      }
      pending = true
      const current = epoch.current
      setState((previous) => ({ ...previous, loading: true, error: undefined }))
      read<T>(path).then(
        (data) => {
          failed = false
          if (active && current === epoch.current) setState({ data, loading: false })
        },
        (reason) => {
          failed = true
          if (active && current === epoch.current) {
            const error = asFailure(reason)
            setState((previous) => ({
              data: privateView || ['missing', 'forbidden', 'session'].includes(error.code) ? undefined : previous.data,
              error, loading: false,
            }))
          }
        },
      ).finally(() => {
        pending = false
        if (again) {
          again = false
          load()
        }
      })
    }
    run.current = load
    load()
    const timer = window.setInterval(() => { if ((!failed || privateView) && document.visibilityState === 'visible') load() },
      privateView ? 15_000 : 60_000)
    function onVisibility() { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisibility)
    if (privateView) window.addEventListener('focus', onVisibility)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [path, visit, privateView])
  const replace = useCallback((change: (previous?: T) => T) => {
    epoch.current += 1
    setState((previous) => ({ data: change(previous.data), loading: false }))
  }, [])
  return { ...state, refresh: () => run.current(), refreshAfterWrite: () => run.current(true), replace }
}

export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    function beforeLeave(event: Event) {
      if (!window.confirm('Є незбережені зміни. Вийти без збереження?')) event.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('postup-before-leave', beforeLeave)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('postup-before-leave', beforeLeave)
    }
  }, [dirty])
}

export function canLeave() {
  return window.dispatchEvent(new Event('postup-before-leave', { cancelable: true }))
}

export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiFailure>()
  const pending = useRef(false)
  async function run(action: () => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(undefined)
    try {
      await action()
    } catch (reason) {
      setError(asFailure(reason))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return { busy, error, run, clearError: () => setError(undefined) }
}

export function ErrorNotice({ error, retry }: { error?: ApiFailure; retry?: () => void }) {
  if (!error) return null
  return <div className="notice error-notice" role="alert">
    <p>{error.message}</p>
    {retry && <button className="control" onClick={retry}>Повторити</button>}
  </div>
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  return message && <span className="field-error" id={id}>{message}</span>
}

export function MemberBadge({ status }: { status: MemberStatus }) {
  const tone = { pending: 'pending', approved: 'confirmed', rejected: 'clarify', removed: 'draft' }[status]
  return <span className={'record-status ' + tone}>{statusText[status]}</span>
}

export function Modal({ title, onClose, children, busy = false }: {
  title: string; onClose: () => void; children: ReactNode; busy?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} aria-labelledby="modal-title" onClose={onClose}
    onCancel={(event) => { if (busy) event.preventDefault() }}>
    <div className="dialog-top">
      <h2 id="modal-title">{title}</h2>
      <button className="icon-button" aria-label="Закрити" disabled={busy} onClick={() => dialog.current?.close()}>
        <X size={20} aria-hidden="true" />
      </button>
    </div>
    <div className="dialog-content">{children}</div>
  </dialog>
}
