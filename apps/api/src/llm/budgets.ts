/**
 * max_tokens per LLM call. The pacer reserves prompt + max_tokens against the provider's TPM window,
 * so oversized budgets stall later calls even when the real output is small.
 */
export const MAX_TOKENS = {
  extraction: 1500,
  hiringSummary: 1200,
  brief: 800,
  questionBatch: 1800,
  flashcards: 1500,
  repair: 1000,
} as const;
