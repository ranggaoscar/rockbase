import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface ResolveAccountSelectionParams {
  accountIds?: string[];
  groupIds?: string[];
}

export interface ResolvedAccountSummary {
  id: string;
  username: string;
  platform: string;
  status: string;
  brandTag: string | null;
  sessionHealth: string;
  sessionHealthReason: string | null;
  sessionHealthCheckedAt: Date | null;
}

export async function resolveAccountSelection(
  params: ResolveAccountSelectionParams,
): Promise<ResolvedAccountSummary[]> {
  const directAccountIds = [...new Set((params.accountIds || []).filter(Boolean).map(String))];
  const groupIds = [...new Set((params.groupIds || []).filter(Boolean).map(String))];

  const resolvedIds = new Set<string>(directAccountIds);

  if (groupIds.length > 0) {
    const memberships = await prisma.accountGroupMember.findMany({
      where: {
        groupId: { in: groupIds },
        group: { isArchived: false },
      },
      select: { accountId: true },
    });

    memberships.forEach((membership) => resolvedIds.add(membership.accountId));
  }

  const accountIds = [...resolvedIds];
  if (accountIds.length === 0) return [];

  const accounts = await prisma.socialAccount.findMany({
    where: { id: { in: accountIds } },
    select: {
      id: true,
      username: true,
      platform: true,
      status: true,
      brandTag: true,
      sessionHealth: true,
      sessionHealthReason: true,
      sessionHealthCheckedAt: true,
    },
    orderBy: { username: 'asc' },
  });

  return accounts;
}
