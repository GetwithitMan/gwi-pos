'use client'

import { HTMLAttributes, forwardRef } from 'react'
import { motion, HTMLMotionProps } from 'framer-motion'
import { cn } from '@/lib/utils'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'glass' | 'glassElevated' | 'glassSubtle' | 'glassInteractive'
}

const cardVariants = {
  default: 'rounded-xl border border-gray-200 bg-white shadow-sm',
  glass: 'rounded-2xl bg-white/80 backdrop-blur-xl border border-white/30 shadow-lg shadow-black/5',
  glassElevated: 'rounded-2xl bg-white/90 backdrop-blur-xl border border-white/40 shadow-xl shadow-black/10 hover:shadow-2xl hover:shadow-black/15 transition-shadow duration-300',
  glassSubtle: 'rounded-xl bg-white/60 backdrop-blur-md border border-white/20 shadow-md shadow-black/5',
  glassInteractive: 'rounded-xl bg-white/70 backdrop-blur-lg border border-white/25 shadow-lg shadow-black/5 hover:bg-white/85 hover:shadow-xl hover:border-white/40 cursor-pointer transition-all duration-200',
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants[variant], className)}
      {...props}
    />
  )
)
Card.displayName = 'Card'

// Motion-enabled card for animations
type MotionCardProps = Omit<HTMLMotionProps<'div'>, 'ref'> & {
  variant?: CardProps['variant']
}

const MotionCard = forwardRef<HTMLDivElement, MotionCardProps>(
  ({ className, variant = 'glass', ...props }, ref) => (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className={cn(cardVariants[variant], className)}
      {...props}
    />
  )
)
MotionCard.displayName = 'MotionCard'

const CardHeader = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col space-y-1.5 p-6', className)}
      {...props}
    />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-xl font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
)
CardTitle.displayName = 'CardTitle'

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('text-sm text-gray-500', className)}
      {...props}
    />
  )
)
CardDescription.displayName = 'CardDescription'

const CardContent = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  )
)
CardContent.displayName = 'CardContent'

const CardFooter = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center p-6 pt-0', className)}
      {...props}
    />
  )
)
CardFooter.displayName = 'CardFooter'

export { Card, MotionCard, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
