import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  correlationId?: string;
  fields?: Record<string, unknown>;
}

export class StructuredLogger {
  public constructor(private readonly service: string, private readonly sink: (line: string) => void = console.log) {}

  public log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
    const record: LogRecord = {
      timestamp: new Date().toISOString(), level, service: this.service, message,
      ...(typeof fields.correlationId === 'string' ? { correlationId: fields.correlationId } : {}),
      ...(Object.keys(fields).length > 0 ? { fields: redact(fields) as Record<string, unknown> } : {})
    };
    this.sink(JSON.stringify(record));
  }

  public debug(message: string, fields?: Record<string, unknown>): void { this.log('debug', message, fields); }
  public info(message: string, fields?: Record<string, unknown>): void { this.log('info', message, fields); }
  public warn(message: string, fields?: Record<string, unknown>): void { this.log('warn', message, fields); }
  public error(message: string, fields?: Record<string, unknown>): void { this.log('error', message, fields); }
}

const sensitive = /(secret|password|authorization|cookie|token|api.?key|credential|ciphertext)/iu;

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CYCLE]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key, sensitive.test(key) ? '[REDACTED]' : redact(item, seen)
  ]));
}

export function correlationId(value?: string): string {
  return value && /^[0-9a-f-]{36}$/iu.test(value) ? value : randomUUID();
}

export class MetricsRegistry {
  readonly #counters = new Map<string, number>();
  readonly #gauges = new Map<string, number>();

  public increment(name: string, labels: Record<string, string> = {}, value = 1): void {
    const key = metricKey(name, labels);
    this.#counters.set(key, (this.#counters.get(key) ?? 0) + value);
  }

  public gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    this.#gauges.set(metricKey(name, labels), value);
  }

  public prometheus(): string {
    const lines: string[] = [];
    for (const [key, value] of [...this.#counters, ...this.#gauges].sort(([a], [b]) => a.localeCompare(b))) lines.push(`${key} ${value}`);
    return `${lines.join('\n')}\n`;
  }
}

function metricKey(name: string, labels: Record<string, string>): string {
  const safe = name.replace(/[^a-zA-Z0-9_:]/gu, '_');
  const pairs = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (pairs.length === 0) return safe;
  return `${safe}{${pairs.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(',')}}`;
}
