import { Component } from '@wordpress/element';
import type { ErrorInfo, ReactNode } from 'react';

type AppearanceErrorBoundaryProps = Readonly<{
  children: ReactNode;
  onFailure: () => void;
}>;

type AppearanceErrorBoundaryState = Readonly<{
  failed: boolean;
}>;

export class AppearanceErrorBoundary extends Component<
  AppearanceErrorBoundaryProps,
  AppearanceErrorBoundaryState
> {
  public override state: AppearanceErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): AppearanceErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    this.props.onFailure();
  }

  public override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
