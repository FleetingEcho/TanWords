import type { PartialBlock } from "@blocknote/core";
import { DOCUMENT_ASSET_SCHEME } from "@/lib/documentAssets";
import { isYouTubeUrl } from "./youtubeUrl";

/** Block types BlockNote renders with a real player/preview. Markdown has a
 *  syntax for exactly one of them (images), which is the whole problem. */
const MEDIA_TYPES = ["video", "audio", "file"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

/** Round-tripping a document through markdown (the raw-source mode, and
 *  markdown export) loses block types that markdown cannot express: a `video`
 *  block comes back as `![name](url)`, i.e. an image — which then renders as a
 *  broken-image icon, because the file is an mp4.
 *
 *  The fix mirrors `mermaidTransforms`: carry the type through the markdown in
 *  something markdown *can* represent. Here that is a query parameter on our
 *  own asset URL, so the markdown stays readable (`[clip.mp4](tanwords-asset://…?type=video)`)
 *  and the type survives the trip. `resolveDocumentAssetUrl` ignores the query,
 *  so a stripped-down copy of the markdown still resolves. */
const TYPE_PARAM = "tanwords-type";

function withTypeParam(url: string, type: MediaType): string {
  if (!url.startsWith(DOCUMENT_ASSET_SCHEME) || url.includes(`${TYPE_PARAM}=`)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${TYPE_PARAM}=${type}`;
}

function readTypeParam(url: string): MediaType | null {
  const match = url.match(new RegExp(`[?&]${TYPE_PARAM}=(video|audio|file)`));
  return match ? (match[1] as MediaType) : null;
}

/** Before markdown export: tag the URL so the block type can be recovered. */
export function lowerMedia(blocks: any[]): any[] {
  return blocks.map((block) => {
    if (MEDIA_TYPES.includes(block?.type) && typeof block?.props?.url === "string") {
      return {
        ...block,
        props: { ...block.props, url: withTypeParam(block.props.url, block.type) },
      };
    }
    if (block?.children?.length) return { ...block, children: lowerMedia(block.children) };
    return block;
  });
}

/** After markdown parse: put the tagged blocks back to their real type.
 *  Markdown will have turned every one of them into `image`. */
export function liftMedia(blocks: PartialBlock[]): any[] {
  return blocks.map((block: any) => {
    const url = block?.props?.url;
    if (typeof url === "string") {
      const type = readTypeParam(url);
      if (type) {
        return { ...block, type, props: { ...block.props, url: stripTypeParam(url) } };
      }
    }
    if (block?.children?.length) return { ...block, children: liftMedia(block.children) };
    return block;
  });
}

export function stripTypeParam(url: string): string {
  return url
    .replace(new RegExp(`[?&]${TYPE_PARAM}=(video|audio|file)`), (match) =>
      match.startsWith("?") ? "" : "")
    .replace(/\?$/, "");
}

/** Before markdown export: an embed becomes a plain link, so the file stays
 *  portable — any other markdown tool shows a working YouTube link. */
export function lowerYouTube(blocks: any[]): any[] {
  return blocks.map((block) => {
    if (block?.type === "youtube") {
      const url = block.props?.url ?? "";
      // The label round-trips as the link text, which is the only place
      // markdown has to put it. Uncaptioned players write the URL as their own
      // label — `liftYouTube` reads that back as "no caption", so an untitled
      // player stays untitled instead of acquiring its own URL as a title.
      const label = block.props?.caption || url;
      return {
        type: "paragraph",
        content: [{ type: "link", href: url, content: [{ type: "text", text: label, styles: {} }] }],
      };
    }
    if (block?.children?.length) return { ...block, children: lowerYouTube(block.children) };
    return block;
  });
}

/** After markdown parse: anything whose entire content is one YouTube link
 *  becomes a player again.
 *
 *  Three shapes, because markdown offers three ways to write the same thing
 *  and BlockNote parses each differently (verified against the real parser in
 *  mediaTransforms.blocknote.test.ts):
 *
 *    [title](url)  -> paragraph containing a `link` node
 *    bare url      -> paragraph containing a plain `text` node
 *    ![title](url) -> an `image` block, which renders as a broken image
 *                     because a YouTube watch page is not an image file
 */
export function liftYouTube(blocks: any[]): any[] {
  return blocks.map((block: any) => {
    const embed = youTubeEmbedOf(block);
    if (embed) return { type: "youtube", props: { url: embed.url, caption: embed.caption } };
    if (block?.children?.length) return { ...block, children: liftYouTube(block.children) };
    return block;
  });
}

export type YouTubeEmbed = { url: string; caption: string };

/** Whether a whole block is one YouTube link, and if so what the player should
 *  be built from — the URL, plus whatever the author called it.
 *
 *  The caption is not decoration: `[tttt](…)` is a title someone typed, and
 *  a player that only stores a URL silently deletes it on the next save. It is
 *  dropped only when it *is* the URL, which is what a bare link parses to and
 *  what `lowerYouTube` writes back for an uncaptioned player.
 *
 *  Exported because the live editor applies the same test to the block being
 *  edited — see useDocEditorContent — and the two must agree on what counts,
 *  or a link would embed on load but not on paste. */
export function youTubeEmbedOf(block: any): YouTubeEmbed | null {
  const url = youTubeUrlOf(block);
  if (!url) return null;
  const raw = captionOf(block);
  return { url, caption: raw.trim() === url.trim() ? "" : raw };
}

function captionOf(block: any): string {
  if (["image", "video", "audio", "file"].includes(block?.type)) {
    return block.props?.caption || block.props?.name || "";
  }
  const only = (block?.content ?? []).find((part: any) => !(part?.type === "text" && !part.text?.trim()));
  if (only?.type === "link") {
    return (only.content ?? []).map((part: any) => part?.text ?? "").join("");
  }
  return "";
}

function youTubeUrlOf(block: any): string | null {
  // Any of BlockNote's built-in media blocks pointed at YouTube. Reaching for
  // the video block for a YouTube link is the obvious move, and it can only
  // ever fail: <video src> gets an HTML page rather than a stream, so it
  // renders controls stuck at 0:00. Same for <img>.
  if (
    ["image", "video", "audio", "file"].includes(block?.type)
    && typeof block.props?.url === "string"
    && isYouTubeUrl(block.props.url)
  ) {
    return block.props.url;
  }
  if (block?.type !== "paragraph" || !Array.isArray(block.content)) return null;
  const parts = block.content.filter((part: any) => !(part?.type === "text" && !part.text?.trim()));
  if (parts.length !== 1) return null;
  const only = parts[0];
  if (only?.type === "link" && typeof only.href === "string" && isYouTubeUrl(only.href)) {
    return only.href;
  }
  // A bare URL is plain text, not a link node.
  if (only?.type === "text" && typeof only.text === "string") {
    const text = only.text.trim();
    if (/^https?:\/\/\S+$/.test(text) && isYouTubeUrl(text)) return text;
  }
  return null;
}
