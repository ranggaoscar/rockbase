import {
  IdempotencyRecord,
  IdempotencyStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { canonicalStringify } from '../utils/canonicalRequestHash';

const SCOPE_MAX_LENGTH = 80;
const KEY_MAX_LENGTH = 200;
const REFERENCE_MAX_LENGTH = 120;
const SAFE_JSON_MAX_BYTES = 4096;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ERROR_CATEGORY_PATTERN = /^[A-Z][A-Z0-9_:-]*$/;

export class IdempotencyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyValidationError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export class InvalidIdempotencyTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidIdempotencyTransitionError';
  }
}

export interface BeginOperationInput {
  scope: string;
  key: string;
  requestHash: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
}

export interface BeginOperationResult {
  acquired: boolean;
  operation: IdempotencyRecord;
}

export interface CompletionReference {
  resourceType?: string;
  resourceId?: string;
  resultReference?: Record<string, unknown>;
}

function validateIdentifier(value: string, label: string, maxLength: number): string {
  if (!value || value.length > maxLength || !IDENTIFIER_PATTERN.test(value)) {
    throw new IdempotencyValidationError(
      `${label} must be 1-${maxLength} characters using letters, numbers, dot, underscore, colon, or hyphen.`,
    );
  }
  return value;
}

function validateHash(value: string): string {
  if (!HASH_PATTERN.test(value)) {
    throw new IdempotencyValidationError('requestHash must be a lowercase SHA-256 hex digest.');
  }
  return value;
}

function safeJson(
  value: Record<string, unknown> | undefined,
  label: string,
): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  const canonical = canonicalStringify(value);
  if (Buffer.byteLength(canonical, 'utf8') > SAFE_JSON_MAX_BYTES) {
    throw new IdempotencyValidationError(`${label} exceeds ${SAFE_JSON_MAX_BYTES} bytes.`);
  }
  return JSON.parse(canonical) as Prisma.InputJsonValue;
}

function validateErrorCategory(value: string): string {
  if (!value || value.length > 80 || !ERROR_CATEGORY_PATTERN.test(value)) {
    throw new IdempotencyValidationError(
      'errorCategory must be an uppercase safe category without messages or stack traces.',
    );
  }
  return value;
}

function jsonEqual(left: Prisma.JsonValue | null, right: Prisma.InputJsonValue | undefined): boolean {
  if (left === null && right === undefined) return true;
  if (left === null || right === undefined) return false;
  return canonicalStringify(left) === canonicalStringify(right);
}
export class DurableIdempotencyService {
  constructor(private readonly prisma: PrismaClient) {}

  async beginOperation(input: BeginOperationInput): Promise<BeginOperationResult> {
    const scope = validateIdentifier(input.scope, 'scope', SCOPE_MAX_LENGTH);
    const key = validateIdentifier(input.key, 'key', KEY_MAX_LENGTH);
    const requestHash = validateHash(input.requestHash);
    const metadata = safeJson(input.metadata, 'metadata');

    if (input.expiresAt && (!Number.isFinite(input.expiresAt.getTime()) || input.expiresAt <= new Date())) {
      throw new IdempotencyValidationError('expiresAt must be a valid future date.');
    }

    try {
      const operation = await this.prisma.idempotencyRecord.create({
        data: {
          scope,
          key,
          requestHash,
          ...(metadata === undefined ? {} : { metadata }),
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        },
      });
      return { acquired: true, operation };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
    }

    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (!existing) {
      throw new Error('Idempotency unique conflict occurred but the durable record was not readable.');
    }
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError('Idempotency key already exists for a different request hash.');
    }
    return { acquired: false, operation: existing };
  }

  async getOperation(scopeValue: string, keyValue: string): Promise<IdempotencyRecord | null> {
    const scope = validateIdentifier(scopeValue, 'scope', SCOPE_MAX_LENGTH);
    const key = validateIdentifier(keyValue, 'key', KEY_MAX_LENGTH);
    return this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
  }

  async markCompleted(
    scopeValue: string,
    keyValue: string,
    reference: CompletionReference = {},
  ): Promise<IdempotencyRecord> {
    const scope = validateIdentifier(scopeValue, 'scope', SCOPE_MAX_LENGTH);
    const key = validateIdentifier(keyValue, 'key', KEY_MAX_LENGTH);
    const resourceType = reference.resourceType === undefined
      ? undefined
      : validateIdentifier(reference.resourceType, 'resourceType', REFERENCE_MAX_LENGTH);
    const resourceId = reference.resourceId === undefined
      ? undefined
      : validateIdentifier(reference.resourceId, 'resourceId', REFERENCE_MAX_LENGTH);
    const resultReference = safeJson(reference.resultReference, 'resultReference');
    const current = await this.requireOperation(scope, key);

    if (current.status === IdempotencyStatus.COMPLETED) {
      if (
        current.resourceType === (resourceType ?? null)
        && current.resourceId === (resourceId ?? null)
        && jsonEqual(current.resultReference, resultReference)
      ) return current;
      throw new IdempotencyConflictError('Completed operation already has a different result reference.');
    }
    if (current.status !== IdempotencyStatus.IN_PROGRESS) {
      throw new InvalidIdempotencyTransitionError(
        `Cannot transition ${current.status} operation to COMPLETED.`,
      );
    }

    const updated = await this.prisma.idempotencyRecord.updateMany({
      where: { id: current.id, status: IdempotencyStatus.IN_PROGRESS },
      data: {
        status: IdempotencyStatus.COMPLETED,
        ...(resourceType === undefined ? {} : { resourceType }),
        ...(resourceId === undefined ? {} : { resourceId }),
        ...(resultReference === undefined ? {} : { resultReference }),
      },
    });
    if (updated.count === 1) return this.requireOperation(scope, key);
    return this.markCompleted(scope, key, reference);
  }

  async markFailed(scopeValue: string, keyValue: string, errorCategoryValue: string): Promise<IdempotencyRecord> {
    return this.markTerminal(scopeValue, keyValue, IdempotencyStatus.FAILED, validateErrorCategory(errorCategoryValue));
  }

  async markUnknown(
    scopeValue: string,
    keyValue: string,
    errorCategoryValue = 'OUTCOME_UNCERTAIN',
  ): Promise<IdempotencyRecord> {
    return this.markTerminal(scopeValue, keyValue, IdempotencyStatus.UNKNOWN, validateErrorCategory(errorCategoryValue));
  }

  private async markTerminal(
    scopeValue: string,
    keyValue: string,
    status: typeof IdempotencyStatus.FAILED | typeof IdempotencyStatus.UNKNOWN,
    errorCategory: string,
  ): Promise<IdempotencyRecord> {
    const scope = validateIdentifier(scopeValue, 'scope', SCOPE_MAX_LENGTH);
    const key = validateIdentifier(keyValue, 'key', KEY_MAX_LENGTH);
    const current = await this.requireOperation(scope, key);

    if (current.status === status && current.errorCategory === errorCategory) return current;
    if (current.status !== IdempotencyStatus.IN_PROGRESS) {
      throw new InvalidIdempotencyTransitionError(
        `Cannot transition ${current.status} operation to ${status}.`,
      );
    }

    const updated = await this.prisma.idempotencyRecord.updateMany({
      where: { id: current.id, status: IdempotencyStatus.IN_PROGRESS },
      data: { status, errorCategory },
    });
    if (updated.count === 1) return this.requireOperation(scope, key);
    return this.markTerminal(scope, key, status, errorCategory);
  }

  private async requireOperation(scope: string, key: string): Promise<IdempotencyRecord> {
    const operation = await this.prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (!operation) throw new IdempotencyValidationError('Idempotency operation was not found.');
    return operation;
  }
}
