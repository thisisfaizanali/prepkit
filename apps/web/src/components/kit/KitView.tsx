"use client";

import type { KitResponse, KitView as Kit } from "@prepkit/shared";
import { useEffect, useRef, useState } from "react";
import { BriefSection } from "@/components/kit/BriefSection";
import { FlashcardsSection } from "@/components/kit/FlashcardsSection";
import { KitTabs, type TabDef } from "@/components/kit/KitTabs";
import { PracticeSection } from "@/components/kit/PracticeSection";
import { QuestionsSection } from "@/components/kit/QuestionsSection";
import { RoleSection } from "@/components/kit/RoleSection";
import { ScheduleSection } from "@/components/kit/ScheduleSection";
import { SourcesSection } from "@/components/kit/SourcesSection";
import { plural } from "@/lib/format";
import { BuilderProvider, useBuilder } from "@/components/builder/BuilderContext";
import { ToastProvider } from "@/components/builder/Toasts";
import { RegenerationProvider } from "@/components/builder/Regeneration";
import { SaveStatus } from "@/components/builder/SaveStatus";

const TABS: TabDef[] = [
  { id: "brief", label: "Brief" },
  { id: "role", label: "Role" },
  { id: "questions", label: "Questions" },
  { id: "flashcards", label: "Flashcards" },
  { id: "schedule", label: "Schedule" },
  { id: "practice", label: "Practice" },
  { id: "sources", label: "Sources" },
];

function Section({ tab, kit, jd, day }: { tab: string; kit: Kit; jd: string; day?: number }) {
  switch (tab) {
    case "role":
      return <RoleSection kit={kit} jd={jd} />;
    case "questions":
      return <QuestionsSection />;
    case "flashcards":
      return <FlashcardsSection />;
    case "schedule":
      return <ScheduleSection kit={kit} />;
    case "practice":
      return <PracticeSection key={day} day={day} />;
    case "sources":
      return <SourcesSection kit={kit} />;
    default:
      return <BriefSection kit={kit} />;
  }
}

export function KitView({ doc }: { doc: KitResponse & { kit: Kit } }) {
  return (
    <ToastProvider>
      <BuilderProvider doc={doc}>
        <RegenerationProvider>
          <Binder />
        </RegenerationProvider>
      </BuilderProvider>
    </ToastProvider>
  );
}

function Binder() {
  const { doc, kit } = useBuilder();
  // The active tab lives in the URL hash, so a section can be linked to and survives a reload.
  // "#practice:3" opens Practice filtered to schedule day 3.
  const [tab, setTab] = useState("brief");
  const [day, setDay] = useState<number>();
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fromHash = () => {
      const [h, d] = location.hash.slice(1).split(":");
      if (!TABS.some((t) => t.id === h)) return;
      setTab(h);
      setDay(h === "practice" && Number(d) > 0 ? Number(d) : undefined);
      // Same as a tab click: bring the section's top back into view.
      const top = tabsRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0) window.scrollTo({ top: window.scrollY + top - 16 });
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const change = (id: string) => {
    setTab(id);
    setDay(undefined);
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <article>
      <header className="max-w-[760px]">
        <h1 className="text-h1">{kit.source.role || kit.role.title}</h1>
        <p className="mt-2 text-pencil">
          {kit.source.company}. Interview in {plural(kit.schedule.days_available, "day")}. {plural(kit.questions.length, "question")},{" "}
          {plural(kit.flashcards.length, "flashcard")}.
        </p>
        <div className="mt-2">
          <SaveStatus />
        </div>
      </header>
      {kit.warnings && kit.warnings.length > 0 && (
        <aside aria-labelledby="warnings-heading" className="notice mt-6 max-w-[760px]">
          <h2 id="warnings-heading" className="text-base font-semibold">
            Worth knowing about this kit
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>{kit.warnings[0]}</li>
            {kit.warnings.slice(1).map((w, i) => (
              <li key={i} className="hidden sm:list-item">{w}</li>
            ))}
          </ul>
          {kit.warnings.length > 1 && (
            // Phones: the rest behind a toggle. Wider screens show them all above.
            <details className="mt-1 sm:hidden">
              <summary className="text-sm font-semibold">Show all notes ({kit.warnings.length})</summary>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {kit.warnings.slice(1).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </aside>
      )}
      <div ref={tabsRef} className="mt-8">
        <KitTabs tabs={TABS} active={tab} onChange={change}>
          <Section tab={tab} kit={kit} jd={doc.input.jd} day={day} />
        </KitTabs>
      </div>
    </article>
  );
}
