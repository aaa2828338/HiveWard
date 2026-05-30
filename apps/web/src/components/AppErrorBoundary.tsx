import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error?: Error;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("HiveWard UI render failed", error, errorInfo);
  }

  reload = () => {
    window.location.reload();
  };

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-fatal-error" role="alert">
        <section className="app-fatal-error-panel">
          <div className="app-fatal-error-mark" aria-hidden="true">
            !
          </div>
          <div className="app-fatal-error-copy">
            <h1>HiveWard UI failed to render</h1>
            <p>{this.state.error.message || "A client-side render error stopped the page."}</p>
          </div>
          <button type="button" className="primary-action" onClick={this.reload}>
            Reload
          </button>
        </section>
      </main>
    );
  }
}
