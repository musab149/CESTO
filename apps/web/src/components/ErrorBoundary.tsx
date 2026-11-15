import { Component, type ErrorInfo, type ReactNode } from 'react';
import ServerErrorPage from '@/pages/ServerErrorPage';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  reference: string | null;
}

/**
 * Catches uncaught render-time exceptions and shows the 500 page
 * instead of a blank white screen. Errors thrown in event handlers
 * or async callbacks are NOT caught — those should be handled with
 * try/catch + the toast component, or by React Query's onError.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reference: null };

  static getDerivedStateFromError(error: Error): State {
    const reference = `ERR-${Date.now().toString(36).toUpperCase()}`;
    return { error, reference };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  handleRetry = () => {
    this.setState({ error: null, reference: null });
  };

  render() {
    if (this.state.error) {
      return (
        <ServerErrorPage
          reference={this.state.reference ?? undefined}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}
