import { ReadingPage, type ReadingTab } from "@/components/Reader/ReadingPage";

/** Feeds merged into the Reading page (订阅/播客 tabs) on web. This shim keeps
 *  navStore's "feeds" page id, App's lazy import, and dashboard widgets that
 *  navigate("feeds") all working without touching their files. */
export function FeedsPage({ initialTab }: { initialTab?: ReadingTab }) {
  return <ReadingPage initialTab={initialTab ?? "feeds"} />;
}
