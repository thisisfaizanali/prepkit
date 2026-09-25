"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type TabDef = { id: string; label: string };

/** Binder tabs: a left rail on wide screens, a scrollable row on small ones. Arrow keys, Home and End move focus. */
export function KitTabs({ tabs, active, onChange, children }: { tabs: TabDef[]; active: string; onChange: (id: string) => void; children: ReactNode }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const delta = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    let next = delta === undefined ? -1 : (i + delta + tabs.length) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div className="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
      <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
        <div role="tablist" aria-label="Kit sections" className="flex border-b border-line lg:sticky lg:top-6 lg:flex-col lg:border-b-0">
          {tabs.map((t, i) => {
            const selected = t.id === active;
            return (
              <button
                key={t.id} ref={(el) => void (refs.current[i] = el)} type="button" role="tab" id={`tab-${t.id}`}
                aria-selected={selected} aria-controls={`panel-${t.id}`} tabIndex={selected ? 0 : -1}
                onClick={() => onChange(t.id)} onKeyDown={(e) => onKeyDown(e, i)}
                className={`shrink-0 whitespace-nowrap px-3 py-2 text-left hover:bg-wash lg:border-b-0 lg:border-l-4 ${
                  selected ? "border-b-4 border-graphite font-semibold lg:border-graphite" : "border-b-4 border-transparent text-pencil lg:border-line"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`} tabIndex={0} className="mt-8 min-w-0 lg:mt-0">
        {children}
      </div>
    </div>
  );
}
