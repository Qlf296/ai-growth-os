/**
 * Raw-first object store (S2 §3): every provider payload lands here
 * immutably BEFORE normalization. No update, no delete — GDPR purge is a
 * separate audited job (S3 §2), not a store method.
 * Drivers: filesystem (dev/tests) now; S3 driver lands with deployment
 * provisioning (same port, no speculative SDK dependency today).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";

export interface RawRef {
  readonly workspaceId: string;
  readonly provider: string;
  readonly capturedAt: Date;
  readonly id: string;
}

/** Tenant-partitioned key layout: ws/provider/date/id. */
export function rawKey(ref: RawRef): string {
  const date = ref.capturedAt.toISOString().slice(0, 10);
  return `${ref.workspaceId}/${ref.provider}/${date}/${ref.id}`;
}

export interface RawStore {
  /** Write-once. Overwrites are refused — raw payloads are immutable. */
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export class FsRawStore implements RawStore {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    const p = normalize(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error(`invalid key: ${key}`);
    return p;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, bytes, { flag: "wx" }); // wx = fail if exists
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`raw payloads are immutable — key already exists: ${key}`);
      }
      throw error;
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`raw payload not found: ${key}`);
      }
      throw error;
    }
  }
}
