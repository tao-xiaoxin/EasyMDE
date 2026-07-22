import { Component } from '@wordpress/element';
import type { ErrorInfo, ReactNode } from 'react';

type FontControlsErrorBoundaryProps = Readonly<{
  children: ReactNode;
  onFailure: () => void;
}>;

type FontControlsErrorBoundaryState = Readonly<{
  failed: boolean;
}>;

export class FontControlsErrorBoundary extends Component<
  FontControlsErrorBoundaryProps,
  FontControlsErrorBoundaryState
> {
  public override state: FontControlsErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): FontControlsErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    this.props.onFailure();
  }

  public override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
