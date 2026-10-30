export function StickyOpacityControl({
  label,
  value,
  onChange,
  onCommit,
  min = 10,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  min?: number;
}) {
  const commit = (target: HTMLInputElement) => onCommit(Number(target.value));

  return (
    <div className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-medium text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums text-foreground">{value}%</span>
      </div>
      <input
        type="range"
        min={min}
        max={100}
        step={5}
        value={value}
        aria-label={label}
        className="block h-4 w-full cursor-pointer accent-primary"
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={(event) => commit(event.currentTarget)}
        onKeyUp={(event) => commit(event.currentTarget)}
        onBlur={(event) => commit(event.currentTarget)}
      />
    </div>
  );
}
