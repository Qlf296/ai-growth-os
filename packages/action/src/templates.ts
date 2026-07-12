/**
 * Draft prompt templates as data (STEP 5.2). Registered into the AI Gateway's
 * PromptTemplateRegistry (immutable published versions, ADR-044). No prompt
 * strings live in business logic; rendering is deterministic. Workspace
 * overrides flow through the Config Registry (a workspace may pin an alternate
 * template version); default is the latest registered version.
 */
import { PromptTemplateRegistry } from "@aigos/ai-gateway";

export type DraftType =
  | "seo_title"
  | "meta_description"
  | "blog_outline"
  | "article_draft"
  | "social_post"
  | "technical_fix_summary"
  | "executive_summary"
  | "action_checklist";

export const DRAFT_TYPES: readonly DraftType[] = [
  "seo_title", "meta_description", "blog_outline", "article_draft",
  "social_post", "technical_fix_summary", "executive_summary", "action_checklist",
];

export const templateIdFor = (type: DraftType): string => `draft.${type}`;

const line = (label: string, value: unknown): string => `${label}: ${String(value ?? "")}`;

/** Deterministic renderers — pure functions of the params. */
const RENDERERS: Record<DraftType, (p: Record<string, unknown>) => string> = {
  seo_title: (p) => `Write one concise, click-worthy SEO title (max 60 chars) for the page ${p.entity}. Primary intent: ${p.summary}. Do not invent facts.`,
  meta_description: (p) => `Write one meta description (max 155 chars) for ${p.entity} reflecting: ${p.summary}. Base it only on: ${p.technicalReason}.`,
  blog_outline: (p) => `Produce a blog outline (H2/H3 only) for the topic behind ${p.entity}. Business goal: ${p.businessReason}.`,
  article_draft: (p) => `Draft an article addressing ${p.entity}. Context: ${p.summary}. Ground every claim in the provided evidence; do not fabricate.`,
  social_post: (p) => `Write one short social post about the improvement for ${p.entity}. Tone: professional. Basis: ${p.summary}.`,
  technical_fix_summary: (p) => `Summarize the technical fix for ${p.entity} in 3 steps. Steps: ${JSON.stringify(p.steps)}. Reason: ${p.technicalReason}.`,
  executive_summary: (p) => `Write a 2-sentence executive summary of the opportunity on ${p.entity}. Impact: ${p.expectedImpact}.`,
  action_checklist: (p) => `Turn these steps into a numbered action checklist for ${p.entity}: ${JSON.stringify(p.steps)}.`,
};

/** Register all draft templates (version 1) into a gateway template registry. */
export function registerDraftTemplates(registry: PromptTemplateRegistry): void {
  for (const type of DRAFT_TYPES) {
    registry.register({ id: templateIdFor(type), version: 1, render: (p) => `${RENDERERS[type](p)}\n${line("draft_type", type)}` });
  }
}
