/** STEP 5.2 — prompt templates as data: immutable versions, deterministic render. */
import { describe, expect, it } from "vitest";

import { PromptTemplateRegistry } from "@aigos/ai-gateway";

import { DRAFT_TYPES, registerDraftTemplates, templateIdFor } from "../src/index.js";

describe("draft prompt templates", () => {
  it("registers all 8 draft types at version 1", () => {
    const reg = new PromptTemplateRegistry();
    registerDraftTemplates(reg);
    for (const type of DRAFT_TYPES) expect(reg.resolve(templateIdFor(type)).version).toBe(1);
    expect(DRAFT_TYPES).toHaveLength(8);
  });

  it("published versions are immutable — re-registering the same id+version throws", () => {
    const reg = new PromptTemplateRegistry();
    registerDraftTemplates(reg);
    expect(() => reg.register({ id: "draft.seo_title", version: 1, render: () => "x" })).toThrow(/immutable|already/i);
  });

  it("rendering is deterministic for the same params", () => {
    const reg = new PromptTemplateRegistry();
    registerDraftTemplates(reg);
    const t = reg.resolve("draft.seo_title");
    const p = { entity: "https://forgcv.com/cv", summary: "improve" };
    expect(t.render(p)).toBe(t.render(p));
    expect(t.render(p)).toContain("https://forgcv.com/cv");
  });
});
