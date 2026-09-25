import { BatchCaseSchema, BatchOutputSchema, type BatchCase, type BatchOutput, type BatchResult, type Kit } from "@prepkit/shared";
import { PipelineError } from "./runPipeline.ts";

export type CaseRunner = (c: BatchCase) => Promise<Kit>;

/**
 * Runs every case through `runCase` with a small concurrency pool. A case never fails the batch: invalid input,
 * PipelineErrors and unexpected throws all become { status: "failed" } entries. `onUpdate` gets the full,
 * schema-valid output (completed cases, in input order) after every case.
 */
export async function runBatch(
  cases: unknown[],
  runCase: CaseRunner,
  { concurrency = 2, onUpdate }: { concurrency?: number; onUpdate?: (output: BatchOutput, done: BatchResult) => void | Promise<void> } = {},
): Promise<BatchOutput> {
  const results: (BatchResult | undefined)[] = new Array(cases.length);
  const output = (): BatchOutput => {
    const out: BatchOutput = { version: "1.0", generated_at: new Date().toISOString(), kits: results.filter((r): r is BatchResult => !!r) };
    BatchOutputSchema.parse(out); // validate only: parsing strips unknown keys, and the kit extensions must survive
    return out;
  };

  const runOne = async (raw: unknown, i: number): Promise<BatchResult> => {
    const id = typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id : `case-${i + 1}`;
    const c = BatchCaseSchema.safeParse(raw);
    if (!c.success) {
      const message = c.error.issues.map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`).join("; ");
      return { id, status: "failed", kit: null, error: { code: "INVALID_INPUT", message } };
    }
    try {
      return { id, status: "ok", kit: await runCase(c.data), error: null };
    } catch (e) {
      const code = e instanceof PipelineError ? e.code : "INTERNAL";
      return { id, status: "failed", kit: null, error: { code, message: e instanceof Error ? e.message : String(e) } };
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const i = next++;
      results[i] = await runOne(cases[i], i);
      await onUpdate?.(output(), results[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, cases.length)) }, worker));
  return output();
}
