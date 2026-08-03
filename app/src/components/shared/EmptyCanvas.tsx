import React from "react";
import { SpecimenBackdrop } from "@/components/Layout/authVisuals";

/** A page with nothing in it yet.
 *
 *  Same condition as the screens in front of the app (sign-in, lock, splash):
 *  no user data to serve, so the typography can be the content rather than
 *  having to get out of its way. That is the rule for reaching for this — an
 *  empty *page*, not an empty list inside a populated one, and never a surface
 *  that is merely loading.
 *
 *  So it borrows half of that language: `SpecimenBackdrop`, a real paragraph
 *  with a few words underlined, turned down until it is texture. It replaces
 *  the tinted icon tile these pages used to share, which said nothing about
 *  this product that it would not also have said about any other. The wordmark
 *  half stays behind — that one means "you are not inside yet", which here
 *  would be a lie.
 *
 *  Set left, not centred: the entry form these pages are quoting reads from
 *  the left margin, and a centred serif heading over a short paragraph is the
 *  splash page of something else. */
export function EmptyCanvas({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  /** Actions. Laid out by the caller — some pages offer one button, some a row of them. */
  children?: React.ReactNode;
}) {
  return (
    <div className="relative flex h-full items-center overflow-hidden">
      <SpecimenBackdrop />

      <div className="relative mx-auto w-full max-w-md px-6 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
        {/* The same short rule that prefixes each usage note on the sign-in
          * screen — small enough to be punctuation rather than decoration. */}
        <span aria-hidden="true" className="mb-4 block h-px w-6 bg-primary/50" />
        <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        {body && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>}
        {children && <div className="mt-6 flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}
