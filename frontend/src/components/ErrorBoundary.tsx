/**
 * Boundary for genuinely unexpected UI errors (a render-time exception, a bug) - distinct
 * from expected domain errors, which every route/component handles explicitly via
 * ApiError/ErrorState instead of letting them reach here (mission §52). React only supports
 * error boundaries as class components (no hook equivalent exists in React 18).
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportUncaughtError } from "../observability/report.js";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | undefined;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: undefined };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportUncaughtError(error, { componentStack: info.componentStack ?? "" });
  }

  private reset = () => {
    this.setState({ error: undefined });
  };

  render() {
    if (this.state.error) {
      return (
        <div role="alert">
          <h1>Algo deu errado</h1>
          <p>Um erro inesperado ocorreu nesta parte da página.</p>
          <button type="button" onClick={this.reset}>
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
