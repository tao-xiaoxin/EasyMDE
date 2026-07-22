import { Component, createElement } from '@wordpress/element';
import type { ErrorInfo, ReactNode } from 'react';

type EditorRootErrorBoundaryProps = Readonly<{
  children: ReactNode;
  failureMessage: string;
  onFailure: (code: string) => void;
}>;

type EditorRootErrorBoundaryState = Readonly<{ failed: boolean }>;

export class EditorRootErrorBoundary extends Component<
  EditorRootErrorBoundaryProps,
  EditorRootErrorBoundaryState
> {
  public override state: EditorRootErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): EditorRootErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    this.props.onFailure('react-editor-render-failed');
  }

  public override render(): ReactNode {
    return this.state.failed ? (
      <div className="notice notice-error easymde-editor-startup-error" role="alert">
        <p>{this.props.failureMessage}</p>
      </div>
    ) : this.props.children;
  }
}
