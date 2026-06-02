import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children?: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo)
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center">
          <div className="rounded-full bg-red-500/10 p-4 mb-4">
            <AlertTriangle className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Something went wrong</h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6">
            The component crashed due to an unexpected error. This has been logged and we'll look into it.
          </p>
          <div className="bg-red-500/5 border border-red-500/10 rounded-lg p-4 mb-6 w-full max-w-md text-left">
            <p className="text-xs font-mono text-red-400 break-all">
              {this.state.error?.message || 'Unknown error'}
            </p>
          </div>
          <Button variant="outline" onClick={this.handleReset} className="gap-2">
            <RefreshCcw className="h-4 w-4" />
            Reload Page
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
