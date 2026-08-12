import { Component, type ErrorInfo, type ReactNode } from "react";
import { ArrowLeft, RotateCcw, TriangleAlert } from "lucide-react";
import { TerminalWorkspace } from "@/components/Tools/TerminalWorkspace";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/useT";

interface TerminalPageProps {
  visible: boolean;
  maximized: boolean;
  onMaximizedChange: (maximized: boolean) => void;
  onClose: () => void;
}

interface TerminalErrorBoundaryProps {
  children: ReactNode;
  fallback: (error: Error, retry: () => void) => ReactNode;
}

interface TerminalErrorBoundaryState {
  error: Error | null;
}

/** Isolate xterm/addon/render failures from the persistent application root.
 * React boundaries also catch errors thrown by passive effects, which is where
 * xterm addons initialize and refresh their decorations. */
class TerminalErrorBoundary extends Component<
  TerminalErrorBoundaryProps,
  TerminalErrorBoundaryState
> {
  state: TerminalErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): TerminalErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep a diagnostic in DevTools without allowing the exception to reach the
    // application-level React root and replace unrelated pages with a blank UI.
    console.error("[terminal] UI error isolated", error, info.componentStack);
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) return this.props.fallback(this.state.error, this.retry);
    return this.props.children;
  }
}

/** Standalone, persistent terminal route. App keeps this page mounted while
 * users visit another route so shell processes, scrollback, and tab state do
 * not restart during ordinary navigation. */
export function TerminalPage({
  visible,
  maximized,
  onMaximizedChange,
  onClose,
}: TerminalPageProps) {
  const t = useT();

  const leaveTerminal = () => {
    onMaximizedChange(false);
    onClose();
  };

  return (
    <div
      data-testid="terminal-page-host"
      hidden={!visible}
      aria-hidden={!visible}
      className={visible ? "h-full w-full" : "hidden"}
    >
      <TerminalErrorBoundary
        fallback={(error, retry) => (
          <div
            role="alert"
            className="app-drag-region flex h-full min-h-0 w-full items-center justify-center bg-background/80 p-6 backdrop-blur-md"
          >
            <div className="w-full max-w-lg rounded-2xl border border-destructive/25 bg-card/95 p-6 shadow-2xl">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <TriangleAlert className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-serif text-lg font-bold">
                    {t("toolsPage.terminal.crashedTitle")}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("toolsPage.terminal.crashedMessage")}
                  </p>
                  <pre className="mt-3 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-3 text-[11px] text-muted-foreground">
                    {error.message.slice(0, 500)}
                  </pre>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={leaveTerminal}>
                  <ArrowLeft className="mr-1.5 h-4 w-4" />
                  {t("toolsPage.terminal.backToApp")}
                </Button>
                <Button onClick={retry}>
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  {t("toolsPage.terminal.restartAfterCrash")}
                </Button>
              </div>
            </div>
          </div>
        )}
      >
        <TerminalWorkspace
          visible={visible}
          maximized={maximized}
          onMaximizedChange={onMaximizedChange}
          onBack={onClose}
        />
      </TerminalErrorBoundary>
    </div>
  );
}
