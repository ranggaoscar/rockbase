/**
 * CampaignService — Campaign lifecycle management.
 *
 * Create campaigns, plan staggered actions, start/pause/resume/stop,
 * track progress, and generate results.
 */
import { PrismaClient } from '@prisma/client';
import { targetedEngagementService, ActionResult } from './TargetedEngagementService';
import { HumanBehavior } from './HumanBehavior';
import { resolveAccountSelection, ResolvedAccountSummary } from './AccountSelectionResolver';
import { sessionHealthService } from './SessionHealthService';
import { logActivity } from './ActivityLogService';
import { aiService, CampaignAiPlan } from './AiService';
import { assertAutomationEnabled } from '../middleware/automation';

const prisma = new PrismaClient();
const DEFAULT_WORKSPACE_ID = 'workspace-default';

// Track running campaigns so we can pause/stop them
const runningCampaigns = new Map<string, { aborted: boolean; paused: boolean }>();

export interface CampaignProgress {
  id: string;
  name: string;
  status: string;
  scheduledAt?: Date | null;
  schedulerStatus?: string;
  lastExecutionAt?: Date | null;
  totalActions: number;
  completedActions: number;
  failedActions: number;
  skippedActions: number;
  progressPercent: number;
  accountBreakdown: {
    accountId: string;
    completed: number;
    failed: number;
    pending: number;
  }[];
  groupIds?: string[];
  planningSummary?: any;
}

export interface CampaignComposeDraft {
  campaignId: string;
  campaignName: string;
  scheduledAt?: string | null;
  schedulerStatus?: string;
  objective: string;
  targetType: string;
  targetValue: string;
  groupIds: string[];
  accountIds: string[];
  healthyCount: number;
  skippedCount: number;
  planningSummary: any;
  aiPlan?: CampaignAiPlan;
  suggestedCaption: string;
  suggestedCTA?: string;
  suggestedHashtags?: string[];
  contentAngle?: string;
  tone?: string;
  schedulerDraftSnapshot?: any;
}

export interface CampaignAiPlanningResult {
  campaignId: string;
  aiPlan: CampaignAiPlan;
  planningSummary: any;
}

export interface CampaignVariationAssignmentDraft {
  campaignId: string;
  campaignName: string;
  groupIds: string[];
  accountIds: string[];
  assignments: {
    variationTitle: string;
    targetCluster: string;
    visualDirection: string;
    captionSeed: string;
    cta: string;
    hashtags: string[];
    formatRecommendation: string;
    priorityScore: number;
    groupIds: string[];
    accountId: string;
  }[];
}

export type CampaignMediaType = 'image' | 'video' | 'reference';
export type CampaignVariationApprovalStatus = 'DRAFT' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED' | 'USED';

export interface CampaignMediaItem {
  id: string;
  filename: string;
  originalName: string;
  type: CampaignMediaType;
  note: string;
  path: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface CampaignVariationApprovalInput {
  variationKey: string;
  status?: CampaignVariationApprovalStatus;
  reviewerNote?: string;
}

interface CampaignPlanSnapshot {
  selectedGroups: { id: string; name: string; color: string | null; memberCount: number }[];
  directAccountIds: string[];
  resolvedAccountIds: string[];
  healthyAccountIds: string[];
  skippedAccounts: {
    accountId: string;
    username: string;
    health: string;
    reason: string;
  }[];
  totalResolved: number;
  healthyCount: number;
  skippedCount: number;
  actionCount: number;
  estimatedPostingSpreadMinutes: { min: number; max: number; average: number };
  estimatedQueueDurationMinutes: number;
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): any {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function latestExecutionAt(actions: { executedAt?: Date | null }[]): Date | null {
  return actions.reduce<Date | null>((latest, action) => {
    if (!action.executedAt) return latest;
    if (!latest || action.executedAt > latest) return action.executedAt;
    return latest;
  }, null);
}

function parseMediaLibrary(planningSummary: any): CampaignMediaItem[] {
  const media = planningSummary?.mediaLibrary;
  return Array.isArray(media) ? media : [];
}

function parseVariationApprovals(planningSummary: any): Record<string, any> {
  const approvals = planningSummary?.variationApprovals;
  return approvals && typeof approvals === 'object' && !Array.isArray(approvals) ? approvals : {};
}

async function hasRecentCampaignActivity(campaignId: string, action: string, withinMs = 30_000) {
  const recent = await prisma.activityLog.findFirst({
    where: {
      campaignId,
      action,
      createdAt: { gte: new Date(Date.now() - withinMs) },
    },
    select: { id: true },
  });
  return Boolean(recent);
}

export class CampaignService {

  /**
   * Create a new campaign and plan its actions.
   */
  public async createCampaign(params: {
    name: string;
    type: string;
    targetType: string;
    targetValue: string;
    accountIds?: string[];
    groupIds?: string[];
    dailyFollowLimit?: number;
    dailyLikeLimit?: number;
    dailyCommentLimit?: number;
    activeHoursStart?: string;
    activeHoursEnd?: string;
  }): Promise<any> {
    const plan = await this.buildPlanningSnapshot(params.accountIds || [], params.groupIds || [], params.type);

    if (plan.totalResolved === 0) {
      throw new Error('No accounts resolved from selected accounts or groups');
    }

    if (plan.healthyCount === 0) {
      throw new Error('No healthy accounts resolved for campaign planning');
    }

    const campaign = await prisma.campaign.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        name: params.name,
        type: params.type,
        targetType: params.targetType,
        targetValue: params.targetValue,
        accountIds: JSON.stringify(plan.healthyAccountIds),
        groupIds: JSON.stringify((params.groupIds || []).filter(Boolean).map(String)),
        planningSummary: JSON.stringify(plan),
        status: 'pending',
        dailyFollowLimit: params.dailyFollowLimit ?? 25,
        dailyLikeLimit: params.dailyLikeLimit ?? 65,
        dailyCommentLimit: params.dailyCommentLimit ?? 12,
        activeHoursStart: params.activeHoursStart ?? '08:00',
        activeHoursEnd: params.activeHoursEnd ?? '22:00',
      },
    });

    // Plan actions for each account
    await this._planActions(campaign.id, plan.healthyAccountIds, params.type, params.targetValue);

    // Update total count
    const actionCount = await prisma.campaignAction.count({ where: { campaignId: campaign.id } });
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { totalActions: actionCount },
    });

    this.logCampaignPlanningActivity(campaign.id, params.name, plan, 'created');

    console.log(`[Campaign] Created "${params.name}" with ${actionCount} planned actions for ${plan.healthyAccountIds.length} healthy accounts`);

    return prisma.campaign.findUnique({
      where: { id: campaign.id },
      include: { actions: true },
    });
  }

  /**
   * Update a pending campaign and rebuild its planned action snapshot.
   */
  public async updateCampaign(campaignId: string, params: {
    name?: string;
    type?: string;
    targetType?: string;
    targetValue?: string;
    accountIds?: string[];
    groupIds?: string[];
    dailyFollowLimit?: number;
    dailyLikeLimit?: number;
    dailyCommentLimit?: number;
    activeHoursStart?: string;
    activeHoursEnd?: string;
  }): Promise<any> {
    const existing = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!existing) throw new Error('Campaign not found');
    if (!['pending', 'stopped'].includes(existing.status)) {
      throw new Error('Only pending or stopped campaigns can be updated');
    }

    const nextType = params.type ?? existing.type;
    const nextTargetValue = params.targetValue ?? existing.targetValue;
    const nextAccountIds = params.accountIds ?? parseJsonArray(existing.accountIds);
    const nextGroupIds = params.groupIds ?? parseJsonArray((existing as any).groupIds);
    const plan = await this.buildPlanningSnapshot(nextAccountIds, nextGroupIds, nextType);

    if (plan.totalResolved === 0) {
      throw new Error('No accounts resolved from selected accounts or groups');
    }

    if (plan.healthyCount === 0) {
      throw new Error('No healthy accounts resolved for campaign planning');
    }

    await prisma.$transaction([
      prisma.campaignAction.deleteMany({ where: { campaignId } }),
      prisma.campaign.update({
        where: { id: campaignId },
        data: {
          ...(params.name !== undefined ? { name: params.name } : {}),
          ...(params.type !== undefined ? { type: params.type } : {}),
          ...(params.targetType !== undefined ? { targetType: params.targetType } : {}),
          ...(params.targetValue !== undefined ? { targetValue: params.targetValue } : {}),
          ...(params.dailyFollowLimit !== undefined ? { dailyFollowLimit: params.dailyFollowLimit } : {}),
          ...(params.dailyLikeLimit !== undefined ? { dailyLikeLimit: params.dailyLikeLimit } : {}),
          ...(params.dailyCommentLimit !== undefined ? { dailyCommentLimit: params.dailyCommentLimit } : {}),
          ...(params.activeHoursStart !== undefined ? { activeHoursStart: params.activeHoursStart } : {}),
          ...(params.activeHoursEnd !== undefined ? { activeHoursEnd: params.activeHoursEnd } : {}),
          accountIds: JSON.stringify(plan.healthyAccountIds),
          groupIds: JSON.stringify(nextGroupIds.filter(Boolean).map(String)),
          planningSummary: JSON.stringify(plan),
          totalActions: 0,
          completedActions: 0,
          failedActions: 0,
          completedAt: null,
          status: 'pending',
        },
      }),
    ]);

    await this._planActions(campaignId, plan.healthyAccountIds, nextType, nextTargetValue);
    const actionCount = await prisma.campaignAction.count({ where: { campaignId } });
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { totalActions: actionCount },
    });

    this.logCampaignPlanningActivity(campaignId, params.name ?? existing.name, plan, 'updated');

    return prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { actions: true },
    });
  }

  /**
   * Start a campaign — processes actions with staggered timing.
   */
  public async startCampaign(campaignId: string): Promise<void> {
    assertAutomationEnabled();
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');
    if (campaign.status === 'running') throw new Error('Campaign is already running');

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'running' },
    });

    // Set up control state
    runningCampaigns.set(campaignId, { aborted: false, paused: false });

    console.log(`[Campaign] Starting campaign "${campaign.name}" (${campaignId})`);

    // Process in background
    this._processCampaign(campaignId).catch((err) => {
      console.error(`[Campaign] Campaign ${campaignId} error:`, err.message);
    });
  }

  /**
   * Pause a running campaign.
   */
  public async pauseCampaign(campaignId: string): Promise<void> {
    const control = runningCampaigns.get(campaignId);
    if (control) {
      control.paused = true;
    }
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'paused' },
    });
    console.log(`[Campaign] Paused campaign ${campaignId}`);
  }

  /**
   * Resume a paused campaign.
   */
  public async resumeCampaign(campaignId: string): Promise<void> {
    assertAutomationEnabled();
    const control = runningCampaigns.get(campaignId);
    if (control) {
      control.paused = false;
    } else {
      // Re-start processing if control was lost
      runningCampaigns.set(campaignId, { aborted: false, paused: false });
      this._processCampaign(campaignId).catch((err) => {
        console.error(`[Campaign] Resume error:`, err.message);
      });
    }
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'running' },
    });
    console.log(`[Campaign] Resumed campaign ${campaignId}`);
  }

  /**
   * Stop a campaign permanently.
   */
  public async stopCampaign(campaignId: string): Promise<void> {
    const control = runningCampaigns.get(campaignId);
    if (control) {
      control.aborted = true;
    }
    runningCampaigns.delete(campaignId);

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'stopped', completedAt: new Date() },
    });

    // Mark remaining pending actions as skipped
    await prisma.campaignAction.updateMany({
      where: { campaignId, status: { in: ['pending', 'queued'] } },
      data: { status: 'skipped' },
    });

    console.log(`[Campaign] Stopped campaign ${campaignId}`);
  }

  /**
   * Archive a campaign so it's hidden from default lists.
   */
  public async archiveCampaign(campaignId: string): Promise<void> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { isArchived: true, archivedAt: new Date() },
    });

    logActivity({
      workspaceId: campaign.workspaceId,
      type: 'campaign',
      entityType: 'campaign',
      entityId: campaign.id,
      campaignId,
      action: 'campaign_archived',
      status: 'success',
      message: `Campaign "${campaign.name}" has been archived.`,
    });

    console.log(`[Campaign] Archived campaign ${campaignId}`);
  }

  /**
   * Restore an archived campaign.
   */
  public async restoreCampaign(campaignId: string): Promise<void> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { isArchived: false, archivedAt: null },
    });

    logActivity({
      workspaceId: campaign.workspaceId,
      type: 'campaign',
      entityType: 'campaign',
      entityId: campaign.id,
      campaignId,
      action: 'campaign_restored',
      status: 'success',
      message: `Campaign "${campaign.name}" has been restored.`,
    });

    console.log(`[Campaign] Restored campaign ${campaignId}`);
  }

  /**
   * Get campaign progress with per-account breakdown.
   */
  public async getCampaignProgress(campaignId: string): Promise<CampaignProgress> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { actions: true },
    });

    if (!campaign) throw new Error('Campaign not found');

    const accountIds: string[] = JSON.parse(campaign.accountIds);

    const accountBreakdown = accountIds.map((accountId) => {
      const accountActions = campaign.actions.filter((a) => a.accountId === accountId);
      return {
        accountId,
        completed: accountActions.filter((a) => a.status === 'completed').length,
        failed: accountActions.filter((a) => a.status === 'failed').length,
        pending: accountActions.filter((a) => ['pending', 'queued', 'running'].includes(a.status)).length,
      };
    });

    const completed = campaign.actions.filter((a) => a.status === 'completed').length;
    const failed = campaign.actions.filter((a) => a.status === 'failed').length;
    const skipped = campaign.actions.filter((a) => a.status === 'skipped').length;
    const total = campaign.actions.length;

    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      totalActions: total,
      completedActions: completed,
      failedActions: failed,
      skippedActions: skipped,
      progressPercent: total > 0 ? Math.round(((completed + failed + skipped) / total) * 100) : 0,
      accountBreakdown,
      groupIds: parseJsonArray((campaign as any).groupIds),
      planningSummary: parseJsonObject((campaign as any).planningSummary),
      scheduledAt: (campaign as any).scheduledAt,
      schedulerStatus: (campaign as any).schedulerStatus,
      lastExecutionAt: latestExecutionAt(campaign.actions),
    };
  }

  /**
   * Get all campaigns.
   */
  public async listCampaigns(options?: { includeArchived?: boolean }): Promise<any[]> {
    const campaigns = await prisma.campaign.findMany({
      where: {
        isArchived: options?.includeArchived ?? false,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { actions: true } },
        actions: { select: { executedAt: true } },
      },
    });

    return campaigns.map((c: any) => ({
      ...c,
      lastExecutionAt: latestExecutionAt(c.actions),
      actions: undefined,
      accountIds: JSON.parse(c.accountIds),
      groupIds: parseJsonArray(c.groupIds),
      planningSummary: parseJsonObject(c.planningSummary),
    }));
  }

  public async scheduleCampaign(campaignId: string, scheduledAt: Date): Promise<any> {
    if (Number.isNaN(scheduledAt.getTime())) throw new Error('Invalid scheduledAt');
    if (scheduledAt.getTime() < Date.now() - 60_000) throw new Error('scheduledAt cannot be in the past');

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');
    if (['running', 'paused'].includes(campaign.status)) {
      throw new Error('Running or paused campaigns cannot be scheduled');
    }
    if (['EXECUTED', 'READY'].includes((campaign as any).schedulerStatus)) {
      throw new Error('Campaign scheduler draft is already prepared');
    }

    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        scheduledAt,
        schedulerStatus: 'PENDING' as any,
      },
    });

    return {
      ...updated,
      accountIds: parseJsonArray(updated.accountIds),
      groupIds: parseJsonArray((updated as any).groupIds),
      planningSummary: parseJsonObject((updated as any).planningSummary),
    };
  }

  public async cancelScheduledCampaign(campaignId: string): Promise<any> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');
    if ((campaign as any).schedulerStatus === 'READY') {
      throw new Error('READY campaign drafts cannot be cancelled; open Compose and review or reschedule manually later');
    }
    if ((campaign as any).schedulerStatus === 'EXECUTED') {
      throw new Error('Executed scheduler entries cannot be cancelled');
    }

    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        schedulerStatus: 'CANCELLED' as any,
      },
    });

    return {
      ...updated,
      accountIds: parseJsonArray(updated.accountIds),
      groupIds: parseJsonArray((updated as any).groupIds),
      planningSummary: parseJsonObject((updated as any).planningSummary),
    };
  }

  public async retryScheduledCampaign(campaignId: string, now = new Date()): Promise<any> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');
    if ((campaign as any).schedulerStatus !== 'FAILED') {
      throw new Error('Only FAILED scheduler campaigns can be retried');
    }

    const scheduledAt = (campaign as any).scheduledAt && (campaign as any).scheduledAt > now
      ? (campaign as any).scheduledAt
      : now;

    await prisma.campaign.updateMany({
      where: { id: campaign.id, schedulerStatus: 'FAILED' as any },
      data: {
        schedulerStatus: 'PENDING' as any,
        scheduledAt,
      },
    });

    if (scheduledAt <= now) {
      await this.prepareScheduledCampaignDraft(campaign.id, now);
    }

    const updated = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!updated) throw new Error('Campaign not found');

    return {
      ...updated,
      accountIds: parseJsonArray(updated.accountIds),
      groupIds: parseJsonArray((updated as any).groupIds),
      planningSummary: parseJsonObject((updated as any).planningSummary),
    };
  }

  public async listCampaignMedia(campaignId: string): Promise<{ media: CampaignMediaItem[]; variationMediaReferences: any }> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');

    const planningSummary = parseJsonObject((campaign as any).planningSummary) || {};
    return {
      media: parseMediaLibrary(planningSummary),
      variationMediaReferences: planningSummary.variationMediaReferences || {},
    };
  }

  public async addCampaignMedia(campaignId: string, item: CampaignMediaItem): Promise<{ media: CampaignMediaItem[] }> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');

    const planningSummary = parseJsonObject((campaign as any).planningSummary) || {};
    const media = [item, ...parseMediaLibrary(planningSummary)];
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        planningSummary: JSON.stringify({
          ...planningSummary,
          mediaLibrary: media,
        }),
      },
    });

    return { media };
  }

  public async removeCampaignMedia(campaignId: string, mediaId: string): Promise<{ media: CampaignMediaItem[]; variationMediaReferences: any }> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');

    const planningSummary = parseJsonObject((campaign as any).planningSummary) || {};
    const media = parseMediaLibrary(planningSummary).filter((item) => item.id !== mediaId);
    const variationMediaReferences = { ...(planningSummary.variationMediaReferences || {}) };
    for (const [key, value] of Object.entries(variationMediaReferences)) {
      const refs = value as any;
      variationMediaReferences[key] = {
        primaryMediaId: refs?.primaryMediaId === mediaId ? '' : refs?.primaryMediaId || '',
        secondaryMediaId: refs?.secondaryMediaId === mediaId ? '' : refs?.secondaryMediaId || '',
      };
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        planningSummary: JSON.stringify({
          ...planningSummary,
          mediaLibrary: media,
          variationMediaReferences,
        }),
      },
    });

    return { media, variationMediaReferences };
  }

  public async updateVariationMediaReference(
    campaignId: string,
    variationKey: string,
    primaryMediaId: string,
    secondaryMediaId: string,
  ): Promise<{ variationMediaReferences: any }> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');

    const planningSummary = parseJsonObject((campaign as any).planningSummary) || {};
    const mediaIds = new Set(parseMediaLibrary(planningSummary).map((item) => item.id));
    const safePrimary = primaryMediaId && mediaIds.has(primaryMediaId) ? primaryMediaId : '';
    const safeSecondary = secondaryMediaId && mediaIds.has(secondaryMediaId) ? secondaryMediaId : '';
    const safeKey = variationKey.slice(0, 160);
    const variationMediaReferences = {
      ...(planningSummary.variationMediaReferences || {}),
      [safeKey]: {
        primaryMediaId: safePrimary,
        secondaryMediaId: safeSecondary,
      },
    };

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        planningSummary: JSON.stringify({
          ...planningSummary,
          variationMediaReferences,
        }),
      },
    });

    return { variationMediaReferences };
  }

  public async updateVariationApproval(
    campaignId: string,
    input: CampaignVariationApprovalInput,
  ): Promise<{ variationApprovals: Record<string, any> }> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');

    const planningSummary = parseJsonObject((campaign as any).planningSummary) || {};
    const variationKey = String(input.variationKey || '').slice(0, 160);
    if (!variationKey) throw new Error('variationKey is required');

    const allowedStatuses: CampaignVariationApprovalStatus[] = ['DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'USED'];
    const previousApprovals = parseVariationApprovals(planningSummary);
    const previous = previousApprovals[variationKey] || {};
    const nextStatus: CampaignVariationApprovalStatus = input.status && allowedStatuses.includes(input.status)
      ? input.status
      : allowedStatuses.includes(previous.status)
        ? previous.status
        : 'DRAFT';
    const reviewerNote = input.reviewerNote !== undefined
      ? String(input.reviewerNote || '').slice(0, 1000)
      : previous.reviewerNote || '';
    const reviewedAt = new Date().toISOString();
    const variationApprovals = {
      ...previousApprovals,
      [variationKey]: {
        status: nextStatus,
        reviewerNote,
        reviewedAt,
      },
    };

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        planningSummary: JSON.stringify({
          ...planningSummary,
          variationApprovals,
        }),
      },
    });

    const actionByStatus: Partial<Record<CampaignVariationApprovalStatus, string>> = {
      APPROVED: 'campaign_variation_approved',
      REJECTED: 'campaign_variation_rejected',
      USED: 'campaign_variation_marked_used',
      NEEDS_REVIEW: 'campaign_variation_needs_review',
    };
    const action = input.reviewerNote !== undefined && input.status === undefined
      ? 'campaign_variation_review_note_added'
      : actionByStatus[nextStatus];

    if (action) {
      logActivity({
        workspaceId: DEFAULT_WORKSPACE_ID,
        type: 'campaign',
        entityType: 'campaign',
        entityId: campaign.id,
        campaignId: campaign.id,
        action,
        status: nextStatus === 'REJECTED' ? 'warning' : 'success',
        message: `Variation "${variationKey}" updated to ${nextStatus} for "${campaign.name}"`,
        metadata: {
          variationKey,
          approvalStatus: nextStatus,
          hasReviewerNote: Boolean(reviewerNote),
        },
      });
    }

    return { variationApprovals };
  }

  /**
   * Get count of schedulable campaigns (PENDING with scheduledAt in the future).
   * Used by CampaignSchedulerService to skip expensive polling when no campaigns exist.
   */
  public async getSchedulableCampaignCount(): Promise<number> {
    return prisma.campaign.count({
      where: {
        schedulerStatus: 'PENDING' as any,
        scheduledAt: { not: null },
      },
    });
  }

  /**
   * Get actions log for a campaign.
   */
  public async getCampaignActions(campaignId: string): Promise<any[]> {
    return prisma.campaignAction.findMany({
      where: { campaignId },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  /**
   * Build a lightweight compose draft from the stored campaign planning snapshot.
   * This is read-only and does not create queues, sessions, or posting work.
   */
  public async getComposeDraft(campaignId: string): Promise<CampaignComposeDraft> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');

    const draft = this.buildComposeDraftFromCampaign(campaign);
    const { groupIds, accountIds, healthyCount, skippedCount } = draft;

    if (!(await hasRecentCampaignActivity(campaign.id, 'campaign_compose_draft_opened'))) {
      logActivity({
        workspaceId: DEFAULT_WORKSPACE_ID,
        type: 'campaign',
        entityType: 'campaign',
        entityId: campaign.id,
        campaignId: campaign.id,
        action: 'campaign_compose_draft_opened',
        status: 'success',
        message: `Compose draft opened for campaign "${campaign.name}"`,
        metadata: {
          source: 'campaign',
          campaignName: campaign.name,
          groupIds,
          accountIds,
          healthyCount,
          skippedCount,
          targetType: campaign.targetType,
          targetValue: campaign.targetValue,
        },
      });
    }

    const aiPlan = draft.aiPlan;
    const suggestedHashtags = draft.suggestedHashtags || [];
    if (aiPlan?.captionSeed || suggestedHashtags.length > 0) {
      logActivity({
        workspaceId: DEFAULT_WORKSPACE_ID,
        type: 'campaign',
        entityType: 'campaign',
        entityId: campaign.id,
        campaignId: campaign.id,
        action: 'campaign_caption_seed_loaded',
        status: 'success',
        message: `Campaign caption seed loaded for "${campaign.name}"`,
        metadata: {
          hasCaptionSeed: Boolean(aiPlan?.captionSeed),
          hashtagCount: suggestedHashtags.length,
          source: aiPlan?.source || 'none',
        },
      });
    }

    return draft;
  }

  // ── Private methods ────────────────────────────────────────────────────────

  /**
   * Plan actions for each account based on campaign type.
   */
  public async generateAiPlan(campaignId: string): Promise<CampaignAiPlanningResult> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');

    const planningSummary = parseJsonObject((campaign as any).planningSummary) || {};
    const selectedGroups = Array.isArray(planningSummary.selectedGroups) ? planningSummary.selectedGroups : [];
    const healthyCount = Number(planningSummary.healthyCount ?? parseJsonArray(campaign.accountIds).length);
    const objective = `${campaign.type} ${campaign.targetType} ${campaign.targetValue}`.trim();
    const aiPlan = await aiService.generateCampaignPlan({
      campaignName: campaign.name,
      objective,
      targetType: campaign.targetType,
      targetValue: campaign.targetValue,
      selectedGroups,
      healthyAccountCount: healthyCount,
    });

    const nextPlanningSummary = {
      ...planningSummary,
      aiPlan,
    };

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { planningSummary: JSON.stringify(nextPlanningSummary) },
    });

    if (aiPlan.source === 'fallback') {
      logActivity({
        workspaceId: DEFAULT_WORKSPACE_ID,
        type: 'campaign',
        entityType: 'campaign',
        entityId: campaign.id,
        campaignId: campaign.id,
        action: 'campaign_ai_plan_failed',
        status: 'failed',
        message: `AI campaign plan used fallback for "${campaign.name}"`,
        metadata: {
          reason: aiPlan.fallbackReason || 'Unknown AI planning failure',
        },
      });
    }

    logActivity({
      workspaceId: DEFAULT_WORKSPACE_ID,
      type: 'campaign',
      entityType: 'campaign',
      entityId: campaign.id,
      campaignId: campaign.id,
      action: 'campaign_ai_plan_generated',
      status: 'success',
      message: `AI campaign plan generated for "${campaign.name}"`,
      metadata: {
        source: aiPlan.source,
        healthyCount,
        targetType: campaign.targetType,
        targetValue: campaign.targetValue,
      },
    });

    if (aiPlan.contentVariations.length > 0) {
      logActivity({
        workspaceId: DEFAULT_WORKSPACE_ID,
        type: 'campaign',
        entityType: 'campaign',
        entityId: campaign.id,
        campaignId: campaign.id,
        action: 'campaign_content_variations_generated',
        status: 'success',
        message: `${aiPlan.contentVariations.length} content variation(s) generated for "${campaign.name}"`,
        metadata: {
          variationCount: aiPlan.contentVariations.length,
          source: aiPlan.source,
          formats: aiPlan.contentVariations.map((variation) => variation.formatRecommendation),
        },
      });
    }

    return {
      campaignId: campaign.id,
      aiPlan,
      planningSummary: nextPlanningSummary,
    };
  }

  public async getVariationAssignmentDraft(campaignId: string): Promise<CampaignVariationAssignmentDraft> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error('Campaign not found');

    const planningSummary = parseJsonObject((campaign as any).planningSummary) || {};
    const aiPlan = planningSummary.aiPlan as CampaignAiPlan | undefined;
    const contentVariations = Array.isArray(aiPlan?.contentVariations) ? aiPlan!.contentVariations : [];
    const groupIds = parseJsonArray((campaign as any).groupIds);
    const accountIds = parseJsonArray(campaign.accountIds);

    const assignments = contentVariations.map((variation, index) => {
      const hashtags = Array.isArray(variation.suggestedHashtags) ? variation.suggestedHashtags : [];
      const captionSeed = [
        variation.captionAngle,
        variation.cta,
        hashtags.join(' '),
      ].filter(Boolean).join('\n\n');

      return {
        variationTitle: variation.title,
        targetCluster: variation.targetGroupIntent,
        visualDirection: variation.visualDirection,
        captionSeed,
        cta: variation.cta,
        hashtags,
        formatRecommendation: variation.formatRecommendation,
        priorityScore: variation.priorityScore,
        groupIds,
        accountId: accountIds[index % Math.max(accountIds.length, 1)] || '',
      };
    });

    if (!(await hasRecentCampaignActivity(campaign.id, 'campaign_variation_assignments_prepared'))) {
      logActivity({
        workspaceId: DEFAULT_WORKSPACE_ID,
        type: 'campaign',
        entityType: 'campaign',
        entityId: campaign.id,
        campaignId: campaign.id,
        action: 'campaign_variation_assignments_prepared',
        status: 'success',
        message: `${assignments.length} variation assignment draft(s) prepared for "${campaign.name}"`,
        metadata: {
          source: 'campaign',
          campaignName: campaign.name,
          assignmentCount: assignments.length,
          groupIds,
          accountCount: accountIds.length,
        },
      });
    }

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      groupIds,
      accountIds,
      assignments,
    };
  }

  public async pollDueScheduledCampaigns(now = new Date(), take = 10): Promise<number> {
    const dueCampaigns = await prisma.campaign.findMany({
      where: {
        schedulerStatus: 'PENDING' as any,
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: 'asc' },
      take,
    });

    let prepared = 0;
    for (const campaign of dueCampaigns) {
      const ok = await this.prepareScheduledCampaignDraft(campaign.id, now);
      if (ok) prepared += 1;
    }
    return prepared;
  }

  public async prepareScheduledCampaignDraft(campaignId: string, now = new Date()): Promise<boolean> {
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return false;
    if ((campaign as any).schedulerStatus !== 'PENDING') return false;
    if (!(campaign as any).scheduledAt || (campaign as any).scheduledAt > now) return false;

    try {
      const planningSummary = parseJsonObject((campaign as any).planningSummary) || {};
      const draft = this.buildComposeDraftFromCampaign(campaign);
      const nextPlanningSummary = {
        ...planningSummary,
        schedulerDraftSnapshot: {
          ...draft,
          preparedAt: now.toISOString(),
          source: 'campaign_scheduler',
        },
      };

      const claimed = await prisma.campaign.updateMany({
        where: {
          id: campaign.id,
          schedulerStatus: 'PENDING' as any,
          scheduledAt: { lte: now },
        },
        data: {
          schedulerStatus: 'READY' as any,
          planningSummary: JSON.stringify(nextPlanningSummary),
        },
      });

      if (claimed.count === 0) return false;

      logActivity({
        workspaceId: DEFAULT_WORKSPACE_ID,
        type: 'campaign',
        entityType: 'campaign',
        entityId: campaign.id,
        campaignId: campaign.id,
        action: 'campaign_scheduler_triggered',
        status: 'success',
        message: `Campaign scheduler triggered for "${campaign.name}"`,
        metadata: {
          scheduledAt: (campaign as any).scheduledAt,
          healthyCount: draft.healthyCount,
          skippedCount: draft.skippedCount,
        },
      });

      logActivity({
        workspaceId: DEFAULT_WORKSPACE_ID,
        type: 'campaign',
        entityType: 'campaign',
        entityId: campaign.id,
        campaignId: campaign.id,
        action: 'campaign_ready_for_execution',
        status: 'success',
        message: `Campaign "${campaign.name}" is ready for manual Compose review`,
        metadata: {
          source: 'campaign_scheduler',
          accountCount: draft.accountIds.length,
          requiresManualStart: true,
        },
      });

      return true;
    } catch (err: any) {
      await prisma.campaign.updateMany({
        where: { id: campaign.id, schedulerStatus: 'PENDING' as any },
        data: { schedulerStatus: 'FAILED' as any },
      });
      logActivity({
        workspaceId: DEFAULT_WORKSPACE_ID,
        type: 'campaign',
        entityType: 'campaign',
        entityId: campaign.id,
        campaignId: campaign.id,
        action: 'campaign_scheduler_failed',
        status: 'failed',
        message: `Campaign scheduler failed for "${campaign.name}"`,
        metadata: {
          error: err.message || String(err),
          scheduledAt: (campaign as any).scheduledAt,
        },
      });
      return false;
    }
  }

  private async _planActions(
    campaignId: string,
    accountIds: string[],
    type: string,
    targetValue: string,
  ): Promise<void> {
    const actions: any[] = [];

    for (const accountId of accountIds) {
      switch (type) {
        case 'follow':
          actions.push({
            campaignId, accountId, actionType: 'follow',
            targetUrl: targetValue, status: 'pending',
          });
          break;

        case 'like':
          actions.push({
            campaignId, accountId, actionType: 'like',
            targetUrl: targetValue, status: 'pending',
          });
          break;

        case 'comment':
          actions.push({
            campaignId, accountId, actionType: 'comment',
            targetUrl: targetValue, status: 'pending',
          });
          break;

        case 'mixed':
          // For mixed campaigns: follow + like + comment
          actions.push({
            campaignId, accountId, actionType: 'follow',
            targetUrl: targetValue, status: 'pending',
          });
          actions.push({
            campaignId, accountId, actionType: 'like',
            targetUrl: targetValue, status: 'pending',
          });
          actions.push({
            campaignId, accountId, actionType: 'comment',
            targetUrl: targetValue, status: 'pending',
          });
          break;

        default:
          actions.push({
            campaignId, accountId, actionType: type,
            targetUrl: targetValue, status: 'pending',
          });
      }
    }

    // Bulk create
    for (const action of actions) {
      await prisma.campaignAction.create({ data: action });
    }
  }

  private async buildPlanningSnapshot(
    accountIds: string[],
    groupIds: string[],
    type: string,
  ): Promise<CampaignPlanSnapshot> {
    const directAccountIds = [...new Set((accountIds || []).filter(Boolean).map(String))];
    const selectedGroupIds = [...new Set((groupIds || []).filter(Boolean).map(String))];
    const accounts = await resolveAccountSelection({ accountIds: directAccountIds, groupIds: selectedGroupIds });
    const healthyAccounts = accounts.filter((account) => sessionHealthService.isPostableHealth(account.sessionHealth));
    const skippedAccounts = accounts
      .filter((account) => !sessionHealthService.isPostableHealth(account.sessionHealth))
      .map((account) => ({
        accountId: account.id,
        username: account.username,
        health: account.sessionHealth || 'UNKNOWN',
        reason: account.sessionHealthReason || 'Session has not been checked or is not healthy',
      }));
    const selectedGroups = await this.getSelectedGroups(selectedGroupIds);
    const actionCount = this.estimateActionCount(healthyAccounts, type);
    const minMinutes = actionCount > 0 ? Math.max(0, actionCount - 1) * 15 : 0;
    const maxMinutes = actionCount > 0 ? Math.max(0, actionCount - 1) * 45 : 0;
    const averageMinutes = actionCount > 0 ? Math.max(0, actionCount - 1) * 30 : 0;

    return {
      selectedGroups,
      directAccountIds,
      resolvedAccountIds: accounts.map((account) => account.id),
      healthyAccountIds: healthyAccounts.map((account) => account.id),
      skippedAccounts,
      totalResolved: accounts.length,
      healthyCount: healthyAccounts.length,
      skippedCount: skippedAccounts.length,
      actionCount,
      estimatedPostingSpreadMinutes: {
        min: minMinutes,
        max: maxMinutes,
        average: averageMinutes,
      },
      estimatedQueueDurationMinutes: averageMinutes,
    };
  }

  private async getSelectedGroups(groupIds: string[]) {
    if (groupIds.length === 0) return [];

    const groups = await prisma.accountGroup.findMany({
      where: {
        id: { in: groupIds },
        workspaceId: DEFAULT_WORKSPACE_ID,
        isArchived: false,
      },
      select: {
        id: true,
        name: true,
        color: true,
        _count: { select: { members: true } },
      },
      orderBy: { name: 'asc' },
    });

    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      color: group.color,
      memberCount: group._count.members,
    }));
  }

  private estimateActionCount(accounts: ResolvedAccountSummary[], type: string): number {
    const actionsPerAccount = type === 'mixed' ? 3 : 1;
    return accounts.length * actionsPerAccount;
  }

  private buildComposeDraftFromCampaign(campaign: any): CampaignComposeDraft {
    const accountIds = parseJsonArray(campaign.accountIds);
    const groupIds = parseJsonArray(campaign.groupIds);
    const planningSummary = parseJsonObject(campaign.planningSummary) || {};
    const aiPlan = planningSummary?.aiPlan as CampaignAiPlan | undefined;
    const healthyCount = Number(planningSummary?.healthyCount ?? accountIds.length);
    const skippedCount = Number(planningSummary?.skippedCount ?? 0);
    const objective = `${campaign.type} ${campaign.targetType} ${campaign.targetValue}`.trim();
    const suggestedHashtags = Array.isArray(aiPlan?.suggestedHashtags) ? aiPlan.suggestedHashtags : [];
    const aiSuggestedCaption = aiPlan
      ? [aiPlan.captionSeed || '', suggestedHashtags.join(' ')].filter(Boolean).join('\n\n')
      : '';
    const suggestedCaption = aiSuggestedCaption || [
      `Campaign: ${campaign.name}`,
      `Objective: ${objective}`,
      `Target: ${campaign.targetValue}`,
    ].join('\n');

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      scheduledAt: campaign.scheduledAt ? new Date(campaign.scheduledAt).toISOString() : null,
      schedulerStatus: campaign.schedulerStatus || 'PENDING',
      objective,
      targetType: campaign.targetType,
      targetValue: campaign.targetValue,
      groupIds,
      accountIds,
      healthyCount,
      skippedCount,
      planningSummary,
      aiPlan,
      suggestedCaption,
      suggestedCTA: aiPlan?.suggestedCta,
      suggestedHashtags,
      contentAngle: aiPlan?.contentAngle,
      tone: aiPlan?.postingTone,
      schedulerDraftSnapshot: planningSummary.schedulerDraftSnapshot,
    };
  }

  private logCampaignPlanningActivity(
    campaignId: string,
    campaignName: string,
    plan: CampaignPlanSnapshot,
    mode: 'created' | 'updated',
  ) {
    logActivity({
      workspaceId: DEFAULT_WORKSPACE_ID,
      type: 'campaign',
      entityType: 'campaign',
      entityId: campaignId,
      campaignId,
      action: mode === 'created' ? 'campaign_created' : 'campaign_updated',
      status: 'success',
      message: `Campaign "${campaignName}" ${mode}`,
      metadata: {
        groupIds: plan.selectedGroups.map((group) => group.id),
        healthyCount: plan.healthyCount,
        skippedCount: plan.skippedCount,
      },
    });

    if (plan.selectedGroups.length > 0) {
      logActivity({
        workspaceId: DEFAULT_WORKSPACE_ID,
        type: 'campaign',
        entityType: 'campaign',
        entityId: campaignId,
        campaignId,
        action: 'groups_assigned',
        status: 'success',
        message: `${plan.selectedGroups.length} group(s) assigned to campaign "${campaignName}"`,
        metadata: { groups: plan.selectedGroups },
      });
    }

    logActivity({
      workspaceId: DEFAULT_WORKSPACE_ID,
      type: 'campaign',
      entityType: 'campaign',
      entityId: campaignId,
      campaignId,
      action: 'campaign_execution_planned',
      status: 'success',
      message: `Campaign "${campaignName}" planned for ${plan.healthyCount} healthy account(s)`,
      metadata: plan,
    });
  }

  /**
   * Process campaign — execute actions with staggered timing.
   */
  private async _processCampaign(campaignId: string): Promise<void> {
    const control = runningCampaigns.get(campaignId);
    if (!control) return;

    try {
      // Get all pending actions
      const pendingActions = await prisma.campaignAction.findMany({
        where: { campaignId, status: 'pending' },
        orderBy: { id: 'asc' },
      });

      console.log(`[Campaign] Processing ${pendingActions.length} pending actions for campaign ${campaignId}`);

      for (const action of pendingActions) {
        // Check if stopped
        if (control.aborted) {
          console.log(`[Campaign] Campaign ${campaignId} aborted`);
          break;
        }

        // Check if paused — wait loop
        while (control.paused && !control.aborted) {
          await new Promise((r) => setTimeout(r, 5000));
        }
        if (control.aborted) break;

        // Wait for active hours
        await HumanBehavior.waitForActiveHours();

        // Mark as running
        await prisma.campaignAction.update({
          where: { id: action.id },
          data: { status: 'running' },
        });

        // Execute the action
        let result: ActionResult;
        try {
          switch (action.actionType) {
            case 'like':
              result = await targetedEngagementService.likePost(action.accountId, action.targetUrl || '');
              break;
            case 'follow':
              result = await targetedEngagementService.followUser(action.accountId, action.targetUrl || '');
              break;
            case 'comment':
              result = await targetedEngagementService.commentOnPost(action.accountId, action.targetUrl || '');
              break;
            case 'follow_and_like':
              result = await targetedEngagementService.followAndLike(action.accountId, action.targetUrl || '');
              break;
            default:
              result = {
                accountId: action.accountId, actionType: action.actionType,
                target: action.targetUrl || '', status: 'failed',
                error: `Unknown action: ${action.actionType}`,
                executedAt: new Date().toISOString(),
              };
          }
        } catch (err: any) {
          result = {
            accountId: action.accountId, actionType: action.actionType,
            target: action.targetUrl || '', status: 'failed',
            error: err.message, executedAt: new Date().toISOString(),
          };
        }

        // Update action status
        await prisma.campaignAction.update({
          where: { id: action.id },
          data: {
            status: result.status,
            result: JSON.stringify(result),
            executedAt: new Date(),
          },
        });

        // Update campaign counters
        if (result.status === 'completed') {
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { completedActions: { increment: 1 } },
          });
        } else if (result.status === 'failed') {
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { failedActions: { increment: 1 } },
          });
        }

        // Stagger delay between accounts (15-45 min)
        const staggerMs = Math.floor(Math.random() * 30 * 60 * 1000) + 15 * 60 * 1000;
        console.log(`[Campaign] Next action in ${Math.round(staggerMs / 60000)} min`);
        await new Promise((r) => setTimeout(r, staggerMs));
      }

      // Campaign complete
      if (!control.aborted) {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: 'completed', completedAt: new Date() },
        });
        console.log(`[Campaign] Campaign ${campaignId} completed`);
      }

    } finally {
      runningCampaigns.delete(campaignId);
    }
  }
}

export const campaignService = new CampaignService();
