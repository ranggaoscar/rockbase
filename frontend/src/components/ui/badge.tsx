import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
  {
    variants: {
      variant: {
        default:    'border-transparent bg-primary text-primary-foreground',
        secondary:  'border-transparent bg-secondary text-secondary-foreground',
        destructive:'border-transparent bg-destructive text-destructive-foreground',
        outline:    'border-border text-foreground',
        success:    'border-patina/25 bg-patina/10 text-patina',
        warning:    'border-ochre/25 bg-ochre/10 text-ochre',
        error:      'border-oxide/25 bg-oxide/10 text-oxide',
        purple:     'border-patina/25 bg-patina/10 text-patina',
        info:       'border-signal/25 bg-signal/10 text-signal',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
