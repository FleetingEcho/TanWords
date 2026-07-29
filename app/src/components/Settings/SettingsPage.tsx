import React, { useEffect, useRef, useState } from "react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { useNavStore } from "@/store/navStore";
import { ProviderSection } from "./ProviderSection";
import { TtsSection } from "./TtsSection";
import { GeneralSection } from "./GeneralSection";
import { LearningSection } from "./LearningSection";
import { McpSection } from "./McpSection";
import { DataSection } from "./DataSection";

export { SettingRow } from "./SettingsShared";

const SECTIONS = ["general", "providers", "learning", "tts", "mcp", "data"] as const;
type SectionId = (typeof SECTIONS)[number];

export function SettingsPage() {
  const t = useT();
  const db = useDB();

  const sectionRefs = useRef<Record<SectionId, HTMLElement | null>>({
    general: null, providers: null, learning: null, tts: null, mcp: null, data: null,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("general");

  // Scrollspy: highlight the nav item for whichever section is in view. Same
  // "line 35% down the viewport, last section that's crossed it wins"
  // approach as the vocab word-detail outline, kept consistent rather than
  // reaching for IntersectionObserver's separate (and here, nested-scroll-
  // container-sensitive) root/threshold model.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = el.clientHeight * 0.35;
      let active: SectionId = "general";
      for (const id of SECTIONS) {
        const section = sectionRefs.current[id];
        if (!section) continue;
        if (section.offsetTop - el.scrollTop > line) break;
        active = id;
      }
      setActiveSection(active);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    el.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const jumpTo = (id: SectionId) => {
    const el = scrollRef.current;
    const target = sectionRefs.current[id];
    if (!el || !target) return;
    el.scrollTo({ top: Math.max(0, target.offsetTop - 12), behavior: "smooth" });
  };

  // Deep-links from elsewhere in the app (e.g. the cloud-DB status icon ->
  // "data") land here instead of always opening on the first section.
  // Sections above the target keep growing for a moment after mount (async
  // provider lists, images), which would leave the initial jump stranded
  // mid-section — so keep the target pinned to the top until layout settles.
  const requestedSection = useNavStore((s) => s.settingsSection);
  useEffect(() => {
    if (!requestedSection || !(SECTIONS as readonly string[]).includes(requestedSection)) return;
    const id = requestedSection as SectionId;
    const el = scrollRef.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;

    const align = () => {
      const target = sectionRefs.current[id];
      if (target) el.scrollTop = Math.max(0, target.offsetTop - 12);
    };
    align();

    const observer = new ResizeObserver(align);
    observer.observe(content);
    // Stop re-pinning once things have settled, so the user can scroll freely.
    const timer = window.setTimeout(() => observer.disconnect(), 800);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [requestedSection]);

  return (
    <div className="flex h-full flex-col animate-fade-in">
      {/* Section nav: stays put while the content below scrolls, highlights
        * whichever section is in view, and jumps straight to a section on
        * click instead of leaving the user to scroll from the top. */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-8 py-2">
        {SECTIONS.map((id) => (
          <button
            key={id}
            onClick={() => jumpTo(id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              activeSection === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {t(`settings.section.${id}`)}
          </button>
        ))}
      </div>
      {/* Content */}
      {/* `relative` makes this the sections' offsetParent, so their offsetTop
        * is measured from the scroll container itself — not from an ancestor
        * that also includes the nav bar's height, which made every
        * programmatic jump overshoot by that amount. */}
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        {/* data-no-selection opts the whole settings page out of the global SelectionAsk
            toolbar (Add word / Translate / Look up) — labels, model names and example text
            here aren't reading material to look words up from. */}
        <div className="max-w-full px-8 py-6 space-y-10" data-no-selection>
          <section ref={(el) => { sectionRefs.current.general = el; }} data-section="general" className="scroll-mt-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{t("settings.general")}</p>
            <GeneralSection />
          </section>

          <section ref={(el) => { sectionRefs.current.providers = el; }} data-section="providers" className="scroll-mt-6">
            <ProviderSection />
          </section>

          <section ref={(el) => { sectionRefs.current.learning = el; }} data-section="learning" className="scroll-mt-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{t("settings.section.learning")}</p>
            <LearningSection />
          </section>

          <section ref={(el) => { sectionRefs.current.tts = el; }} data-section="tts" className="scroll-mt-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{t("settings.section.tts")}</p>
            <TtsSection />
          </section>

          <section ref={(el) => { sectionRefs.current.mcp = el; }} data-section="mcp" className="scroll-mt-6">
            <McpSection />
          </section>

          <section ref={(el) => { sectionRefs.current.data = el; }} data-section="data" className="scroll-mt-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{t("settings.section.data")}</p>
            <DataSection db={db} t={t} />
          </section>
        </div>
      </div>
    </div>
  );
}
