import React from "react";

/** The visual language for screens with no user data on them, kept in one
 *  place so they cannot drift into looking like different products.
 *
 *  The rule for reaching for it: **when the screen holds no user data, the
 *  typography can be the content; the moment it holds data, the typography
 *  gets out of the way.** That is what the screens in front of the app (the
 *  web sign-in gate, the desktop lock screen, the launch splash) and an empty
 *  page (shared/EmptyCanvas) have in common, and it is why Reading, the
 *  document editor and Settings are not on the list — there the running text
 *  *is* the content and a serif display face would only compete with it.
 *
 *  The two halves are separable, and the rule differs between them.
 *  `WordmarkEntry` means "you are not inside yet" and belongs only to the
 *  screens that really are doors. `SpecimenBackdrop` suits an empty page, but
 *  only one with something *solid* in front of it — a card, a wordmark, a
 *  heading with weight. Over nothing but hairlines and translucent text it
 *  stops being ground and becomes competing content, and its underline marks
 *  (brighter than most UI rules in this app) read as stray strokes ruled
 *  across the layout. The reader's paste screen is the worked example: empty,
 *  eligible by the rule above, and still wrong — see ScratchPasteScreen.
 *
 *  The entry form itself is not decoration — it is the shape of what this
 *  product saves. A word, its IPA, its part of speech, a gloss. Vocabulary's
 *  WordDetailPanel sets a real headword the same way, at reading scale; these
 *  screens are quoting it, not the other way round. */

/** A real paragraph with a few words underlined: what the reader does inside
 *  the app, turned down until it is texture rather than content. Chosen over
 *  an abstract gradient because this product's material is running text. */
const SPECIMEN = [
  { text: "The argument is " },
  { text: "compelling", mark: true },
  { text: ", though its premises rest on a " },
  { text: "tenuous", mark: true },
  { text: " reading of the data. Where the author is at their most " },
  { text: "persuasive", mark: true },
  { text: " is in the closing section, which " },
  { text: "reframes", mark: true },
  { text: " the whole question." },
];

export function SpecimenBackdrop() {
  return (
    <p
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 select-none p-6 font-serif text-[clamp(2rem,7vw,4.5rem)] leading-[1.35] tracking-tight text-foreground/[0.045] sm:p-12"
    >
      {SPECIMEN.map((part, index) =>
        part.mark ? (
          <span key={index} className="border-b-[0.06em] border-primary/25 text-foreground/[0.07]">
            {part.text}
          </span>
        ) : (
          <React.Fragment key={index}>{part.text}</React.Fragment>
        ),
      )}
    </p>
  );
}

/** The product name set as a dictionary entry — everything this app saves (a
 *  word, its IPA, its part of speech, a gloss) takes that shape, so the
 *  screens in front of it are the first instance of the form the rest of the
 *  app is made of. */
export function WordmarkEntry({ gloss, compact = false }: { gloss: string; compact?: boolean }) {
  return (
    <>
      <h1
        className={`font-serif font-bold leading-none tracking-tight text-foreground ${
          compact ? "text-[clamp(2rem,7vw,2.75rem)]" : "text-[clamp(2.75rem,9vw,5rem)]"
        }`}
      >
        TanWords
      </h1>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-sm tracking-[0.08em] text-muted-foreground">/ˈtan wɜːdz/</span>
        <span className="font-serif text-sm italic text-primary">n.</span>
      </p>
      <p className={`mt-4 max-w-md font-serif text-foreground/80 ${compact ? "text-base" : "text-lg sm:text-xl"} leading-relaxed`}>
        {gloss}
      </p>
    </>
  );
}

/** An underline rather than a box: it echoes the marked words in the specimen,
 *  and the primary rule sweeping in on focus is the one thing that moves. */
export function UnderlineField({
  label, type, value, onChange, autoComplete, autoFocus, hint, invalid,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  hint?: string;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
        {hint && <span className="font-serif text-[11px] italic text-muted-foreground/60">{hint}</span>}
      </span>
      <input
        type={type}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        // 16px keeps iOS from zooming the viewport on focus.
        className={`peer h-11 w-full border-0 border-b bg-transparent px-0 text-[16px] text-foreground outline-hidden transition-colors placeholder:text-muted-foreground/40 focus:border-transparent ${
          invalid ? "border-destructive" : "border-border"
        }`}
      />
      <span
        className={`block h-px w-full origin-left scale-x-0 transition-transform duration-300 peer-focus:scale-x-100 motion-reduce:transition-none motion-reduce:duration-0 ${
          invalid ? "bg-destructive" : "bg-primary"
        }`}
      />
    </label>
  );
}
