import { Component, createElement } from '@wordpress/element';
import type { ErrorInfo, ReactNode } from 'react';

type DocumentSourceErrorBoundaryProps = Readonly<{
  children: ReactNode;
  onFailure: () => void;
}>;

type DocumentSourceErrorBoundaryState = Readonly<{
  failed: boolean;
}>;

export class DocumentSourceErrorBoundary extends Component<
  DocumentSourceErrorBoundaryProps,
  DocumentSourceErrorBoundaryState
> {
  public override state: DocumentSourceErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): DocumentSourceErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    this.props.onFailure();
  }

  public override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
