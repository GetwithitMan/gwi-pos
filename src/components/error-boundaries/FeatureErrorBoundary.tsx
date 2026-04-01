'use client'

import React from 'react'
import { errorCapture } from '@/lib/error-capture'

interface Props {
  children: React.ReactNode
  featureName: string
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Feature-level error boundary that prevents a single feature crash from
 * taking down the entire page.  Shows the feature name, error message,
 * and a "Try Again" button that resets the boundary so the subtree
 * re-mounts.
 *
 * Integrates with the existing errorCapture monitoring system.
 */
export class FeatureErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    errorCapture.log({
      severity: 'HIGH',
      errorType: 'FRONTEND',
      category: 'feature-error-boundary',
      message: `[${this.props.featureName}] ${error.message}`,
      error,
      component: errorInfo.componentStack?.split('\n')[1]?.trim(),
      action: `Rendering ${this.props.featureName}`,
    })

    console.error(`[${this.props.featureName}] Render error:`, error, errorInfo)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <p className="text-lg font-semibold text-red-600">
            {this.props.featureName} encountered an error
          </p>
          <p className="mt-2 text-sm text-gray-500">
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
