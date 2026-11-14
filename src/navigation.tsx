import { createContext, useContext, useEffect, useRef, useState, type AnchorHTMLAttributes } from 'react'
import { canLeave } from './ui'

const current = () => window.location.hash.slice(1)
const pathOf = (route: string) => route.split('?')[0]

export function useHashRoute(fallback: string) {
  const normalize = (hash: string) => hash.startsWith('/') && !hash.startsWith('//') ? hash : fallback
  const [route, setRoute] = useState(() => normalize(current()))
  const active = useRef(route)

  function apply(next: string) {
    active.current = next
    setRoute(next)
  }

  useEffect(() => {
    function changed() {
      const next = normalize(current())
      if (next === active.current) return
      if (canLeave()) apply(next)
      else history.pushState(null, '', '#' + active.current)
    }
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [fallback])

  function navigate(next: string, replace = false, check = true) {
    if (next === active.current || (check && !canLeave())) return
    history[replace ? 'replaceState' : 'pushState'](null, '', '#' + next)
    apply(next)
  }

  const path = pathOf(route)
  const params = new URLSearchParams(route.split('?')[1])
  return { path, params, route, navigate, update(values: Record<string, string>) {
    const filters = new URLSearchParams(params)
    for (const [name, value] of Object.entries(values)) {
      if (value) filters.set(name, value)
      else filters.delete(name)
    }
    navigate(path + (filters.size ? '?' + filters : ''), true)
  } }
}

export const Navigation = createContext<ReturnType<typeof useHashRoute> | null>(null)
export function useNavigation() {
  const navigation = useContext(Navigation)
  if (!navigation) throw new Error('Missing workspace navigation')
  return navigation
}

export function RouteLink({ to, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const { navigate } = useNavigation()
  return <a {...props} href={'#' + to} onClick={(event) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }} />
}

export function detailRoute(path: string, from: string, group?: number) {
  const query = new URLSearchParams({ from })
  if (group) query.set('group', String(group))
  return path + '?' + query
}

export function backRoute(params: URLSearchParams, fallback: string) {
  const from = params.get('from') ?? ''
  return from.startsWith('/') && !from.startsWith('//') && from.length < 2000 ? from : fallback
}
