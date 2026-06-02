import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { resolveAccountSelection } from '../services/AccountSelectionResolver';
import { logActivity } from '../services/ActivityLogService';
import { sessionHealthService } from '../services/SessionHealthService';

const router = Router();
const prisma = new PrismaClient();
const DEFAULT_WORKSPACE_ID = 'workspace-default';

const accountSummarySelect = {
  id: true,
  username: true,
  platform: true,
  status: true,
  brandTag: true,
  sessionHealth: true,
  sessionHealthReason: true,
  sessionHealthCheckedAt: true,
} as const;

router.use(authenticateToken);

router.post('/resolve-preview', async (req: AuthRequest, res: Response) => {
  try {
    const accountIds = Array.isArray(req.body?.accountIds)
      ? req.body.accountIds.filter(Boolean).map(String)
      : [];
    const groupIds = Array.isArray(req.body?.groupIds)
      ? req.body.groupIds.filter(Boolean).map(String)
      : [];

    const accounts = await resolveAccountSelection({ accountIds, groupIds });
    const healthyAccounts = accounts.filter((account) => sessionHealthService.isPostableHealth(account.sessionHealth));
    const skippedAccounts = accounts
      .filter((account) => !sessionHealthService.isPostableHealth(account.sessionHealth))
      .map((account) => ({
        accountId: account.id,
        username: account.username,
        health: account.sessionHealth || 'UNKNOWN',
        reason: account.sessionHealthReason || 'Session has not been checked or is not healthy',
        checkedAt: account.sessionHealthCheckedAt,
      }));

    res.json({
      accounts,
      totalResolved: accounts.length,
      healthyCount: healthyAccounts.length,
      skippedCount: skippedAccounts.length,
      skippedAccounts,
    });
  } catch (err) {
    console.error('[AccountGroups] Resolve preview error:', err);
    res.status(500).json({ error: 'Failed to resolve account selection preview' });
  }
});

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const groups = await prisma.accountGroup.findMany({
      where: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        isArchived: false,
      },
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true } },
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        color: group.color,
        isArchived: group.isArchived,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        memberCount: group._count.members,
      })),
    });
  } catch (err) {
    console.error('[AccountGroups] List error:', err);
    res.status(500).json({ error: 'Failed to fetch account groups' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const name = String(req.body?.name || '').trim();
    const description = req.body?.description ? String(req.body.description).trim() : null;
    const color = req.body?.color ? String(req.body.color).trim() : null;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const group = await prisma.accountGroup.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        name,
        description,
        color,
      },
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true } },
      },
    });

    res.status(201).json({
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        color: group.color,
        isArchived: group.isArchived,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        memberCount: group._count.members,
      },
    });

    logActivity({
      workspaceId: DEFAULT_WORKSPACE_ID,
      type: 'group',
      entityType: 'account_group',
      entityId: group.id,
      groupId: group.id,
      action: 'group_created',
      status: 'success',
      message: `Account group "${group.name}" created`,
      metadata: { name: group.name, description: group.description, color: group.color },
    });
  } catch (err: any) {
    console.error('[AccountGroups] Create error:', err);
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'A group with this name already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to create account group' });
  }
});

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const data: {
      name?: string;
      description?: string | null;
      color?: string | null;
      isArchived?: boolean;
    } = {};

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) {
        res.status(400).json({ error: 'name cannot be empty' });
        return;
      }
      data.name = name;
    }
    if (req.body?.description !== undefined) {
      const description = String(req.body.description).trim();
      data.description = description || null;
    }
    if (req.body?.color !== undefined) {
      const color = String(req.body.color).trim();
      data.color = color || null;
    }
    if (req.body?.isArchived !== undefined) {
      data.isArchived = Boolean(req.body.isArchived);
    }

    const group = await prisma.accountGroup.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true } },
      },
    });

    res.json({
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        color: group.color,
        isArchived: group.isArchived,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        memberCount: group._count.members,
      },
    });

    logActivity({
      workspaceId: DEFAULT_WORKSPACE_ID,
      type: 'group',
      entityType: 'account_group',
      entityId: group.id,
      groupId: group.id,
      action: 'group_updated',
      status: 'success',
      message: `Account group "${group.name}" updated`,
      metadata: { changedFields: Object.keys(data) },
    });
  } catch (err: any) {
    console.error('[AccountGroups] Update error:', err);
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'A group with this name already exists' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Account group not found' });
      return;
    }
    res.status(500).json({ error: 'Failed to update account group' });
  }
});

router.get('/:id/accounts', async (req: AuthRequest, res: Response) => {
  try {
    const groupId = String(req.params.id);
    const includeAvailable = req.query.includeAvailable === 'true';

    const group = await prisma.accountGroup.findUnique({
      where: { id: groupId },
      select: { id: true, name: true },
    });

    if (!group) {
      res.status(404).json({ error: 'Account group not found' });
      return;
    }

    const memberships = await prisma.accountGroupMember.findMany({
      where: { groupId },
      select: {
        accountId: true,
        createdAt: true,
        account: { select: accountSummarySelect },
      },
      orderBy: { createdAt: 'asc' },
    });

    const members = memberships.map((membership) => membership.account);
    const response: {
      group: { id: string; name: string };
      members: typeof members;
      availableAccounts?: typeof members;
    } = { group, members };

    if (includeAvailable) {
      const memberIds = new Set(memberships.map((membership) => membership.accountId));
      const availableAccounts = await prisma.socialAccount.findMany({
        where: {
          workspaceId: DEFAULT_WORKSPACE_ID,
          id: { notIn: [...memberIds] },
        },
        select: accountSummarySelect,
        orderBy: { username: 'asc' },
      });
      response.availableAccounts = availableAccounts;
    }

    res.json(response);
  } catch (err) {
    console.error('[AccountGroups] Members error:', err);
    res.status(500).json({ error: 'Failed to fetch group accounts' });
  }
});

router.put('/:id/accounts', async (req: AuthRequest, res: Response) => {
  try {
    const groupId = String(req.params.id);
    const accountIds: string[] = Array.isArray(req.body?.accountIds)
      ? Array.from(new Set<string>(req.body.accountIds.filter(Boolean).map(String)))
      : [];

    const group = await prisma.accountGroup.findUnique({
      where: { id: groupId },
      select: { id: true, name: true },
    });

    if (!group) {
      res.status(404).json({ error: 'Account group not found' });
      return;
    }

    const validAccounts = await prisma.socialAccount.findMany({
      where: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        id: { in: accountIds },
      },
      select: { id: true },
    });
    const validAccountIds = validAccounts.map((account) => account.id);

    const existingMembers = await prisma.accountGroupMember.findMany({
      where: { groupId },
      select: { accountId: true },
    });
    const existingIds = new Set(existingMembers.map((member) => member.accountId));
    const nextIds = new Set(validAccountIds);
    const addedAccountIds = validAccountIds.filter((accountId) => !existingIds.has(accountId));
    const removedAccountIds = [...existingIds].filter((accountId) => !nextIds.has(accountId));

    await prisma.$transaction([
      prisma.accountGroupMember.deleteMany({ where: { groupId } }),
      prisma.accountGroupMember.createMany({
        data: validAccountIds.map((accountId) => ({ groupId, accountId })),
      }),
    ]);

    const members = await prisma.accountGroupMember.findMany({
      where: { groupId },
      select: { account: { select: accountSummarySelect } },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      group,
      members: members.map((membership) => membership.account),
      memberCount: members.length,
    });

    if (addedAccountIds.length > 0) {
      logActivity({
        workspaceId: DEFAULT_WORKSPACE_ID,
        type: 'group',
        entityType: 'account_group',
        entityId: groupId,
        groupId,
        action: 'members_added',
        status: 'success',
        message: `${addedAccountIds.length} account(s) added to "${group.name}"`,
        metadata: { accountIds: addedAccountIds },
      });
    }

    if (removedAccountIds.length > 0) {
      logActivity({
        workspaceId: DEFAULT_WORKSPACE_ID,
        type: 'group',
        entityType: 'account_group',
        entityId: groupId,
        groupId,
        action: 'members_removed',
        status: 'success',
        message: `${removedAccountIds.length} account(s) removed from "${group.name}"`,
        metadata: { accountIds: removedAccountIds },
      });
    }
  } catch (err) {
    console.error('[AccountGroups] Replace members error:', err);
    res.status(500).json({ error: 'Failed to update group accounts' });
  }
});

export default router;
