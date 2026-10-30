import React from "react";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; message: string };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: "" };
  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }
  componentDidCatch(err: unknown, info: unknown) {
    console.error("[ErrorBoundary]", err, info);
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="mx-auto max-w-3xl p-8">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6">
          <div className="text-sm font-semibold">页面加载失败</div>
          <div className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">{this.state.message}</div>
          <button
            className="mt-4 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={() => this.setState({ hasError: false, message: "" })}
          >
            重试
          </button>
        </div>
      </div>
    );
  }
}
