import crypto from 'crypto';

const SENSITIVE_FIELD = /(password|passphrase|cookie|token|secret|authorization|api[-_]?key|encryption[-_]?key)/i;

export class CanonicalPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalPayloadError';
  }
}

function encode(value: unknown, path: string): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalPayloadError(`${path} contains a non-finite number.`);
      return JSON.stringify(value);
    case 'undefined':
      throw new CanonicalPayloadError(`${path} is undefined outside an object field.`);
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new CanonicalPayloadError(`${path} contains a non-JSON value.`);
    case 'object':
      break;
    default:
      throw new CanonicalPayloadError(`${path} cannot be canonicalized.`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, index) => {
      if (item === undefined) throw new CanonicalPayloadError(`${path}[${index}] is undefined.`);
      return encode(item, `${path}[${index}]`);
    }).join(',')}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalPayloadError(`${path} must contain only plain JSON objects.`);
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [key] of entries) {
    if (SENSITIVE_FIELD.test(key)) {
      throw new CanonicalPayloadError(`${path} contains forbidden sensitive field "${key}".`);
    }
  }

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${encode(item, `${path}.${key}`)}`).join(',')}}`;
}

/**
 * Canonical JSON for safe operation identity. Undefined object fields are omitted;
 * undefined array entries and non-JSON values are rejected. Null is preserved.
 */
export function canonicalStringify(payload: unknown): string {
  return encode(payload, '$');
}

export function canonicalRequestHash(payload: unknown): string {
  return crypto.createHash('sha256').update(canonicalStringify(payload)).digest('hex');
}
