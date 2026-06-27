import { useToast } from './use-toast'
import { ToastItem } from './toast'

export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} onDismiss={dismiss} />
      ))}
    </div>
  )
}
