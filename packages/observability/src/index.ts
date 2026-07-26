const SECRET_KEY = /(?:password|secret|token|api[_-]?key|authorization|cookie|private[_-]?key)/i;
const SECRET_VALUE = /(?:sk-[\w-]{12,}|Bearer\s+\S+|-----BEGIN[\s\S]*?KEY-----)/gi;

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[REDACTED]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key, SECRET_KEY.test(key) ? '[REDACTED]' : redact(item),
    ]));
  }
  return value;
}

export interface LogEntry { timestamp: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string; fields?: Record<string, unknown>; }
export interface Logger { debug(message: string, fields?: Record<string, unknown>): void; info(message: string, fields?: Record<string, unknown>): void; warn(message: string, fields?: Record<string, unknown>): void; error(message: string, fields?: Record<string, unknown>): void; child(fields: Record<string, unknown>): Logger; }

export function createLogger(base: Record<string, unknown> = {}, write: (entry: LogEntry) => void = (entry) => console.log(JSON.stringify(entry))): Logger {
  const emit = (level: LogEntry['level'], message: string, fields?: Record<string, unknown>) => write(redact({ timestamp: new Date().toISOString(), level, message, ...base, ...fields }) as LogEntry);
  return { debug: (m, f) => emit('debug', m, f), info: (m, f) => emit('info', m, f), warn: (m, f) => emit('warn', m, f), error: (m, f) => emit('error', m, f), child: (fields) => createLogger({ ...base, ...fields }, write) };
}
