import { TerminalWorkspace } from "@/components/Tools/TerminalWorkspace";

interface TerminalPageProps {
  visible: boolean;
  maximized: boolean;
  onMaximizedChange: (maximized: boolean) => void;
  onClose: () => void;
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
  return (
    <div
      data-testid="terminal-page-host"
      hidden={!visible}
      aria-hidden={!visible}
      className={visible ? "h-full w-full" : "hidden"}
    >
      <TerminalWorkspace
        visible={visible}
        maximized={maximized}
        onMaximizedChange={onMaximizedChange}
        onBack={onClose}
      />
    </div>
  );
}
