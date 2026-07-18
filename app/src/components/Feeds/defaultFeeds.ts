/** Curated feeds shown as suggestions in AddFeedDialog, grouped by category.
 *  Also seeded as real subscriptions on very first run (SEEDED_FLAG).
 *
 *  History: the original literary/essay batch (Nautilus, Quanta, Noema,
 *  ProPublica, Marginalian, Guardian Long Read, Public Domain Review, PG
 *  Essays) was removed 2026-07-17 at the user's request; JS Party removed
 *  because the show ended (last episode Feb 2025). Aeon/Psyche stay excluded:
 *  Vercel bot-challenge breaks in-app reading (verified 2026-07-12).
 *  Every feed below was verified alive 2026-07-17. */

export type FeedCategory = "webdev" | "tech" | "podcast";

export interface DefaultFeed {
  title: string;
  url: string;
  desc: string;
  category: FeedCategory;
}

export const FEED_CATEGORIES: FeedCategory[] = ["webdev", "tech", "podcast"];

export const DEFAULT_FEEDS: DefaultFeed[] = [
  // ── Articles · Web development ──────────────────────────────────────────
  { category: "webdev", title: "JavaScript Weekly", url: "https://cprss.s3.amazonaws.com/javascriptweekly.com.xml", desc: "Weekly digest of JavaScript news and articles" },
  { category: "webdev", title: "Frontend Focus", url: "https://cprss.s3.amazonaws.com/frontendfoc.us.xml", desc: "Weekly digest of HTML, CSS, and browser tech" },
  { category: "webdev", title: "Node Weekly", url: "https://cprss.s3.amazonaws.com/nodeweekly.com.xml", desc: "Weekly digest of Node.js news" },
  { category: "webdev", title: "React Status", url: "https://cprss.s3.amazonaws.com/react.statuscode.com.xml", desc: "Weekly digest of React news" },
  { category: "webdev", title: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/", desc: "In-depth articles on front-end and UX" },
  { category: "webdev", title: "CSS-Tricks", url: "https://css-tricks.com/feed/", desc: "Tips, tricks, and techniques on CSS and front-end" },
  { category: "webdev", title: "Josh W Comeau", url: "https://www.joshwcomeau.com/rss.xml", desc: "Interactive deep-dives on CSS, React, and animation" },
  { category: "webdev", title: "TypeScript Blog", url: "https://devblogs.microsoft.com/typescript/feed/", desc: "Official TypeScript release notes and articles" },

  // ── Articles · Tech & AI ────────────────────────────────────────────────
  { category: "tech", title: "Simon Willison", url: "https://simonwillison.net/atom/everything/", desc: "Prolific notes on LLMs, AI tooling, and open source" },
  { category: "tech", title: "Cloudflare Blog", url: "https://blog.cloudflare.com/rss/", desc: "Deep engineering write-ups on networks and security" },
  { category: "tech", title: "GitHub Blog", url: "https://github.blog/feed/", desc: "Product news and engineering from GitHub" },
  { category: "tech", title: "The Pragmatic Engineer", url: "https://blog.pragmaticengineer.com/rss/", desc: "Big-tech and startup engineering culture" },
  { category: "tech", title: "Hacker News", url: "https://hnrss.org/frontpage?points=100", desc: "Front page stories with 100+ points" },
  { category: "tech", title: "Lobsters", url: "https://lobste.rs/rss", desc: "Computing link aggregator, quieter than HN" },
  { category: "tech", title: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", desc: "Tech news with real technical depth" },
  { category: "tech", title: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", desc: "Emerging tech and its impact" },
  { category: "tech", title: "IEEE Spectrum", url: "https://spectrum.ieee.org/feeds/feed.rss", desc: "Engineering and hard-tech journalism" },
  { category: "tech", title: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", desc: "Hands-on ML and open-model releases" },
  { category: "tech", title: "Stratechery", url: "https://stratechery.com/feed/", desc: "Ben Thompson on tech strategy (free weekly articles)" },

  // ── Podcasts ────────────────────────────────────────────────────────────
  { category: "podcast", title: "Syntax", url: "https://feed.syntax.fm", desc: "Wes Bos & Scott Tolinski on web development" },
  { category: "podcast", title: "ShopTalk Show", url: "https://shoptalkshow.com/feed/podcast/", desc: "Chris Coyier & Dave Rupert on front-end" },
  { category: "podcast", title: "The Changelog", url: "https://changelog.com/podcast/feed", desc: "Conversations with open source maintainers" },
  { category: "podcast", title: "Latent Space", url: "https://api.substack.com/feed/podcast/1084089.rss", desc: "AI engineering interviews, very current" },
  { category: "podcast", title: "Practical AI", url: "https://changelog.com/practicalai/feed", desc: "Applied machine learning, approachable" },
  { category: "podcast", title: "Hard Fork", url: "https://feeds.simplecast.com/l2i9YnTd", desc: "NYT's weekly take on tech and AI news" },
  { category: "podcast", title: "Software Engineering Daily", url: "https://softwareengineeringdaily.com/feed/podcast/", desc: "Daily engineering interviews" },
  { category: "podcast", title: "Darknet Diaries", url: "https://feeds.megaphone.fm/darknetdiaries", desc: "True stories from the dark side of the internet" },
  { category: "podcast", title: "CoRecursive", url: "https://corecursive.com/feed", desc: "The stories behind the code" },
  { category: "podcast", title: "Acquired", url: "https://feeds.transistor.fm/acquired", desc: "Deep histories of great companies" },
  { category: "podcast", title: "Lex Fridman", url: "https://lexfridman.com/feed/podcast/", desc: "Long-form conversations on AI and science" },
  { category: "podcast", title: "Oxide and Friends", url: "https://feeds.transistor.fm/oxide-and-friends", desc: "Systems engineering conversations" },
  { category: "podcast", title: "The Vergecast", url: "https://feeds.megaphone.fm/vergecast", desc: "The Verge's flagship tech show" },
];
