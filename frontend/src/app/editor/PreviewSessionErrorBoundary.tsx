import { Component } from '@wordpress/element';
import type { ErrorInfo, ReactNode } from 'react';

type Props = Readonly<{ children: ReactNode; onFailure: () => void }>;
type State = Readonly<{ failed: boolean }>;

export class PreviewSessionErrorBoundary extends Component<Props, State> {
  public override state: State = { failed: false };

  public static getDerivedStateFromError(): State {
    return { failed: true };
  }

  public override componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    this.props.onFailure();
  }

  public override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
