export interface CampaignEngineBrief {
  campaignName: string;
  materialCategory: string;
  mainColor: string;
  materials: string[];
  goal: string;
  targetAudience: string[];
  periodStart: string;
  periodEnd: string;
  accountCount: number;
  clusterCount: number;
  cta: string;
  brandTone: string;
}

export interface CampaignEngineClusterPlan {
  clusterNumber: number;
  clusterName: string;
  accountRange: string;
  targetAudience: string;
  primaryMaterial: string;
  contentAngle: string;
  suggestedFormat: string;
  captionDrafts: string[];
  hashtagSet: string[];
  visualBrief: string;
  postingSchedule: {
    window: string;
    postsPerWeek: number;
    recommendedDays: string[];
  };
}

export interface CampaignEnginePlan {
  campaignSummary: {
    campaignName: string;
    materialCategory: string;
    mainColor: string;
    goal: string;
    period: {
      start: string;
      end: string;
    };
    accountCount: number;
    clusterCount: number;
    brandTone: string;
  };
  clusters: CampaignEngineClusterPlan[];
  safetyNotes: string[];
  nextActionRecommendation: string;
}

const CONTENT_ANGLES = [
  'material education and buyer confidence',
  'premium interior inspiration',
  'stock availability and project readiness',
  'contractor-friendly specification guidance',
  'before-after renovation positioning',
  'color matching for modern homes',
  'maintenance and long-term value',
  'limited promo reminder without hard selling',
];

const CONTENT_FORMATS = [
  'carousel: 5 slides with material details and CTA',
  'single image: polished slab highlight with short caption',
  'reel: showroom walk-through with text overlays',
  'story sequence: poll, stock preview, WhatsApp CTA',
  'carousel: room moodboard plus material recommendation',
];

const RECOMMENDED_DAYS = [
  ['Monday', 'Wednesday', 'Friday'],
  ['Tuesday', 'Thursday', 'Saturday'],
  ['Monday', 'Thursday', 'Sunday'],
  ['Wednesday', 'Friday', 'Saturday'],
];

function normalizePositiveInteger(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

function buildHashtags(brief: CampaignEngineBrief, material: string, audience: string): string[] {
  const materialTag = material.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  const colorTag = brief.mainColor.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  const audienceTag = audience.replace(/[^a-z0-9]+/gi, '').toLowerCase();

  return [
    '#marmer',
    '#granit',
    `#${materialTag}`,
    `#${colorTag}`,
    `#${brief.materialCategory.toLowerCase()}`,
    `#${audienceTag}`,
    '#interiorrumah',
    '#materialpremium',
    '#batualam',
    '#desaininterior',
  ];
}

function buildCaptionDrafts(
  brief: CampaignEngineBrief,
  material: string,
  audience: string,
  angle: string,
): string[] {
  return [
    `${brief.campaignName}: ${material} warna ${brief.mainColor} untuk ${audience}. Fokus konten: ${angle}. ${brief.cta}`,
    `${material} cocok untuk proyek yang butuh tampilan ${brief.mainColor.toLowerCase()} premium dan rapi. Simpan referensi ini sebelum memilih material. ${brief.cta}`,
    `Untuk ${audience}, pilihan ${brief.materialCategory.toLowerCase()} seperti ${material} bisa membantu ruang terlihat lebih solid, elegan, dan mudah dipadukan. ${brief.cta}`,
  ];
}

export class CampaignEnginePlannerService {
  public generatePlan(rawBrief: CampaignEngineBrief): CampaignEnginePlan {
    const clusterCount = normalizePositiveInteger(rawBrief.clusterCount, 20, 100);
    const accountCount = normalizePositiveInteger(rawBrief.accountCount, clusterCount, 10000);
    const materials = rawBrief.materials?.length ? rawBrief.materials : [rawBrief.materialCategory];
    const audiences = rawBrief.targetAudience?.length ? rawBrief.targetAudience : ['homeowner'];
    const accountsPerCluster = Math.ceil(accountCount / clusterCount);

    const clusters: CampaignEngineClusterPlan[] = Array.from({ length: clusterCount }, (_, index) => {
      const clusterNumber = index + 1;
      const material = materials[index % materials.length];
      const audience = audiences[index % audiences.length];
      const angle = CONTENT_ANGLES[index % CONTENT_ANGLES.length];
      const format = CONTENT_FORMATS[index % CONTENT_FORMATS.length];
      const startAccount = index * accountsPerCluster + 1;
      const endAccount = Math.min((index + 1) * accountsPerCluster, accountCount);
      const scheduleDays = RECOMMENDED_DAYS[index % RECOMMENDED_DAYS.length];

      return {
        clusterNumber,
        clusterName: `Cluster ${clusterNumber}: ${material} for ${audience}`,
        accountRange: `Account ${startAccount}-${endAccount}`,
        targetAudience: audience,
        primaryMaterial: material,
        contentAngle: angle,
        suggestedFormat: format,
        captionDrafts: buildCaptionDrafts(rawBrief, material, audience, angle),
        hashtagSet: buildHashtags(rawBrief, material, audience),
        visualBrief: `Show ${material} in ${rawBrief.mainColor} tones with clean lighting, premium stone texture, practical room context, and no crowded promo text.`,
        postingSchedule: {
          window: `${rawBrief.periodStart} to ${rawBrief.periodEnd}`,
          postsPerWeek: 3,
          recommendedDays: scheduleDays,
        },
      };
    });

    return {
      campaignSummary: {
        campaignName: rawBrief.campaignName,
        materialCategory: rawBrief.materialCategory,
        mainColor: rawBrief.mainColor,
        goal: rawBrief.goal,
        period: {
          start: rawBrief.periodStart,
          end: rawBrief.periodEnd,
        },
        accountCount,
        clusterCount,
        brandTone: rawBrief.brandTone,
      },
      clusters,
      safetyNotes: [
        'Planning only: no posting, liking, following, commenting, or scrolling is executed.',
        'Review captions manually before publishing to avoid repetitive wording across accounts.',
        'Use staggered posting windows and rotate formats to reduce duplicate-content patterns.',
        'Keep WhatsApp CTA helpful and informational rather than aggressive.',
      ],
      nextActionRecommendation: 'Review the cluster matrix, edit weak captions, then approve a future scheduling phase after manual validation.',
    };
  }
}

export const campaignEnginePlannerService = new CampaignEnginePlannerService();
