"use client";

import type { KitResponse, KitView as Kit } from "@prepkit/shared";
import { useEffect, useState } from "react";
import { BriefSection } from "@/components/kit/BriefSection";
import { FlashcardsSection } from "@/components/kit/FlashcardsSection";
import { KitTabs, type TabDef } from "@/components/kit/KitTabs";
import { QuestionsSection } from "@/components/kit/QuestionsSection";
import { RoleSection } from "@/components/kit/RoleSection";
import { ScheduleSection } from "@/components/kit/ScheduleSection";
import { SourcesSection } from "@/components/kit/SourcesSection";
import { plural } from "@/lib/format";

const TABS: TabDef[] = [
  { id: "brief", label: "Brief" },
  { id: "role", label: "Role" },
  { id: "questions", label: "Questions" },
  { id: "flashcards", label: "Flashcards" },
  { id: "schedule", label: "Schedule" },
  { id: "sources", label: "Sources" },
];

function Section({ tab, kit, jd }: { tab: string; kit: Kit; jd: string }) {
  switch (tab) {
    case "role":
      return <RoleSection kit={kit} jd={jd} />;
    case "questions":
      return <QuestionsSection kit={kit} />;
    case "flashcards":
      return <FlashcardsSection kit={kit} />;
    case "schedule":
      return <ScheduleSection kit={kit} />;
    case "sources":
      return <SourcesSection kit={kit} />;
    default:
      return <BriefSection kit={kit} />;
  }
}

export function KitView({ doc }: { doc: KitResponse & { kit: Kit } }) {
  const { kit } = doc;
  // The active tab lives in the URL hash, so a section can be linked to and survives a reload.
  const [tab, setTab] = useState("brief");
  useEffect(() => {
    const h = location.hash.slice(1);
    if (TABS.some((t) => t.id === h)) setTab(h);
  }, []);
  const change = (id: string) => {
    setTab(id);
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <article>
      <header className="max-w-[760px]">
        <h1 className="text-h1">{kit.source.role || kit.role.title}</h1>
        <p className="mt-2 text-pencil">
          {kit.source.company}. Interview in {plural(doc.input.days, "day")}. {plural(kit.questions.length, "question")},{" "}
          {plural(kit.flashcards.length, "flashcard")}.
        </p>
      </header>
      {kit.warnings && kit.warnings.length > 0 && (
        <aside aria-labelledby="warnings-heading" className="notice mt-6 max-w-[760px]">
          <h2 id="warnings-heading" className="text-base font-semibold">
            Worth knowing about this kit
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {kit.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </aside>
      )}
      <div className="mt-8">
        <KitTabs tabs={TABS} active={tab} onChange={change}>
          <Section tab={tab} kit={kit} jd={doc.input.jd} />
        </KitTabs>
      </div>
    </article>
  );
}
