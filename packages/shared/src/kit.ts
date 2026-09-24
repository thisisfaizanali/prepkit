import { z } from "zod";

export const REQUIREMENT_KINDS = ["technical", "behavioural", "domain"] as const;
export const PRIORITIES = ["must", "nice"] as const;
export const QUESTION_CATEGORIES = ["technical", "behavioural", "system-design", "company-fit"] as const;
export const META_ORIGINS = ["generated", "user"] as const;

const int = (min: number) => z.number().int().min(min);

// Optional extension: provenance/edit state for user-editable items.
export const MetaSchema = z.object({
  origin: z.enum(META_ORIGINS),
  edited: z.boolean(),
  pinned: z.boolean(),
});

export const SourceSchema = z.object({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: int(0),
  researched_at: z.iso.datetime({ offset: true }),
  pages_used: z.array(z.string()),
});

export const CompanyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
  meta: MetaSchema.optional(),
});

export const RequirementSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(PRIORITIES),
});

export const RoleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(RequirementSchema),
});

export const QuestionSchema = z.object({
  id: z.string(),
  requirement_ids: z.array(z.string()),
  category: z.enum(QUESTION_CATEGORIES),
  prompt: z.string(),
  answer_outline: z.string(),
  difficulty: int(1).max(3),
  meta: MetaSchema.optional(),
});

export const FlashcardSchema = z.object({
  id: z.string(),
  front: z.string(),
  back: z.string(),
  requirement_ids: z.array(z.string()),
  meta: MetaSchema.optional(),
});

export const ScheduleDaySchema = z.object({
  day: int(1),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: int(0),
});

export const ScheduleSchema = z.object({
  days_available: int(1),
  days: z.array(ScheduleDaySchema),
});

export const CoverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  passes: int(0),
});

export const KitSchema = z.object({
  source: SourceSchema,
  company_brief: CompanyBriefSchema,
  role: RoleSchema,
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: ScheduleSchema,
  coverage: CoverageSchema,
  warnings: z.array(z.string()).optional(),
});

export type Meta = z.infer<typeof MetaSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type CompanyBrief = z.infer<typeof CompanyBriefSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Flashcard = z.infer<typeof FlashcardSchema>;
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type Kit = z.infer<typeof KitSchema>;
