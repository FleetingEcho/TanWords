import React, { useEffect, useRef } from "react";
import { useT } from "@/hooks/useT";
import { useDB } from "@/hooks/useDB";
import { ProviderSection } from "./ProviderSection";
import { TtsSection } from "./TtsSection";
import { GeneralSection } from "./GeneralSection";
import { LearningSection } from "./LearningSection";
import { McpSection } from "./McpSection";
import { DataSection } from "./DataSection";
import { AiUsageCard } from "./AiUsageCard";

export { SettingRow } from "./SettingsShared";

const SECTIONS = ["general", "providers", "learning", "tts", "mcp", "data"] as const;
type SectionId = (typeof SECTIONS)[number];

export function SettingsPage() {
  const t = useT();
  const db = useDB();

  const sectionRefs = useRef<Record<SectionId, HTMLElement | null>>({
    general: null, providers: null, learning: null, tts: null, mcp: null, data: null,
  });

  // Scrollspy: highlight the nav item for whichever section is in view
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
      },
      { rootMargin: "-10% 0px -70% 0px" }
    );
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-full animate-fade-in">
      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-full px-8 py-6 space-y-10">
          <section ref={(el) => { sectionRefs.current.general = el; }} data-section="general" className="scroll-mt-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{t("settings.general")}</p>
            <GeneralSection />
          </section>

          <section ref={(el) => { sectionRefs.current.providers = el; }} data-section="providers" className="scroll-mt-6 space-y-6">
            <ProviderSection />
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">{t("settings.usage")}</p>
              <AiUsageCard />
            </div>
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
