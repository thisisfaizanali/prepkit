import { KitSchema, type Kit } from "./kit.ts";

export type ValidateResult = { ok: true; kit: Kit } | { ok: false; errors: string[] };

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of ids) (seen.has(id) ? dups : seen).add(id);
  return [...dups];
}

export function validateKit(input: unknown): ValidateResult {
  const parsed = KitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const kit = parsed.data;
  const errors: string[] = [];

  const reqIds = kit.role.requirements.map((r) => r.id);
  const qIds = kit.questions.map((q) => q.id);
  const fIds = kit.flashcards.map((f) => f.id);
  for (const [label, ids] of [["role.requirements", reqIds], ["questions", qIds], ["flashcards", fIds]] as const) {
    for (const d of duplicates(ids)) errors.push(`${label}: duplicate id "${d}"`);
  }

  const reqSet = new Set(reqIds);
  const qSet = new Set(qIds);
  kit.questions.forEach((q, i) =>
    q.requirement_ids.forEach((r) => {
      if (!reqSet.has(r)) errors.push(`questions[${i}] (id "${q.id}"): unknown requirement id "${r}"`);
    }),
  );
  kit.flashcards.forEach((f, i) =>
    f.requirement_ids.forEach((r) => {
      if (!reqSet.has(r)) errors.push(`flashcards[${i}] (id "${f.id}"): unknown requirement id "${r}"`);
    }),
  );

  const { days, days_available } = kit.schedule;
  if (days.length !== days_available) {
    errors.push(`schedule: days has ${days.length} entries but days_available is ${days_available}`);
  }
  days.forEach((d, i) => {
    if (d.day !== i + 1) errors.push(`schedule.days[${i}]: day is ${d.day}, expected ${i + 1}`);
    d.question_ids.forEach((q) => {
      if (!qSet.has(q)) errors.push(`schedule.days[${i}] (day ${d.day}): unknown question id "${q}"`);
    });
  });

  kit.coverage.uncovered_requirement_ids.forEach((r) => {
    if (!reqSet.has(r)) errors.push(`coverage.uncovered_requirement_ids: unknown requirement id "${r}"`);
  });

  return errors.length ? { ok: false, errors } : { ok: true, kit };
}
