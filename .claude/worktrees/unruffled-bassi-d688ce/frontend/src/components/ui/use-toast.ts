import * as React from 'react'

const TOAST_LIMIT = 5
const TOAST_REMOVE_DELAY = 4000

type ToastVariant = 'default' | 'destructive' | 'success' | 'warning'

export type Toast = {
  id: string
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

type ToasterState = {
  toasts: Toast[]
}

type Action =
  | { type: 'ADD_TOAST'; toast: Toast }
  | { type: 'REMOVE_TOAST'; id: string }

let count = 0
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

const listeners: Array<(state: ToasterState) => void> = []
let memoryState: ToasterState = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((l) => l(memoryState))
}

function reducer(state: ToasterState, action: Action): ToasterState {
  switch (action.type) {
    case 'ADD_TOAST':
      return { toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) }
    case 'REMOVE_TOAST':
      return { toasts: state.toasts.filter((t) => t.id !== action.id) }
  }
}

export function toast(props: Omit<Toast, 'id'>) {
  const id = genId()
  const duration = props.duration ?? TOAST_REMOVE_DELAY

  dispatch({ type: 'ADD_TOAST', toast: { ...props, id } })

  setTimeout(() => {
    dispatch({ type: 'REMOVE_TOAST', id })
  }, duration)

  return id
}

toast.success = (title: string, description?: string) =>
  toast({ title, description, variant: 'success' })

toast.error = (title: string, description?: string) =>
  toast({ title, description, variant: 'destructive' })

toast.warning = (title: string, description?: string) =>
  toast({ title, description, variant: 'warning' })

export function useToast() {
  const [state, setState] = React.useState<ToasterState>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const idx = listeners.indexOf(setState)
      if (idx > -1) listeners.splice(idx, 1)
    }
  }, [])

  return {
    toasts: state.toasts,
    toast,
    dismiss: (id: string) => dispatch({ type: 'REMOVE_TOAST', id }),
  }
}
