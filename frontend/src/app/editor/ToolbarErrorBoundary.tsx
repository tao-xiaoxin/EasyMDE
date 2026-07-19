import { Component, createElement } from '@wordpress/element';
import type { ErrorInfo, ReactNode } from 'react';

type ToolbarErrorBoundaryProps = Readonly<{
  children: ReactNode;
  onFailure: () => void;
}>;

type ToolbarErrorBoundaryState = Readonly<{
  failed: boolean;
}>;

export class ToolbarErrorBoundary extends Component<
  ToolbarErrorBoundaryProps,
  ToolbarErrorBoundaryState
> {
  public override state: ToolbarErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): ToolbarErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    this.props.onFailure();
  }

  public override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
