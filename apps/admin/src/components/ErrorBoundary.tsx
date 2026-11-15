import { Component, type ErrorInfo, type ReactNode } from 'react';
import ServerErrorPage from '@/pages/ServerErrorPage';

interface Props { children: ReactNode }
interface State { error: Error | null; reference: string | null; componentStack: string | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reference: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, reference: `ERR-${Date.now().toString(36).toUpperCase()}` };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept on state as well as logged: the console is the first thing lost
    // when the person who hit this is not the person who will fix it.
    this.setState({ componentStack: info.componentStack ?? null });
    console.error('[Admin ErrorBoundary]', error, info.componentStack);
  }

  handleRetry = () => this.setState({ error: null, reference: null, componentStack: null });

  render() {
    if (this.state.error) {
      return (
        <ServerErrorPage
          reference={this.state.reference ?? undefined}
          error={this.state.error}
          componentStack={this.state.componentStack}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}
