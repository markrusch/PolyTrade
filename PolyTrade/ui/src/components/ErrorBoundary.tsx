import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `[ErrorBoundary] Caught error in ${this.props.name || "Component"}:`,
      error,
      errorInfo,
    );
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            padding: 20,
            background: "#1e1e2e",
            border: "1px solid #ef4444",
            borderRadius: 8,
            color: "#f8f8f2",
            margin: 10,
            minWidth: 300,
          }}
        >
          <h2
            style={{
              color: "#ef4444",
              marginTop: 0,
              fontSize: "1.25rem",
              fontWeight: 600,
            }}
          >
            ⚠️{" "}
            {this.props.name
              ? `${this.props.name} Failed`
              : "Something went wrong"}
          </h2>
          <div
            style={{
              background: "#282a36",
              padding: 12,
              borderRadius: 6,
              marginTop: 12,
              overflow: "auto",
              fontSize: "0.875rem",
              fontFamily: "monospace",
            }}
          >
            {this.state.error?.message || "Unknown error"}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: 16,
              padding: "8px 16px",
              background: "#ef4444",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
