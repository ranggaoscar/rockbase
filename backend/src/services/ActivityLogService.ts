import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_WORKSPACE_ID = 'workspace-default';
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 30;
const MAX_METADATA_JSON_LENGTH = 5000;

type JsonSafeValue = string | number | boolean | null | JsonSafeValue[] | { [key: string]: JsonSafeValue };

export interface ActivityLogInput {
  workspaceId?: string;
  type: string;
  entityType: string;
  entityId: string;
  accountId?: string | null;
  groupId?: string | null;
  campaignId?: string | null;
  action: string;
  status: string;
  message: string;
  metadata?: unknown;
}

function truncateString(value: string) {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
}

function safeJson(value: unknown, depth = 0): JsonSafeValue | undefined {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return undefined;
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return truncateString(value);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '[binary omitted]';
  if (depth >= 4) return '[max depth]';

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => safeJson(item, depth + 1) ?? null);
  }

  if (typeof value === 'object') {
    const output: { [key: string]: JsonSafeValue } = {};
    for (const [key, raw] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      const safeValue = safeJson(raw, depth + 1);
      if (safeValue !== undefined) output[truncateString(key)] = safeValue;
    }
    return output;
  }

  return String(value);
}

async function ensureDefaultWorkspace(workspaceId: string) {
  if (workspaceId !== DEFAULT_WORKSPACE_ID) return;

  await prisma.workspace.upsert({
    where: { id: DEFAULT_WORKSPACE_ID },
    update: {},
    create: { id: DEFAULT_WORKSPACE_ID, name: 'Default Workspace' },
  });
}

async function scheduleActivityWrite(input: ActivityLogInput) {
  const metadata = safeJson(input.metadata);
  const workspaceId = input.workspaceId || DEFAULT_WORKSPACE_ID;
  const data = {
    workspaceId,
    type: truncateString(input.type),
    entityType: truncateString(input.entityType),
    entityId: truncateString(input.entityId),
    accountId: input.accountId || null,
    groupId: input.groupId || null,
    campaignId: input.campaignId || null,
    action: truncateString(input.action),
    status: truncateString(input.status),
    message: truncateString(input.message),
    metadata: metadata === null ? Prisma.JsonNull : metadata === undefined ? undefined : metadata as Prisma.InputJsonValue,
  };

  const serialized = metadata === undefined ? '' : JSON.stringify(metadata);
  if (serialized.length > MAX_METADATA_JSON_LENGTH) {
    data.metadata = { omitted: 'metadata exceeded size limit' };
  }

  try {
    await ensureDefaultWorkspace(workspaceId);
    await prisma.activityLog.create({ data });
  } catch (err: any) {
    console.warn('[ActivityLog] write skipped:', err.message || err);
  }
}

export function logActivity(input: ActivityLogInput): void {
  try {
    if (typeof setImmediate === 'function') {
      setImmediate(() => scheduleActivityWrite(input));
      return;
    }
    setTimeout(() => scheduleActivityWrite(input), 0);
  } catch (err: any) {
    console.warn('[ActivityLog] scheduling skipped:', err.message || err);
  }
}
