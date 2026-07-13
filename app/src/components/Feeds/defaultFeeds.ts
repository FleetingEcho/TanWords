/** Curated default feeds: free full-text, C1/C2-grade prose, steady publishing.
 *  Seeded as real subscriptions on first run (user can unsubscribe freely) and
 *  also shown as suggestions in AddFeedDialog.
 *
 *  Aeon and its sister site Psyche are deliberately excluded: both sit behind
 *  Vercel's bot-challenge (every article request gets a permanent 429, not a
 *  rate limit — see x-vercel-mitigated: challenge), which breaks both in-app
 *  reading and one-click learn. Verified 2026-07-12. */
export const DEFAULT_FEEDS = [
  { title: "Nautilus", url: "https://nautil.us/feed/", desc: "Science connected to everyday life" },
  { title: "Quanta Magazine", url: "https://www.quantamagazine.org/feed/", desc: "Award-winning math and science journalism" },
  { title: "Noema Magazine", url: "https://www.noemamag.com/feed/", desc: "Long-form essays on ideas shaping a changing world" },
  { title: "The Public Domain Review", url: "https://publicdomainreview.org/rss.xml", desc: "Essays on art, history, and culture from the public domain" },
  { title: "ProPublica", url: "https://www.propublica.org/feeds/propublica/main", desc: "Pulitzer-grade investigative journalism" },
  { title: "The Marginalian", url: "https://www.themarginalian.org/feed/", desc: "Literary essays on books, art, and ideas" },
  { title: "The Guardian Long Read", url: "https://www.theguardian.com/news/series/the-long-read/rss", desc: "In-depth journalism" },
  { title: "Paul Graham Essays", url: "http://www.aaronsw.com/2002/feeds/pgessays.rss", desc: "Startup and tech essays" },
  { title: "JS Party", url: "https://changelog.com/jsparty/feed", desc: "Podcast · JavaScript community radio from Changelog" },
  { title: "Syntax", url: "https://feed.syntax.fm", desc: "Podcast · Wes Bos & Scott Tolinski on web development" },
  { title: "Hacker News", url: "https://hnrss.org/frontpage?points=100", desc: "Front page stories with 100+ points" },
];
