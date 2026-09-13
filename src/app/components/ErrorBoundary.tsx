// 04-FRONTEND.md §2: per-section, so one bad block cannot blank the board.
// "The smoke render gate asserts the app mounts without an error boundary
// trip, so a boundary wrapping the whole app would let a single malformed
// block fail the entire run" -- hence one instance per SectionPanel, not
// one wrapping AppShell.
//
// Sets data-error-boundary-tripped="true" on catch -- the exact marker gate
// check 3 (src/gate/smoke-render.ts) looks for.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  sectionLabel: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[${this.props.sectionLabel}] section failed to render:`,
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div
          data-error-boundary-tripped="true"
          className="rounded border border-destructive/50 bg-destructive/10 p-4 text-sm text-foreground"
        >
          <p className="font-medium">{this.props.sectionLabel} failed to render.</p>
          <p className="mt-1 text-muted-foreground">
            This section is broken, not the whole dashboard. Check the Health modal.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
