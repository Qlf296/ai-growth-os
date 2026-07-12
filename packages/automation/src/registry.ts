/**
 * Action registry (STEP 7.1). Actions are named data; handlers are registered
 * code. Every action declares whether it publishes — a publishing action is
 * refused at registration (Law 5 / ADR-048 A3 forbidden).
 */
export interface ActionContext {
  readonly workspaceId: string;
  readonly fact: Record<string, unknown>;
}

export interface ActionResult {
  readonly ok: boolean;
  readonly detail: Record<string, unknown>;
}

export interface ActionHandler {
  readonly name: string;
  /** Must be false — no automation may publish (Law 5). */
  readonly publishes: false;
  run(ctx: ActionContext): Promise<ActionResult>;
}

export class ActionRegistry {
  private readonly actions = new Map<string, ActionHandler>();

  register(handler: ActionHandler): void {
    // Structural guard: publishing automations are constitutionally forbidden.
    if ((handler as { publishes: boolean }).publishes !== false) {
      throw new Error(`action "${handler.name}" declares publishing — forbidden (Law 5 / ADR-048)`);
    }
    if (this.actions.has(handler.name)) throw new Error(`action "${handler.name}" already registered`);
    this.actions.set(handler.name, handler);
  }

  resolve(name: string): ActionHandler {
    const a = this.actions.get(name);
    if (!a) throw new Error(`no action registered: ${name}`);
    return a;
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }
}
