/**
 * In-memory ConfigStore — Phase 0 step 2.
 * Replaced/complemented by a Postgres-backed store in step 3 (same contract).
 * Append-only: overrides are stored as an ordered log; the current value of a
 * (key, workspaceId) pair is the last record for that pair. Nothing is deleted.
 */
import type { ConfigChangeRecord, ConfigStore, ReadScope } from "./types.js";

/** RLS-equivalent visibility: global rows always; ws rows only in ws scope. */
const visibleIn = (record: ConfigChangeRecord, scope: ReadScope): boolean =>
  record.workspaceId === null || record.workspaceId === (scope.workspaceId ?? null);

export class InMemoryConfigStore implements ConfigStore {
  private readonly log: ConfigChangeRecord[] = [];

  getOverride(key: string, workspaceId: string | null): Promise<unknown | undefined> {
    for (let i = this.log.length - 1; i >= 0; i--) {
      const record = this.log[i]!;
      if (record.key === key && record.workspaceId === workspaceId) {
        return Promise.resolve(record.value);
      }
    }
    return Promise.resolve(undefined);
  }

  setOverride(record: ConfigChangeRecord): Promise<void> {
    this.log.push(Object.freeze({ ...record }));
    return Promise.resolve();
  }

  history(key: string, scope: ReadScope = {}): Promise<readonly ConfigChangeRecord[]> {
    return Promise.resolve(
      Object.freeze(this.log.filter((r) => r.key === key && visibleIn(r, scope))),
    );
  }

  allOverrides(scope: ReadScope = {}): Promise<readonly ConfigChangeRecord[]> {
    return Promise.resolve(Object.freeze(this.log.filter((r) => visibleIn(r, scope))));
  }
}
