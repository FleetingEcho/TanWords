/**
 * Display-time asset URL resolution — the replacement for BlockNote's
 * `resolveFileUrl` editor option, which has no Tiptap equivalent (plan.md §4b).
 *
 * BlockNote resolved `tanwords-asset://<id>` centrally, at render time, for
 * every file block. Tiptap has no such hook, so each media node view resolves
 * its own URL through this one hook rather than growing its own copy.
 *
 * CRITICAL (plan.md §4c): the resolved URL is for *display only* and must
 * never be written back into the node's attrs. `pruneDocumentAssets` runs on
 * every save and deletes any asset whose id is absent from the serialized
 * content, so storing a resolved blob URL in place of `tanwords-asset://<id>`
 * would make the next autosave permanently delete the user's file.
 */
import { useEffect, useState } from "react";
import { DOCUMENT_ASSET_SCHEME, resolveDocumentAssetUrl } from "@/lib/documentAssets";

export interface ResolvedAsset {
  /** Safe to hand to `<img src>` / `<video src>`. Empty until resolved. */
  url: string;
  loading: boolean;
  error: boolean;
}

/**
 * Resolves an asset URL for rendering.
 *
 * Anything that is not a `tanwords-asset://` URL (an ordinary https image, a
 * local vault path) passes through untouched and never enters a loading state
 * — those already work in an `<img src>` as they are.
 */
export function useResolvedAssetUrl(url: string | undefined): ResolvedAsset {
  const isAppAsset = Boolean(url?.startsWith(DOCUMENT_ASSET_SCHEME));
  const [state, setState] = useState<ResolvedAsset>(() => ({
    url: isAppAsset ? "" : (url ?? ""),
    loading: isAppAsset,
    error: false,
  }));

  useEffect(() => {
    if (!url) {
      setState({ url: "", loading: false, error: false });
      return;
    }
    if (!url.startsWith(DOCUMENT_ASSET_SCHEME)) {
      setState({ url, loading: false, error: false });
      return;
    }
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: false }));
    // resolveDocumentAssetUrl keeps its own LRU of blob URLs and hands back
    // R2 presigned URLs untouched, so a re-render is not a re-download and a
    // <video> keeps Range-based seeking.
    resolveDocumentAssetUrl(url)
      .then((resolved) => {
        if (!cancelled) setState({ url: resolved, loading: false, error: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: "", loading: false, error: true });
      });
    return () => { cancelled = true; };
  }, [url]);

  return state;
}
