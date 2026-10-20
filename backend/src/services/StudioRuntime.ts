import { PrismaClient } from '@prisma/client';
import { createStudioRouter, type StudioDependencies } from '../routes/studioDraftRoutes';
import { workspaceBrands } from '../routes/seoRoutes';
import { seoRequest } from './SeoWorkerService';

const prisma = new PrismaClient();
export function studioDependencies(): StudioDependencies { return {
  workspaces: userId => prisma.workspace.findMany({
    where: userId === null ? {} : { users: { some: { userId } } },
    select: { id: true, name: true }, orderBy: { createdAt: 'asc' },
  }),
  brands: workspaceBrands,
  competitorFinding: async (workspace, brandKey, competitorId, scanId, findingId) => {
    const response = await seoRequest(`/competitors/${encodeURIComponent(competitorId)}/findings?scan_id=${encodeURIComponent(scanId)}`, workspace);
    if (!response.ok) return null;
    const result = await response.json() as any;
    const competitor = result?.competitor;
    if (!competitor || competitor.workspace_id !== workspace || competitor.brand_key !== brandKey) return null;
    const rows = Array.isArray(result.findings) ? result.findings : [];
    const finding = rows.find((item: any) => String(item.id) === findingId && String(item.competitor_id) === competitorId && String(item.scan_id) === scanId && item.brand_key === brandKey);
    return finding ? { competitor, finding } : null;
  },
  drafts: prisma.draft,
  // Existence check only: the Studio store never creates or mutates posts.
  posts: prisma.post,
}; }
export const studioRouter = createStudioRouter(studioDependencies());
