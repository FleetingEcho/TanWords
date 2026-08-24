/** The loading spinner shown while a lazy page chunk is fetching. Centered in
 *  its container (the host gives the page a full-height box), matching the
 *  spinner the application shell used to render inline. */
export function PageFallback() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
    </div>
  );
}
