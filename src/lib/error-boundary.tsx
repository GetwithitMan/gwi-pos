'use client'

/**
 * React Error Boundary
 *
 * Catches React component errors, displays user-friendly fallback UI,
 * and logs errors to the monitoring system.
 *
 * Usage:
 * ```tsx
 * import { ErrorBoundary } from '@/lib/error-boundary'
 *
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 *
 * Or wrap entire app:
 * ```tsx
 * <ErrorBoundary>
 *   {children}
 * </ErrorBoundary>
 * ```
 */

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { errorCapture } from './error-capture'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
    }
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render shows the fallback UI
    return {
      hasError: true,
      error,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to monitoring system
    errorCapture.log({
      severity: 'HIGH', // Component errors are HIGH by default
      errorType: 'FRONTEND',
      category: 'react-component-error',
      message: error.message,
      error,
      component: errorInfo.componentStack?.split('\n')[1]?.trim(), // First component in stack
      action: 'Rendering React component',
    })

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }

    // Log to console for development
    console.error('[Error Boundary] Caught error:', error, errorInfo)
  }

  resetError = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback provided
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default fallback UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4">
          <div className="max-w-md w-full bg-white/10 backdrop-blur-md rounded-xl shadow-2xl p-8 border border-white/20">
            {/* Error Icon */}
            <div className="flex justify-center mb-6">
              <div className="bg-red-500/20 rounded-full p-4">
                <svg
                  className="w-12 h-12 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
            </div>

            {/* Error Message */}
            <h2 className="text-2xl font-bold text-white text-center mb-2">
              Something went wrong
            </h2>
            <p className="text-gray-300 text-center mb-6">
              An unexpected error occurred. This has been reported to our team.
            </p>

            {/* Error Details (Development only) */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="bg-red-900/30 rounded-lg p-4 mb-6 border border-red-500/30">
                <p className="text-xs font-mono text-red-200 break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={this.resetError}
                className="flex-1 bg-white/20 hover:bg-white/30 text-white font-semibold py-3 px-4 rounded-lg transition-colors backdrop-blur-sm"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
              >
                Reload Page
              </button>
            </div>

            {/* Support Info */}
            <p className="text-xs text-gray-400 text-center mt-6">
              If this problem persists, please contact support.
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

// ============================================
// Lightweight Error Boundary
// ============================================

/**
 * Lightweight error boundary that just logs and shows minimal UI
 * Use for non-critical sections where you want to prevent full page crash
 */
export class SilentErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error silently
    errorCapture.log({
      severity: 'MEDIUM', // Non-critical sections are MEDIUM
      errorType: 'FRONTEND',
      category: 'react-component-error-silent',
      message: error.message,
      error,
      component: errorInfo.componentStack?.split('\n')[1]?.trim(),
      action: 'Rendering React component (silent boundary)',
    })

    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }

    console.error('[Silent Error Boundary] Caught error:', error)
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Minimal fallback - just show nothing
      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">
            This section encountered an error and has been hidden.
          </p>
        </div>
      )
    }

    return this.props.children
  }
}

// ============================================
// Hook for Programmatic Error Handling
// ============================================

/**
 * Hook to report errors from within components
 */
export function useErrorReporting() {
  const reportError = React.useCallback((error: Error, context?: {
    severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
    action?: string
    component?: string
  }) => {
    errorCapture.log({
      severity: context?.severity || 'MEDIUM',
      errorType: 'FRONTEND',
      category: 'component-error',
      message: error.message,
      error,
      action: context?.action,
      component: context?.component,
    })
  }, [])

  return { reportError }
}
