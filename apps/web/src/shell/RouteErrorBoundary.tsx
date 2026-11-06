import { ErrorState } from "@labscape/ui";
import { Component, type ReactNode } from "react";

/** One per route: a crash in one page shows a retry card instead of taking down the shell. */
export class RouteErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error("[route]", error);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-lg py-16">
          <ErrorState
            title="This page hit a snag"
            body="The rest of LABscape still works. Try loading it again."
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
