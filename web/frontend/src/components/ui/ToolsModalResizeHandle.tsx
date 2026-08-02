const RESIZE_HANDLE = 16;

interface ToolsModalResizeHandleProps {
  onResizePointerDown: (e: React.PointerEvent) => void;
  onResizePointerMove: (e: React.PointerEvent) => void;
  onResizePointerUp: () => void;
}

/** Bottom-right corner drag handle for resizing the modal panel. */
export function ToolsModalResizeHandle({
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
}: ToolsModalResizeHandleProps) {
  return (
    <div
      className="absolute bottom-0 right-0 cursor-nwse-resize z-10 flex items-center justify-center group"
      style={{
        width: RESIZE_HANDLE,
        height: RESIZE_HANDLE,
      }}
      onPointerDown={onResizePointerDown}
      onPointerMove={onResizePointerMove}
      onPointerUp={onResizePointerUp}
      onPointerCancel={onResizePointerUp}
    >
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors pointer-events-none"
      >
        <path d="M11 1v10H1" strokeLinecap="round" />
        <path d="M11 6v5H6" strokeLinecap="round" />
      </svg>
    </div>
  );
}
