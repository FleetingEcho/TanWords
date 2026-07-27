import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Keeps the UI current when an outside agent writes through the MCP server.
 *
 * Those writes go straight to SQLite from the server task, so nothing in the
 * app knows they happened — a word Claude just saved wouldn't appear until
 * the user navigated away and back. The server emits a Tauri event per
 * affected area (see mcp/tools.rs `notify`), and this republishes it as the
 * same in-app DOM event the app's own writes already use, so every list that
 * listens for those refreshes without knowing where the change came from.
 * Mount once.
 */
export function useMcpSync() {
  useEffect(() => {
    const unlistens = [
      listen("mcp:vocab-changed", () => window.dispatchEvent(new CustomEvent("vocab-updated"))),
      listen("mcp:docs-changed", () => window.dispatchEvent(new CustomEvent("docs-updated"))),
      listen("mcp:patterns-changed", () => window.dispatchEvent(new CustomEvent("patterns-updated"))),
      listen("mcp:articles-changed", () => window.dispatchEvent(new CustomEvent("articles-updated"))),
    ];
    return () => {
      unlistens.forEach((p) => p.then((unlisten) => unlisten()).catch(() => {}));
    };
  }, []);
}
