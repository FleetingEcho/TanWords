import { invoke } from "@tauri-apps/api/core";
import type { useDB } from "@/hooks/useDB";
import type { RssFeed } from "@/hooks/useDB.types";
import { DEFAULT_FEEDS } from "./defaultFeeds";

type DB = ReturnType<typeof useDB>;

const SEEDED_FLAG = "rss_defaults_seeded";

/** Default feeds added in a later release, after existing installs had already
 * run the one-time SEEDED_FLAG seeding — those installs need a follow-up
 * seeding pass so JS Party / Syntax still show up as real subscriptions (not
 * just AddFeedDialog suggestions) without re-adding anything the user has
 * since unsubscribed from the original batch. */
const SEEDED_FLAG_V2 = "rss_defaults_seeded_v2";
const V2_DEFAULT_URLS = new Set([
  "https://changelog.com/jsparty/feed",
  "https://feed.syntax.fm",
]);

/** One-time follow-up for installs that already ran the original seeding
 * before this batch of defaults existed. Adds any of V2_DEFAULT_URLS not
 * already subscribed, then never touches them again. */
async function seedV2Defaults(db: DB, existing: RssFeed[]): Promise<RssFeed[]> {
  const seededV2 = await invoke<string | null>("db_get_setting", { key: SEEDED_FLAG_V2 });
  if (seededV2) return existing;

  const subscribedUrls = new Set(existing.map((f) => f.url));
  const toAdd = DEFAULT_FEEDS.filter((p) => V2_DEFAULT_URLS.has(p.url) && !subscribedUrls.has(p.url));
  for (const p of toAdd) {
    await db.addRssFeed(p.url, p.title, "", p.desc);
  }
  await invoke("db_set_setting", { key: SEEDED_FLAG_V2, value: "true" });
  return toAdd.length > 0 ? await db.getRssFeeds() : existing;
}

/** First run only: subscribe the curated defaults (user can unsubscribe freely).
 *  The flag ensures deleted defaults never come back. */
export async function seedDefaults(db: DB, existing: RssFeed[]): Promise<RssFeed[]> {
  try {
    const seeded = await invoke<string | null>("db_get_setting", { key: SEEDED_FLAG });
    if (!seeded) {
      if (existing.length === 0) {
        for (const p of DEFAULT_FEEDS) {
          await db.addRssFeed(p.url, p.title, "", p.desc);
        }
      }
      await invoke("db_set_setting", { key: SEEDED_FLAG, value: "true" });
      return existing.length === 0 ? await db.getRssFeeds() : existing;
    }
    return await seedV2Defaults(db, existing);
  } catch {
    return existing; // web mode / settings unavailable — skip seeding
  }
}
