const REDACTED = '[REDACTED]';

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const name = normalizedKey(key);
  return /password|passwd|cookie|authorization|secret|token|sessionid|csrftoken/.test(name)
    || ['key', 'code', 'signature', 'credential'].includes(name)
    || /(?:^|)(?:apikey|clientapikey|privatekey|encryptionkey|encryptionskey|signingkey|accesskey|secretkey)/.test(name)
    || (name.includes('api') && name.includes('key'))
    || ((name.includes('encryption') || name.includes('encrypt')) && name.includes('key'));
}

function scrubText(input: string): string {
  let text = input;
  // Handle JSON strings before the broader text patterns so their structure is preserved.
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      text = JSON.stringify(scrubValue(JSON.parse(trimmed)));
    } catch { /* Continue with textual scrubbing for non-JSON strings. */ }
  }
  // Header lines may be embedded in exception text, not only at the start of a line.
  text = text.replace(/\b(authorization|proxy-authorization|set-cookie|cookie)\s*:\s*[^\r\n]*/gi, `$1: ${REDACTED}`);
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);
  // Compact JWT-shaped values, including ones without a Bearer prefix.
  text = text.replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
  // URL credentials (userinfo), including percent-encoded forms.
  text = text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`);
  // Query and form-style parameters. Preserve separators and key names.
  text = text.replace(/([?&#;\s"'])([^=?&#;\s"']+)=([^&#;\s"']*)/g, (whole, sep: string, key: string, value: string) =>
    isSensitiveKey(decodeKey(key)) ? `${sep}${key}=${REDACTED}` : whole);
  // Common header and key/value representations outside a parseable JSON document.
  text = text.replace(/((?:authorization|proxy-authorization)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;"']+/gi, `$1${REDACTED}`);
  text = text.replace(/(^|[\r\n])([A-Za-z0-9_.-]+)\s*:\s*([^\r\n]*)/g,
    (whole, lineStart: string, key: string, value: string) => isSensitiveKey(key) ? `${lineStart}${key}: ${REDACTED}` : whole);
  text = text.replace(/(["']?([A-Za-z0-9_.-]+)["']?\s*:\s*["'])([^"']*)(["'])/g,
    (whole, start: string, key: string, _value: string, end: string) => isSensitiveKey(key) ? `${start}${REDACTED}${end}` : whole);
  text = text.replace(/\b(password|passwd|cookie|authorization|proxy-authorization|access_token|refresh_token|api[_-]?key|client[_-]?secret|encryption[_-]?key|secret)\s*=\s*([^\s,;"']+)/gi, `$1=${REDACTED}`);
  // Fail closed on unquoted credentials with spaces; the diagnostic suffix is less important.
  text = text.replace(/\b(password|passwd|secret|authorization)\s*=\s*[^\r\n]*/gi, `$1=${REDACTED}`);
  return text;
}

function decodeKey(key: string): string {
  try { return decodeURIComponent(key.replace(/\+/g, ' ')); } catch { return key; }
}

/** Returns a non-mutating, recursively scrubbed copy suitable for logs and diagnostics. */
export function scrubSensitiveData<T>(input: T): T {
  return scrubValue(input, new WeakMap<object, unknown>()) as T;
}

function scrubValue(value: unknown, seen: WeakMap<object, unknown> = new WeakMap()): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof URL) return scrubText(value.toString());
  if (seen.has(value)) return '[Circular]';
  if (value instanceof Error) {
    const result: Record<string, unknown> = {};
    seen.set(value, result);
    for (const key of ['name', 'message', 'stack', 'cause'] as const) {
      try {
        const item = value[key];
        if (item !== undefined) result[key] = scrubValue(item, seen);
      } catch { result[key] = '[Unavailable]'; }
    }
    for (const key of Object.keys(value)) {
      if (key in result) continue;
      try { result[key] = isSensitiveKey(key) ? REDACTED : scrubValue((value as any)[key], seen); }
      catch { result[key] = '[Unavailable]'; }
    }
    return result;
  }
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    for (const item of value) result.push(scrubValue(item, seen));
    return result;
  }
  const result: Record<string, unknown> = {};
  seen.set(value, result);
  for (const key of Object.keys(value)) {
    try { result[key] = isSensitiveKey(key) ? REDACTED : scrubValue((value as Record<string, unknown>)[key], seen); }
    catch { result[key] = '[Unavailable]'; }
  }
  return result;
}

let consoleRedactionInstalled = false;

/** Idempotently protects direct console calls; invoke explicitly at process bootstrap. */
export function installConsoleRedaction(): void {
  if (consoleRedactionInstalled) return;
  consoleRedactionInstalled = true;
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[method].bind(console);
    console[method] = ((...args: unknown[]) => {
      // printf-style console('password=%s', secret) must not separate key from value.
      if (typeof args[0] === 'string' && args.length > 1
        && /password|passwd|cookie|authorization|secret|token|api.?key/i.test(args[0])) {
        original(scrubSensitiveData(args[0]), ...args.slice(1).map(() => REDACTED));
      } else original(...args.map((arg) => scrubSensitiveData(arg)));
    }) as typeof console[typeof method];
  }
}