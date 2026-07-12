/** Versioned prompt templates — data, not ad-hoc strings (ADR-044). Versions are immutable. */

export interface PromptTemplate {
  readonly id: string;
  readonly version: number;
  render(params: Record<string, unknown>): string;
}

export class PromptTemplateRegistry {
  private readonly byId = new Map<string, PromptTemplate[]>();

  register(template: PromptTemplate): void {
    const versions = this.byId.get(template.id) ?? [];
    if (versions.some((t) => t.version === template.version)) {
      throw new Error(
        `Template ${template.id}@${template.version} already registered — versions are immutable; register a new version (ADR-044)`,
      );
    }
    versions.push(template);
    versions.sort((a, b) => a.version - b.version);
    this.byId.set(template.id, versions);
  }

  /** Latest version — the gateway records which one was used. */
  resolve(id: string): PromptTemplate {
    const versions = this.byId.get(id);
    const latest = versions?.[versions.length - 1];
    if (!latest) throw new Error(`Prompt template "${id}" is not registered`);
    return latest;
  }
}
