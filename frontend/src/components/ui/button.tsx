import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform,filter] duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Polished jade: a lit top edge and a soft glow that answers the pointer.
        default:
          'bg-[linear-gradient(180deg,hsl(156_64%_68%),hsl(var(--primary)))] text-primary-foreground font-semibold shadow-[inset_0_1px_0_hsl(0_0%_100%/0.35),0_1px_2px_hsl(157_60%_5%/0.5),0_8px_22px_-10px_hsl(var(--primary)/0.7)] hover:brightness-[1.06] hover:shadow-[inset_0_1px_0_hsl(0_0%_100%/0.4),0_1px_2px_hsl(157_60%_5%/0.5),0_10px_28px_-8px_hsl(var(--primary)/0.85)]',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline:
          'border border-border bg-card/50 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.04)] hover:border-[hsl(var(--line-strong))] hover:bg-secondary hover:text-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-secondary hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        purple:
          'bg-[linear-gradient(180deg,hsl(156_64%_68%),hsl(var(--primary)))] text-primary-foreground font-semibold shadow-[inset_0_1px_0_hsl(0_0%_100%/0.35)] hover:brightness-[1.06]',
        // External effect: the action leaves this machine (posting, Google sync).
        ember:
          'bg-[linear-gradient(180deg,hsl(17_100%_74%),hsl(var(--ember)))] text-[#1a0d05] font-semibold shadow-[inset_0_1px_0_hsl(0_0%_100%/0.35),0_8px_22px_-10px_hsl(var(--ember)/0.7)] hover:brightness-[1.06]',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-[9px] px-3 text-xs',
        lg: 'h-11 rounded-xl px-6',
        xl: 'h-12 rounded-xl px-8 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
