import { PrismaClient } from '@prisma/client';
import { createStudioRouter, type StudioDependencies } from '../routes/studioDraftRoutes';
import { workspaceBrands } from '../routes/seoRoutes';

const prisma = new PrismaClient();
export function studioDependencies(): StudioDependencies { return {
  workspaces: userId => prisma.workspace.findMany({
    where: userId === null ? {} : { users: { some: { userId } } },
    select: { id: true, name: true }, orderBy: { createdAt: 'asc' },
  }),
  brands: workspaceBrands,
  drafts: prisma.draft,
}; }
export const studioRouter = createStudioRouter(studioDependencies());
