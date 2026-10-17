import { Component, type ReactNode } from 'react';
import { ErrorState } from '@/components/primitives';

interface State { error: Error | null }
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string; resetKey?: unknown }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  componentDidCatch(error: Error) { console.error(`[ErrorBoundary:${this.props.label ?? 'app'}]`, error); }
  render() {
    if (this.state.error) return <ErrorState error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
