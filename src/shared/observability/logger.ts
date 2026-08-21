/**
 * SecureLogger - implementation-blueprint.md #14.1: "Todos os handlers usam SecureLogger.
 * Chamadas diretas a console.* falham no lint" (enforced by .eslintrc.cjs no-console rule,
 * scoped-out only for this file). Structured JSON to stdout (CloudWatch Logs picks it up),
 * every field passed through the central Redactor first.
 *
 * tenantId may appear in structured logs for investigation (per #14.1) but must never become
 * an EMF metric dimension. NOTE (full-audit round1/qualidade, 2026-08-19): no
 * shared/observability/metrics.ts exists yet - this constraint is aspirational until that
 * module is built (tracked as a real gap under Observability & Operability, not this logger's
 * job to enforce). Do not treat this comment as evidence metrics.ts exists.
 */
import { getContext } from "./context.js";
import { defaultRedactor, Redactor } from "./redactor.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  correlationId?: string;
  tenantId?: string;
  requestId?: string;
  [key: string]: unknown;
}

export interface SecureLoggerOptions {
  redactor?: Redactor;
  /** Base context merged into every log line (e.g. service name, function name). */
  baseContext?: LogContext;
  /** Injectable sink for tests; defaults to console. */
  sink?: (level: LogLevel, line: string) => void;
  now?: () => string;
}

const defaultSink = (level: LogLevel, line: string): void => {
  // eslint-disable-next-line no-console -- this IS the sink; central logger is the sanctioned exception.
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(line);
};

export class SecureLogger {
  private readonly redactor: Redactor;
  private readonly baseContext: LogContext;
  private readonly sink: (level: LogLevel, line: string) => void;
  private readonly now: () => string;

  constructor(options: SecureLoggerOptions = {}) {
    this.redactor = options.redactor ?? defaultRedactor;
    this.baseContext = options.baseContext ?? {};
    this.sink = options.sink ?? defaultSink;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Returns a new logger with additional persistent context (e.g. bind correlationId once per invocation). */
  child(context: LogContext): SecureLogger {
    return new SecureLogger({
      redactor: this.redactor,
      baseContext: { ...this.baseContext, ...context },
      sink: this.sink,
      now: this.now,
    });
  }

  debug(event: string, context: LogContext = {}): void {
    this.write("debug", event, context);
  }

  info(event: string, context: LogContext = {}): void {
    this.write("info", event, context);
  }

  warn(event: string, context: LogContext = {}): void {
    this.write("warn", event, context);
  }

  error(event: string, context: LogContext = {}): void {
    this.write("error", event, context);
  }

  private write(level: LogLevel, event: string, context: LogContext): void {
    const merged = { ...getContext(), ...this.baseContext, ...context };
    const redacted = this.redactor.redact(merged) as Record<string, unknown>;
    const line = JSON.stringify({
      timestamp: this.now(),
      level,
      event,
      ...redacted,
    });
    this.sink(level, line);
  }
}

export const logger = new SecureLogger();
