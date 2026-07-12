/**
 * Structured JSON logger with mandatory scrubbing (S18; runtime half of AT-8):
 * tokens, emails, magic links and secret-named fields never reach a sink.
 * Sink injectable → error tracking platform plugs in later without touching
 * call sites (no external monitoring integration yet).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  readonly sink?: (line: string) => void;
  readonly context?: Record<string, unknown>;
  readonly clock?: () => Date;
}

const SECRET_FIELD = /(token|secret|password|authorization|cookie|api[_-]?key)/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const LONG_HEX = /\b[a-f0-9]{32,}\b/gi;
const BEARERISH = /\b(ya29\.[\w.-]+|1\/\/[\w.-]+|sk-[\w-]{8,})\b/g;

function scrubString(value: string): string {
  return value.replace(EMAIL, "[REDACTED]").replace(LONG_HEX, "[REDACTED]").replace(BEARERISH, "[REDACTED]");
}

function scrub(value: unknown, key = ""): unknown {
  if (SECRET_FIELD.test(key)) return "[REDACTED]";
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
  }
  return value;
}

export class Logger {
  private readonly sink: (line: string) => void;
  private readonly context: Record<string, unknown>;
  private readonly clock: () => Date;

  constructor(options: LoggerOptions = {}) {
    this.sink = options.sink ?? ((line) => console.log(line));
    this.context = options.context ?? {};
    this.clock = options.clock ?? (() => new Date());
  }

  child(context: Record<string, unknown>): Logger {
    return new Logger({ sink: this.sink, context: { ...this.context, ...context }, clock: this.clock });
  }

  private log(level: LogLevel, msg: string, fields: Record<string, unknown>): void {
    this.sink(
      JSON.stringify({
        level,
        msg: scrubString(msg),
        at: this.clock().toISOString(),
        ...(scrub({ ...this.context, ...fields }) as Record<string, unknown>),
      }),
    );
  }

  debug(msg: string, fields: Record<string, unknown> = {}): void { this.log("debug", msg, fields); }
  info(msg: string, fields: Record<string, unknown> = {}): void { this.log("info", msg, fields); }
  warn(msg: string, fields: Record<string, unknown> = {}): void { this.log("warn", msg, fields); }
  error(msg: string, fields: Record<string, unknown> = {}): void { this.log("error", msg, fields); }
}
