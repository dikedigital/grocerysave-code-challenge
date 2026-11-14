import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import Button from './Button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render errors below it and offers a retry or a page reload instead of a blank screen. */
class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      // Visible in the browser console while developing; production keeps the console quiet.
      console.error(error, info.componentStack);
    }
  }

  private handleRetry = () => this.setState({ error: null });

  private handleReload = () => window.location.reload();

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div role="alert" className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Something went wrong</h1>
          <p className="text-gray-600 mb-6">
            An unexpected error stopped this page from displaying. You can try again or reload the page.
          </p>
          <div className="space-y-3">
            <Button onClick={this.handleRetry} className="w-full">
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
              Try again
            </Button>
            <Button variant="outline" onClick={this.handleReload} className="w-full">
              Reload page
            </Button>
          </div>
          {import.meta.env.DEV && (
            <pre className="mt-6 max-h-40 overflow-auto rounded-md bg-red-50 p-3 text-left text-xs text-red-700">
              {error.message}
            </pre>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
