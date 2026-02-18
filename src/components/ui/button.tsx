'use client'

import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'glass' | 'glassSecondary' | 'glassGhost' | 'glassOutline'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  isLoading?: boolean
  enableHoverEffect?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', isLoading, enableHoverEffect = false, children, disabled, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center font-semibold transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none rounded-xl'

    const variants = {
      // Original variants
      default: 'bg-gray-800 text-white hover:bg-gray-700 shadow-md hover:shadow-lg',
      primary: 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30',
      secondary: 'bg-gray-200 text-gray-800 hover:bg-gray-300 shadow-sm hover:shadow-md',
      danger: 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:from-red-600 hover:to-red-700 shadow-lg shadow-red-500/25 hover:shadow-xl',
      ghost: 'bg-transparent text-gray-700 hover:bg-white/60 hover:backdrop-blur-sm',
      outline: 'bg-transparent border-2 border-gray-300 text-gray-700 hover:bg-white/60 hover:border-gray-400',

      // Glass variants
      glass: 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white backdrop-blur-sm border border-white/20 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/35 hover:scale-[1.02]',
      glassSecondary: 'bg-white/80 backdrop-blur-md text-gray-800 border border-white/40 shadow-md shadow-black/5 hover:bg-white/90 hover:shadow-lg hover:scale-[1.01]',
      glassGhost: 'bg-white/30 backdrop-blur-sm text-gray-700 border border-transparent hover:bg-white/50 hover:border-white/30',
      glassOutline: 'bg-transparent backdrop-blur-sm text-gray-700 border-2 border-gray-300/50 hover:bg-white/40 hover:border-gray-400/60',
    }

    const sizes = {
      sm: 'px-3 py-2.5 text-sm',
      md: 'px-4 py-2 text-base',
      lg: 'px-6 py-3 text-lg',
      xl: 'px-8 py-4 text-xl min-h-[60px]',
    }

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : null}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'

// Motion-enabled button for animations
interface MotionButtonProps {
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  isLoading?: boolean
  children?: ReactNode
  className?: string
  disabled?: boolean
  onClick?: () => void
}

const MotionButton = forwardRef<HTMLButtonElement, MotionButtonProps>(
  ({ className, variant = 'default', size = 'md', isLoading, children, disabled, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center font-semibold transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none rounded-xl'

    const variants = {
      default: 'bg-gray-800 text-white hover:bg-gray-700 shadow-md',
      primary: 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/25',
      secondary: 'bg-gray-200 text-gray-800 shadow-sm',
      danger: 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25',
      ghost: 'bg-transparent text-gray-700',
      outline: 'bg-transparent border-2 border-gray-300 text-gray-700',
      glass: 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white backdrop-blur-sm border border-white/20 shadow-lg shadow-blue-500/25',
      glassSecondary: 'bg-white/80 backdrop-blur-md text-gray-800 border border-white/40 shadow-md shadow-black/5',
      glassGhost: 'bg-white/30 backdrop-blur-sm text-gray-700 border border-transparent',
      glassOutline: 'bg-transparent backdrop-blur-sm text-gray-700 border-2 border-gray-300/50',
    }

    const sizes = {
      sm: 'px-3 py-2.5 text-sm',
      md: 'px-4 py-2 text-base',
      lg: 'px-6 py-3 text-lg',
      xl: 'px-8 py-4 text-xl min-h-[60px]',
    }

    return (
      <motion.button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        whileHover={{ scale: 1.02, boxShadow: '0 10px 30px rgba(0,0,0,0.12)' }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        {...props}
      >
        {isLoading ? (
          <motion.svg
            className="animate-spin -ml-1 mr-2 h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </motion.svg>
        ) : null}
        {children}
      </motion.button>
    )
  }
)

MotionButton.displayName = 'MotionButton'

export { Button, MotionButton }
