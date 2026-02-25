'use client'

import React from 'react'

interface SilentErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
  name?: string
}

interface SilentErrorBoundaryState {
  hasError: boolean
}

/**
 * Catches render errors in child components and shows a minimal
 * retry UI instead of crashing the entire page.
 */
export class SilentErrorBoundary extends React.Component<
  SilentErrorBoundaryProps,
  SilentErrorBoundaryState
> {
  constructor(props: SilentErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): SilentErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[SilentErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`,
      error,
      info.componentStack,
    )
  }

  handleRetry = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex flex-col items-center justify-center p-6 text-center gap-3">
          <p className="text-sm text-gray-500">
            Something went wrong{this.props.name ? ` in ${this.props.name}` : ''}.
          </p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
