import * as React from 'react'
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Toast } from './use-toast'

const variantStyles: Record<string, string> = {
  default:     'bg-card border-border text-foreground',
  destructive: 'bg-red-950/80 border-red-800 text-red-100',
  success:     'bg-green-950/80 border-green-800 text-green-100',
  warning:     'bg-yellow-950/80 border-yellow-800 text-yellow-100',
}

const variantIcons: Record<string, React.ReactNode> = {
  default:     <Info className="size-4 text-muted-foreground" />,
  destructive: <AlertCircle className="size-4 text-red-400" />,
  success:     <CheckCircle2 className="size-4 text-green-400" />,
  warning:     <AlertTriangle className="size-4 text-yellow-400" />,
}

interface ToastItemProps extends Toast {
  onDismiss: (id: string) => void
}

export function ToastItem({ id, title, description, variant = 'default', onDismiss }: ToastItemProps) {
  return (
    <div
      className={cn(
        'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border p-4 shadow-lg transition-all animate-fade-in',
        variantStyles[variant]
      )}
    >
      <span className="mt-0.5 shrink-0">{variantIcons[variant]}</span>
      <div className="flex-1 min-w-0">
        {title && <p className="text-sm font-semibold leading-tight">{title}</p>}
        {description && (
          <p className="text-xs mt-0.5 opacity-80 leading-snug">{description}</p>
        )}
      </div>
      <button
        onClick={() => onDismiss(id)}
        className="shrink-0 rounded p-0.5 opacity-50 hover:opacity-100 transition-opacity"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
