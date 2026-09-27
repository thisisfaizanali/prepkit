"use client";

import { cardsForDay, CONFIDENCE_LABELS, orderSession, todayDay, type Confidence, type Flashcard, type KitView, type PracticeProgress } from "@prepkit/shared";
import { useEffect, useRef, useState } from "react";
import { useBuilder } from "@/components/builder/BuilderContext";
import { PriorityMarker } from "@/components/kit/PriorityMarker";
import { plural } from "@/lib/format";
import { useRatePractice } from "@/lib/queries";

const LEVELS = [1, 2, 3] as const;
const SIZES = [10, 20, 0] as const; // 0 = all
type Rated = { id: string; confidence: Confidence };

/** `day`: a schedule day to filter to (from the Schedule tab's link); otherwise the filter offers today. */
export function PracticeSection({ day }: { day?: number }) {
  const { doc, kit } = useBuilder();
  const rate = useRatePractice(doc.id);
  const practice = doc.practice ?? {};
  const [session, setSession] = useState<string[] | null>(null);
  const [rated, setRated] = useState<Rated[] | null>(null);

  if (session)
    return (
      <Session
        cards={session.map((id) => kit.flashcards.find((c) => c.id === id)).filter((c): c is Flashcard => !!c)}
        onRate={rate}
        onEnd={(r) => {
          setSession(null);
          setRated(r.length ? r : null);
        }}
      />
    );
  return (
    <div className="max-w-[760px]">
      <h2 className="text-h2">Practice</h2>
      {rated && <Summary rated={rated} kit={kit} practice={practice} />}
      <Start kit={kit} practice={practice} doneDays={doc.schedule_progress ?? {}} day={day} onStart={(ids) => (setRated(null), setSession(ids))} />
      <CoverageOverview kit={kit} practice={practice} />
    </div>
  );
}

function counts(cards: Flashcard[], practice: PracticeProgress) {
  const c = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const card of cards) c[practice[card.id]?.confidence ?? 0]++;
  return c;
}

function Start({ kit, practice, doneDays, day, onStart }: { kit: KitView; practice: PracticeProgress; doneDays: Record<string, string>; day?: number; onStart: (ids: string[]) => void }) {
  const filterDay = day ?? todayDay(kit.schedule.days, doneDays);
  const [size, setSize] = useState<number>(10);
  const [onlyDay, setOnlyDay] = useState(day !== undefined);
  const scheduleDay = kit.schedule.days.find((d) => d.day === filterDay);
  const pool = onlyDay && scheduleDay ? cardsForDay(scheduleDay, kit.questions, kit.flashcards) : kit.flashcards;
  const c = counts(pool, practice);
  const start = () => {
    const ids = orderSession(pool, practice, kit.role.requirements, new Date());
    onStart(size ? ids.slice(0, size) : ids);
  };

  if (kit.flashcards.length === 0) return <p className="mt-4 text-pencil">This kit has no flashcards to practise yet.</p>;
  return (
    <section aria-label="Start a session" className="mt-4">
      <p>
        {plural(pool.length, "card")}: {c[0]} new, {c[1]} not yet, {c[2]} shaky, {c[3]} got it.
      </p>
      <fieldset className="mt-4">
        <legend className="text-sm font-semibold">Session size</legend>
        <div className="mt-1 flex flex-wrap gap-4">
          {SIZES.map((s) => (
            <label key={s} className="flex items-center gap-2 py-1">
              <input type="radio" name="size" checked={size === s} onChange={() => setSize(s)} />
              {s ? `${s} cards` : "All"}
            </label>
          ))}
        </div>
      </fieldset>
      {scheduleDay && (
        <label className="mt-3 flex items-center gap-2 py-1">
          <input type="checkbox" checked={onlyDay} onChange={(e) => setOnlyDay(e.target.checked)} />
          Only {day === undefined ? "today's" : `day ${filterDay}'s`} schedule (day {filterDay}: {scheduleDay.focus})
        </label>
      )}
      <button type="button" className="btn mt-4" disabled={pool.length === 0} onClick={start}>
        Start practice
      </button>
      {pool.length === 0 && <p className="mt-2 text-sm text-pencil">No flashcards are linked to this day's requirements.</p>}
    </section>
  );
}

function Session({ cards, onRate, onEnd }: { cards: Flashcard[]; onRate: (id: string, c: Confidence) => void; onEnd: (rated: Rated[]) => void }) {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [rated, setRated] = useState<Rated[]>([]);
  const showRef = useRef<HTMLButtonElement>(null);
  const firstRating = useRef<HTMLButtonElement>(null);
  const card = cards[i];

  useEffect(() => (shown ? firstRating : showRef).current?.focus(), [i, shown]);

  const reveal = () => setShown(true);
  const give = (confidence: Confidence) => {
    onRate(card.id, confidence);
    const next = [...rated, { id: card.id, confidence }];
    if (i + 1 >= cards.length) return onEnd(next);
    setRated(next);
    setI(i + 1);
    setShown(false);
  };

  // Latest handlers for the one window listener.
  const keys = useRef({ reveal, give, end: () => onEnd(rated), shown });
  keys.current = { reveal, give, end: () => onEnd(rated), shown };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = keys.current;
      if (e.key === "Escape") return k.end();
      if (e.key === " " && !k.shown && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        return k.reveal();
      }
      if (k.shown && ["1", "2", "3"].includes(e.key)) {
        e.preventDefault();
        k.give(Number(e.key) as Confidence);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!card) return null;
  return (
    <section aria-label="Practice session" className="max-w-[640px]">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-pencil">
          {i + 1} of {cards.length}
        </p>
        <button type="button" className="text-sm text-pencil underline" onClick={() => onEnd(rated)}>
          End session <span className="hidden sm:inline">(Esc)</span>
        </button>
      </div>
      <div aria-hidden className="mt-1 h-1 bg-line">
        <div className="h-1 bg-graphite" style={{ width: `${(i / cards.length) * 100}%` }} />
      </div>

      <div className="mt-6 rounded-sm bg-sheet p-5 shadow-[0_2px_10px_rgb(0_0_0/0.08)] sm:p-8">
        <p className="text-lg font-semibold whitespace-pre-line">{card.front}</p>
        <div aria-live="polite">
          {shown && (
            <>
              <hr className="my-5 border-t-2 border-highlight" />
              <p className="whitespace-pre-line">{card.back}</p>
            </>
          )}
        </div>
      </div>

      {shown ? (
        <div role="group" aria-label="How well did you know it?" className="mt-6 grid grid-cols-3 gap-2">
          {LEVELS.map((l) => (
            <button key={l} ref={l === 1 ? firstRating : undefined} type="button" className="btn btn-quiet justify-center py-3" onClick={() => give(l)}>
              {CONFIDENCE_LABELS[l]} <span className="hidden text-sm font-normal text-pencil sm:inline">{l}</span>
            </button>
          ))}
        </div>
      ) : (
        <button ref={showRef} type="button" className="btn mt-6 w-full justify-center py-3 sm:w-auto" onClick={reveal}>
          Show answer <span className="hidden text-sm font-normal sm:inline">(Space)</span>
        </button>
      )}
    </section>
  );
}

function Summary({ rated, kit, practice }: { rated: Rated[]; kit: KitView; practice: PracticeProgress }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const by = (c: Confidence) => rated.filter((r) => r.confidence === c).length;
  const fresh = kit.flashcards.filter((c) => !practice[c.id]).length;
  const notYet = kit.flashcards.filter((c) => practice[c.id]?.confidence === 1).length; // all saved ratings, not just this session
  return (
    <div ref={ref} tabIndex={-1} className="notice mt-4">
      <h3 className="text-h3">Session done: {plural(rated.length, "card")}</h3>
      <p className="mt-1">
        {LEVELS.map((l) => `${by(l)} ${CONFIDENCE_LABELS[l].toLowerCase()}`).join(", ")}.
      </p>
      <p className="mt-1">
        {fresh > 0
          ? `Next session starts with the ${plural(fresh, "card")} you haven't seen yet${notYet ? `, then the ${notYet} you marked Not yet` : ""}.`
          : notYet
            ? `Next session starts with the ${plural(notYet, "card")} you marked Not yet.`
            : "Nothing marked Not yet. Next session starts with your shakiest cards."}
      </p>
    </div>
  );
}

function CoverageOverview({ kit, practice }: { kit: KitView; practice: PracticeProgress }) {
  const reqs = [...kit.role.requirements].sort((a, b) => (a.priority === "must" ? 0 : 1) - (b.priority === "must" ? 0 : 1));
  if (reqs.length === 0) return null;
  return (
    <section aria-labelledby="practice-coverage" className="mt-10">
      <h3 id="practice-coverage" className="text-h3">
        Coverage by requirement
      </h3>
      <ul className="mt-3 border-t border-line">
        {reqs.map((r) => {
          const cards = kit.flashcards.filter((c) => c.requirement_ids.includes(r.id));
          const seen = cards.map((c) => practice[c.id]?.confidence).filter((c): c is Confidence => !!c);
          const weakest = seen.length ? (Math.min(...seen) as Confidence) : null;
          return (
            <li key={r.id} className="flex flex-col gap-1 border-b border-line py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <span>
                {r.text} {r.priority === "must" && <PriorityMarker priority="must" />}
              </span>
              <span className="shrink-0 text-sm text-pencil">
                {cards.length === 0
                  ? "No flashcards"
                  : weakest
                    ? `${seen.length} of ${cards.length} practised, weakest: ${CONFIDENCE_LABELS[weakest]}`
                    : "Not practised yet"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
