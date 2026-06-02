import { GoogleGenerativeAI } from '@google/generative-ai';
import { localSpin } from './CaptionSpinnerService';
import { cleanEnv, getGeminiApiKey, getGeminiModel, getGeminiVisionModel, isPlaceholderKey } from './GeminiConfig';

interface VisionImageInput {
  base64Data?: string;
  mimeType: string;
  sizeBytes: number;
  source: 'json' | 'multipart' | 'none';
}

interface VisionProviderConfig {
  provider: 'gemini' | 'openai';
  apiKey: string;
  model: string;
}

function isAiAvailable(): boolean {
  return !!getGeminiApiKey();
}

function getGenAI() {
  const key = getGeminiApiKey() || 'dummy_key';
  return new GoogleGenerativeAI(key);
}

function getModel() {
  return getGenAI().getGenerativeModel({ model: getGeminiModel() });
}

function getOpenAiApiKey(): string | undefined {
  const key = cleanEnv(process.env.OPENAI_API_KEY);
  return isPlaceholderKey(key) ? undefined : key;
}

function getVisionProviderConfig(): VisionProviderConfig | undefined {
  const requestedProvider = cleanEnv(process.env.VISION_PROVIDER || process.env.AI_VISION_PROVIDER).toLowerCase();
  const geminiKey = getGeminiApiKey();
  const openAiKey = getOpenAiApiKey();

  if (requestedProvider === 'openai') {
    return openAiKey
      ? { provider: 'openai', apiKey: openAiKey, model: cleanEnv(process.env.OPENAI_VISION_MODEL || process.env.AI_VISION_MODEL) || 'gpt-4o-mini' }
      : undefined;
  }

  if (requestedProvider === 'gemini') {
    return geminiKey
      ? { provider: 'gemini', apiKey: geminiKey, model: getGeminiVisionModel() }
      : undefined;
  }

  if (geminiKey) {
    return {
      provider: 'gemini',
      apiKey: geminiKey,
      model: getGeminiVisionModel(),
    };
  }

  if (openAiKey) {
    return {
      provider: 'openai',
      apiKey: openAiKey,
      model: cleanEnv(process.env.OPENAI_VISION_MODEL || process.env.AI_VISION_MODEL) || 'gpt-4o-mini',
    };
  }

  return undefined;
}

function parseJsonImageInput(imageBase64?: string, imageMimeType: string = 'image/jpeg'): VisionImageInput {
  if (!imageBase64) {
    return { mimeType: imageMimeType, sizeBytes: 0, source: 'none' };
  }

  const headerMatch = imageBase64.match(/^data:([^;]+);base64,/);
  const mimeType = headerMatch?.[1] || imageMimeType || 'image/jpeg';
  const base64Data = imageBase64.split(',')[1] || imageBase64;
  return {
    base64Data,
    mimeType,
    sizeBytes: Buffer.byteLength(base64Data, 'base64'),
    source: 'json',
  };
}

function getFallbackReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown vision error');
}

// ── Fallback captions when Gemini key is not set ───────────────────────────
const FALLBACK_CAPTIONS: Record<string, string[]> = {
  professional: [
    'Marmer premium berkualitas tinggi untuk hunian mewah Anda. Keindahan alam yang tak tertandingi, kini hadir di rumah Anda. ✨ #marmer #granitpremium',
    'Transformasi ruangan Anda dengan granit pilihan terbaik. Material alam tahan lama, estetika tak lekang oleh waktu. 🏛️ #granitindonesia #interiordesign',
    'Investasi terbaik untuk rumah impian Anda — marmer dan granit natural Indonesia. Hubungi kami untuk konsultasi gratis! 📞 #batualam #marmerindonesia',
  ],
  casual: [
    'Guys, rumah lo bakal keliatan mewah banget pake marmer ini! ✨😍 Harga bersahabat, kualitas premium! #marmer #homevibe',
    'Kalau mau lantai kece, granit ini jawabannya bro! 🔥 DM sekarang sebelum kehabisan! #granitindo #renovasirumah',
    'Marmer aesthetic alert!! 🤩 Cocok banget buat interior modern lo. Slide untuk lihat selengkapnya ➡️ #marmeraesthetic #interiorinspo',
  ],
  viral: [
    'POV: Lantai rumah lo jadi sekelas hotel bintang 5 🏨✨ Ini rahasianya → marmer premium dari kami! #fyp #marmer #viral',
    'Kenapa orang kaya selalu pake marmer? Ini jawabannya! 👇 Thread penting untuk hunian impian 🧵 #homedecor #marmer #viralpost',
    'Bongkar rahasia interior mewah yang gak mahal! 🤫 Spoiler: batu alam natural 🪨 #batualam #tipshome #fyp',
  ],
  promotional: [
    '🎉 PROMO AKHIR TAHUN! Diskon 20% untuk semua jenis marmer & granit. Terbatas! Order sekarang sebelum kehabisan. ☎️ DM/WA kami! #promomarmer #diskon',
    '⚡ FLASH SALE 48 JAM! Granit premium harga spesial. Gratis ongkir se-Jabodetabek! 🚚 #flashsale #granitmurah #promohari',
    '✅ STOK TERBATAS! Marmer natural impor kualitas A. Harga langsung dari distributor. Pesan sekarang! 📱 #marmermurah #promolimited',
  ],
}

const FALLBACK_HASHTAGS: Record<string, string[]> = {
  Instagram: ['#marmer','#granit','#batualam','#marmerindonesia','#granitindonesia','#interiordesign','#homedecor','#rumahminimalis','#desainrumah','#marmerputih','#granitlantai','#batualamnatural','#interiorinspiration','#luxuryhome','#homestyle','#renovasirumah','#arsitektur','#designinterior','#rumahidaman','#homedesign','#marmerimport','#granitpremium','#batumalam','#homesweethome','#interiorjogja','#interiorjakarta','#furnituredesign','#minimalisthome','#modernhome','#premiumstone'],
  TikTok: ['#marmer','#granit','#batualam','#fyp','#viral','#fypindonesia','#tiktokindo','#rumahminimalis','#homedesign','#interiordesign','#homedecor','#marmerputih','#granitlantai','#batualamnatural','#marmerindonesia','#renovasirumah','#desainrumah','#rumahidaman','#homeinspo','#luxuryhome','#trendingid','#kontenindonesia','#homevibe','#aesthetic','#homestyle','#bangunanrumah','#arsitektur','#materialrumah','#granitpremium','#premiumstone'],
}

interface VisionAccountStyle {
  id: string;
  username: string;
  platform: string;
  brandTag?: string;
}

export interface VisionCaptionPlanItem {
  accountId: string;
  username: string;
  platform: string;
  style: string;
  imageSummary: string;
  caption: string;
  hashtags: string[];
}

export interface CampaignPlanningInput {
  campaignName: string;
  objective: string;
  targetType: string;
  targetValue: string;
  selectedGroups: { id: string; name: string; memberCount?: number }[];
  healthyAccountCount: number;
}

export interface CampaignContentVariation {
  title: string;
  targetGroupIntent: string;
  visualDirection: string;
  captionAngle: string;
  cta: string;
  suggestedHashtags: string[];
  formatRecommendation: 'single image' | 'carousel' | 'reels';
  priorityScore: number;
}

export interface CampaignAiPlan {
  strategySummary: string;
  contentAngle: string;
  suggestedCta: string;
  suggestedHashtags: string[];
  postingTone: string;
  contentVariations: CampaignContentVariation[];
  captionSeed?: string;
  generatedAt: string;
  source: 'ai' | 'fallback';
  fallbackReason?: string;
}

export class AiService {

  public async generateCaption(topic: string, platforms: string[], language: string = 'Indonesian'): Promise<any> {
    const prompt = `
You are an expert Social Media Manager for a natural stone/marble/granite business in Indonesia.
Topic: "${topic}"
Platforms: ${platforms.join(', ')}
Language: ${language}

Generate exactly ONE highly engaging social media caption per platform. Each caption must:
- Be specific to marble/granite/natural stone niche
- Include relevant emoji
- Have a clear call-to-action
- Be adapted to platform style

Return ONLY valid JSON, no markdown:
{
  "captions": {
    "Instagram": "...",
    "TikTok": "..."
  },
  "hashtags": {
    "Instagram": ["#tag1","#tag2",...30 tags],
    "TikTok": ["#tag1","#tag2",...30 tags]
  }
}`;

    if (!isAiAvailable()) {
      return this.getCaptionFallback(topic, platforms);
    }

    try {
      const model = getModel();
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/```(?:json)?([\s\S]*?)```/) || [null, text];
      return JSON.parse(jsonMatch[1]!.trim());
    } catch {
      return this.getCaptionFallback(topic, platforms);
    }
  }

  private getCaptionFallback(topic: string, platforms: string[]): any {
    const captions: Record<string, string> = {}
    const hashtags: Record<string, string[]> = {}
    platforms.forEach((p, i) => {
      const base = `Temukan keindahan ${topic} premium kami! Material alam berkualitas tinggi untuk hunian mewah Anda. ✨ Hubungi kami sekarang untuk penawaran terbaik! #marmer #granit #batualam`
      captions[p] = localSpin(base, i)
      hashtags[p] = FALLBACK_HASHTAGS[p] || FALLBACK_HASHTAGS['Instagram']
    })
    return { captions, hashtags }
  }

  public async generateBatch(
    topic: string,
    platform: string,
    tone: string,
    count: number = 7,
    niche: string = 'Marmer & Granit Indonesia',
  ): Promise<{ captions: string[]; hashtags: string[] }> {
    const toneDesc: Record<string, string> = {
      professional: 'professional, authoritative, business-like, formal',
      casual: 'casual, friendly, conversational, relatable',
      viral: 'viral, trendy, hook-driven, POV-style, provocative curiosity',
      promotional: 'promotional, offer-driven, urgency, CTA-heavy',
    }

    const prompt = `
You are an expert Social Media Manager for a "${niche}" business in Indonesia.
Topic: "${topic}"
Platform: ${platform}
Tone: ${toneDesc[tone] || 'casual'}
Language: Indonesian (Bahasa Indonesia) with occasional English words

Generate exactly ${count} unique captions. Each must:
- Be different in angle/hook/style
- Include relevant emoji
- End with a clear CTA
- Be optimized for ${platform} algorithm
- Be specific to marble/granite/natural stone niche in Indonesia

Also generate 30 relevant hashtags for this niche.

Return ONLY valid JSON:
{
  "captions": ["caption1", "caption2", ...${count} total],
  "hashtags": ["#tag1", "#tag2", ...30 total]
}`;

    if (!isAiAvailable()) {
      return this.getBatchFallback(platform, tone, count);
    }

    try {
      const model = getModel();
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/```(?:json)?([\s\S]*?)```/) || [null, text];
      return JSON.parse(jsonMatch[1]!.trim());
    } catch {
      return this.getBatchFallback(platform, tone, count);
    }
  }

  private getBatchFallback(platform: string, tone: string, count: number): { captions: string[]; hashtags: string[] } {
    const toneKey = (tone in FALLBACK_CAPTIONS) ? tone : 'casual'
    const baseCaptions = FALLBACK_CAPTIONS[toneKey]
    const captions: string[] = []
    for (let i = 0; i < count; i++) {
      captions.push(baseCaptions[i % baseCaptions.length])
    }
    return {
      captions,
      hashtags: FALLBACK_HASHTAGS[platform] || FALLBACK_HASHTAGS['Instagram'],
    }
  }

  public async suggestBestPostingTime(niche: string, platform: string): Promise<string[]> {
    const prompt = `Based on Indonesian social media analytics, suggest the top 3 best posting times on ${platform} for "${niche}" niche. Return strictly as JSON array: ["09:00 WIB", "12:00 WIB", "20:00 WIB"]`;
    
    if (!isAiAvailable()) {
      return ['07:00 WIB', '12:00 WIB', '20:00 WIB'];
    }

    try {
      const model = getModel();
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/```(?:json)?([\s\S]*?)```/) || [null, text];
      return JSON.parse(jsonMatch[1]!.trim());
    } catch {
      return ['07:00 WIB', '12:00 WIB', '20:00 WIB'];
    }
  }

  /**
   * Generates a single, engaging caption for a specific assignment row.
   * Can optionally take an image (base64) for visual context.
   */
  public async generateAssignmentCaption(niche: string, platform: string = 'Instagram', imageBase64?: string): Promise<string> {
    const prompt = `
You are a social media expert for a natural stone business in Indonesia.
Niche: ${niche} (marmer/granit/batu alam)
Platform: ${platform}
Language: Indonesian (Bahasa Indonesia) mixed with some English words (cool/trending style).
Style: Engaging, friendly, not too formal, use emoji.

Task: Generate ONE unique, short, and punchy caption for this post. 
If an image is provided, describe what you see in a way that sells the product (luxury, texture, gloss, etc.).
Include a call to action.

Return ONLY the caption text, no JSON, no quotes.`;

    if (!isAiAvailable()) {
      return this.getAssignmentFallback(niche);
    }

    try {
      const model = getModel();
      let result;

      if (imageBase64) {
        // Handle base64 image data (strip header if present)
        const base64Data = imageBase64.split(',')[1] || imageBase64;
        result = await model.generateContent([
          prompt,
          {
            inlineData: {
              data: base64Data,
              mimeType: 'image/jpeg' // Assume jpeg for now, or detect from header
            }
          }
        ]);
      } else {
        result = await model.generateContent(prompt);
      }

      return result.response.text().trim();
    } catch {
      return this.getAssignmentFallback(niche);
    }
  }

  private getAssignmentFallback(niche: string): string {
    const base = `Kualitas ${niche} terbaik untuk hunian Anda. ✨ Hubungi kami sekarang untuk penawaran spesial! #marmer #granit`;
    return localSpin(base, Math.floor(Math.random() * 10));
  }
  public async generateCampaignPlan(input: CampaignPlanningInput): Promise<CampaignAiPlan> {
    const prompt = `
You are a social media campaign planner for an Indonesian natural stone, marble, and granite business.

Create lightweight planning guidance only. Do not create final captions and do not suggest automation.

Campaign:
- Name: ${input.campaignName}
- Objective: ${input.objective}
- Target: ${input.targetType} ${input.targetValue}
- Selected groups: ${input.selectedGroups.map((group) => `${group.name} (${group.memberCount ?? 0} accounts)`).join(', ') || 'None'}
- Healthy account count: ${input.healthyAccountCount}

Return ONLY valid JSON:
{
  "strategySummary": "2 short sentences",
  "contentAngle": "one practical content angle",
  "suggestedCta": "one CTA",
  "suggestedHashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "postingTone": "tone suggestion",
  "contentVariations": [
    {
      "title": "short variation title",
      "targetGroupIntent": "which selected group or cluster this idea fits and why",
      "visualDirection": "planning-only visual direction, no image generation",
      "captionAngle": "caption concept, not final caption",
      "cta": "CTA for this variation",
      "suggestedHashtags": ["#tag1", "#tag2", "#tag3"],
      "formatRecommendation": "single image or carousel or reels",
      "priorityScore": 1-100
    }
  ],
  "captionSeed": "optional caption seed, not final copy"
}`;

    if (!isAiAvailable()) {
      return this.getCampaignPlanFallback(input, 'AI provider unavailable');
    }

    try {
      const model = getModel();
      const result = await this.withTimeout(model.generateContent(prompt), 15000);
      const text = result.response.text();
      const jsonMatch = text.match(/```(?:json)?([\s\S]*?)```/) || [null, text];
      const parsed = JSON.parse(jsonMatch[1]!.trim());
      return this.normalizeCampaignPlan(parsed, 'ai');
    } catch (error) {
      return this.getCampaignPlanFallback(input, getFallbackReason(error));
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(`AI request timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private normalizeCampaignPlan(raw: any, source: 'ai' | 'fallback', fallbackReason?: string): CampaignAiPlan {
    const hashtags = Array.isArray(raw?.suggestedHashtags)
      ? raw.suggestedHashtags
      : String(raw?.suggestedHashtags || '').split(/\s+/).filter(Boolean);

    return {
      strategySummary: String(raw?.strategySummary || 'Focus the campaign on a clear product benefit and keep the message consistent across accounts.'),
      contentAngle: String(raw?.contentAngle || 'Show the material as a practical upgrade for premium interiors.'),
      suggestedCta: String(raw?.suggestedCta || 'DM untuk konsultasi material dan penawaran terbaik.'),
      suggestedHashtags: (hashtags.length ? hashtags : FALLBACK_HASHTAGS.Instagram).slice(0, 12),
      postingTone: String(raw?.postingTone || 'Professional, visual, and consultative.'),
      contentVariations: this.normalizeContentVariations(raw?.contentVariations),
      captionSeed: raw?.captionSeed ? String(raw.captionSeed) : undefined,
      generatedAt: new Date().toISOString(),
      source,
      ...(fallbackReason ? { fallbackReason } : {}),
    };
  }

  private normalizeContentVariations(raw: any): CampaignContentVariation[] {
    const variations = Array.isArray(raw) ? raw : [];
    if (variations.length === 0) {
      return [{
        title: 'Core campaign concept',
        targetGroupIntent: 'General healthy account cluster for the selected campaign target.',
        visualDirection: 'Use a clean product-focused visual that shows material texture and finish.',
        captionAngle: 'Connect the material benefit to a practical interior or project outcome.',
        cta: 'DM untuk konsultasi material.',
        suggestedHashtags: FALLBACK_HASHTAGS.Instagram.slice(0, 8),
        formatRecommendation: 'single image',
        priorityScore: 70,
      }];
    }
    return variations.slice(0, 6).map((item, index) => {
      const hashtags = Array.isArray(item?.suggestedHashtags)
        ? item.suggestedHashtags
        : String(item?.suggestedHashtags || '').split(/\s+/).filter(Boolean);
      const rawFormat = String(item?.formatRecommendation || '').toLowerCase();
      const formatRecommendation = rawFormat.includes('reel')
        ? 'reels'
        : rawFormat.includes('carousel')
          ? 'carousel'
          : 'single image';
      const priorityScore = Number(item?.priorityScore);

      return {
        title: String(item?.title || `Content variation ${index + 1}`),
        targetGroupIntent: String(item?.targetGroupIntent || 'General healthy account cluster.'),
        visualDirection: String(item?.visualDirection || 'Use a clear product-focused visual with natural stone texture.'),
        captionAngle: String(item?.captionAngle || 'Emphasize premium material quality and practical design value.'),
        cta: String(item?.cta || item?.suggestedCta || 'DM untuk konsultasi material.'),
        suggestedHashtags: (hashtags.length ? hashtags : FALLBACK_HASHTAGS.Instagram).slice(0, 10),
        formatRecommendation,
        priorityScore: Number.isFinite(priorityScore) ? Math.max(1, Math.min(100, Math.round(priorityScore))) : 70,
      };
    });
  }

  private getCampaignPlanFallback(input: CampaignPlanningInput, fallbackReason: string): CampaignAiPlan {
    const target = `${input.targetType} ${input.targetValue}`.trim();
    const groupVariations = input.selectedGroups.length > 0
      ? input.selectedGroups.slice(0, 4).map((group, index) => ({
          title: `${group.name} material focus`,
          targetGroupIntent: `Tailor this idea for ${group.name} with ${group.memberCount ?? 0} account(s) in the group.`,
          visualDirection: 'Show close-up texture, installed surface detail, and a clean room context.',
          captionAngle: 'Connect material quality with a concrete room upgrade benefit.',
          cta: 'DM untuk konsultasi material dan rekomendasi motif.',
          suggestedHashtags: ['#marmer', '#granit', '#batualam', '#interiordesign', '#materialpremium'],
          formatRecommendation: index % 2 === 0 ? 'carousel' : 'single image',
          priorityScore: Math.max(60, 90 - (index * 8)),
        }))
      : [];
    const defaultVariations = [
      {
        title: 'Premium texture showcase',
        targetGroupIntent: 'Best for accounts focused on product quality and interior inspiration.',
        visualDirection: 'Use a sharp close-up of stone veins, polished finish, and edge detail.',
        captionAngle: 'Frame the material as a long-term upgrade for elegant interiors.',
        cta: 'DM untuk cek stok dan konsultasi motif.',
        suggestedHashtags: ['#marmer', '#granit', '#batualam', '#luxuryhome', '#interiordesign'],
        formatRecommendation: 'single image',
        priorityScore: 86,
      },
      {
        title: 'Project inspiration carousel',
        targetGroupIntent: 'Best for broader clusters that need education before inquiry.',
        visualDirection: 'Plan a before/detail/application sequence without generating assets.',
        captionAngle: 'Explain where the material fits and why it improves the room.',
        cta: 'Kirim ukuran area untuk estimasi kebutuhan material.',
        suggestedHashtags: ['#desaininterior', '#rumahminimalis', '#marmerindonesia', '#granitindonesia'],
        formatRecommendation: 'carousel',
        priorityScore: 78,
      },
    ];
    return this.normalizeCampaignPlan({
      strategySummary: `Use "${input.campaignName}" to align ${input.healthyAccountCount} healthy account(s) around one clear target: ${target}. Keep posts focused on product trust, material quality, and consultation intent.`,
      contentAngle: 'Highlight natural stone texture, durability, and how the material upgrades residential or commercial spaces.',
      suggestedCta: 'DM untuk konsultasi material, stok, dan estimasi kebutuhan project.',
      suggestedHashtags: ['#marmer', '#granit', '#batualam', '#interiordesign', '#rumahminimalis', '#marmerindonesia'],
      postingTone: input.healthyAccountCount > 5 ? 'Consistent, professional, and locally relevant.' : 'Personal, consultative, and direct.',
      contentVariations: groupVariations.length ? groupVariations : defaultVariations,
      captionSeed: `Material premium untuk tampilan ruang yang lebih elegan. Target campaign: ${target}.`,
    }, 'fallback', fallbackReason);
  }

  public async generateVisionCaptionPlan(
    accounts: VisionAccountStyle[],
    imageBase64OrInput?: string | VisionImageInput,
    imageMimeType: string = 'image/jpeg',
  ): Promise<{ plans: VisionCaptionPlanItem[] }> {
    const safeAccounts = accounts.slice(0, 20).map((account) => ({
      id: account.id,
      username: account.username,
      platform: account.platform || 'Instagram',
      brandTag: account.brandTag || 'natural_stone',
    }));

    if (safeAccounts.length === 0) {
      return { plans: [] };
    }

    const imageInput = typeof imageBase64OrInput === 'object'
      ? imageBase64OrInput
      : parseJsonImageInput(imageBase64OrInput, imageMimeType);

    console.info(
      `[AiService][Vision] image received size=${imageInput.sizeBytes} bytes type=${imageInput.mimeType} source=${imageInput.source}`,
    );

    if (!imageInput.base64Data) {
      console.warn('[AiService][Vision] fallback trigger reason: no image payload received');
      return this.getVisionCaptionPlanFallback(safeAccounts);
    }

    const providerConfig = getVisionProviderConfig();
    if (!providerConfig) {
      const requestedProvider = cleanEnv(process.env.VISION_PROVIDER || process.env.AI_VISION_PROVIDER) || 'auto';
      console.info(`[AiService][Vision] model used provider=none model=none requestedProvider=${requestedProvider}`);
      console.warn(`[AiService][Vision] fallback trigger reason: no valid Gemini/OpenAI vision API key loaded provider=${requestedProvider}`);
      return this.getVisionCaptionPlanFallback(safeAccounts);
    }

    console.info(`[AiService][Vision] model used provider=${providerConfig.provider} model=${providerConfig.model}`);

    const prompt = `
You are an AI Vision Caption Generator for an Indonesian natural stone business.

Analyze the uploaded image first. Then create planning-only caption previews for each account.

Accounts:
${JSON.stringify(safeAccounts, null, 2)}

Rules:
- Return one unique caption plan per account.
- Match each account style using username, platform, and brandTag.
- Caption language: Indonesian with natural marketing tone.
- Instagram captions should feel polished and visual.
- TikTok captions should be short, hook-driven, and casual.
- Mention visual details from the image when possible.
- Include 8 to 15 relevant hashtags per account.
- Do not suggest posting, scheduling, or automation steps.

Return ONLY valid JSON:
{
  "plans": [
    {
      "accountId": "account id",
      "username": "username",
      "platform": "Instagram or TikTok",
      "style": "short account style label",
      "imageSummary": "one sentence image observation",
      "caption": "caption text only",
      "hashtags": ["#tag1", "#tag2"]
    }
  ]
}`;

    try {
      const text = providerConfig.provider === 'gemini'
        ? await this.callGeminiVision(providerConfig, prompt, imageInput)
        : await this.callOpenAiVision(providerConfig, prompt, imageInput);
      const jsonMatch = text.match(/```(?:json)?([\s\S]*?)```/) || [null, text];
      const parsed = JSON.parse(jsonMatch[1]!.trim());

      return {
        plans: this.normalizeVisionPlans(parsed?.plans, safeAccounts),
      };
    } catch (error) {
      console.error(`[AiService][Vision] fallback trigger reason: ${getFallbackReason(error)}`);
      return this.getVisionCaptionPlanFallback(safeAccounts);
    }
  }

  public buildVisionImageInputFromBuffer(buffer: Buffer, mimeType?: string): VisionImageInput {
    return {
      base64Data: buffer.toString('base64'),
      mimeType: mimeType || 'image/jpeg',
      sizeBytes: buffer.length,
      source: 'multipart',
    };
  }

  private async callGeminiVision(config: VisionProviderConfig, prompt: string, imageInput: VisionImageInput): Promise<string> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: imageInput.mimeType,
                  data: imageInput.base64Data,
                },
              },
            ],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        }),
      },
    );
    console.info(`[AiService][Vision] API response status provider=gemini status=${response.status}`);

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Gemini API returned ${response.status}: ${body.slice(0, 500)}`);
    }

    const parsed = JSON.parse(body);
    const text = parsed?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('').trim();
    if (!text) {
      throw new Error(`Gemini API returned no text content: ${body.slice(0, 500)}`);
    }
    return text;
  }

  private async callOpenAiVision(config: VisionProviderConfig, prompt: string, imageInput: VisionImageInput): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${imageInput.mimeType};base64,${imageInput.base64Data}`,
              },
            },
          ],
        }],
      }),
    });
    console.info(`[AiService][Vision] API response status provider=openai status=${response.status}`);

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI API returned ${response.status}: ${body.slice(0, 500)}`);
    }

    const parsed = JSON.parse(body);
    const text = parsed?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error(`OpenAI API returned no message content: ${body.slice(0, 500)}`);
    }
    return text;
  }

  private normalizeVisionPlans(plans: any[], accounts: VisionAccountStyle[]): VisionCaptionPlanItem[] {
    const planList = Array.isArray(plans) ? plans : [];
    return accounts.map((account, index) => {
      const plan = planList.find((item) => item?.accountId === account.id) || planList[index] || {};
      const platform = account.platform || plan.platform || 'Instagram';
      const hashtags = Array.isArray(plan.hashtags)
        ? plan.hashtags
        : String(plan.hashtags || '').split(/\s+/).filter(Boolean);

      return {
        accountId: account.id,
        username: account.username,
        platform,
        style: String(plan.style || this.describeAccountStyle(account)),
        imageSummary: String(plan.imageSummary || 'Visual produk batu alam siap dijadikan materi caption.'),
        caption: String(plan.caption || this.buildVisionFallbackCaption(account, index)),
        hashtags: (hashtags.length ? hashtags : FALLBACK_HASHTAGS[platform] || FALLBACK_HASHTAGS['Instagram']).slice(0, 15),
      };
    });
  }

  private getVisionCaptionPlanFallback(accounts: VisionAccountStyle[]): { plans: VisionCaptionPlanItem[] } {
    return {
      plans: accounts.map((account, index) => {
        const platform = account.platform || 'Instagram';
        return {
          accountId: account.id,
          username: account.username,
          platform,
          style: this.describeAccountStyle(account),
          imageSummary: 'AI vision is unavailable, so this preview uses account style and niche context.',
          caption: this.buildVisionFallbackCaption(account, index),
          hashtags: (FALLBACK_HASHTAGS[platform] || FALLBACK_HASHTAGS['Instagram']).slice(0, 12),
        };
      }),
    };
  }

  private describeAccountStyle(account: VisionAccountStyle): string {
    const brand = (account.brandTag || 'natural_stone').replace(/brand_/g, '').replace(/_/g, ' ');
    return `${account.platform || 'Instagram'} ${brand}`;
  }

  private buildVisionFallbackCaption(account: VisionAccountStyle, index: number): string {
    const brand = (account.brandTag || 'batu alam premium').replace(/brand_/g, '').replace(/_/g, ' ');
    const base = account.platform === 'TikTok'
      ? `POV: detail ${brand} bikin ruangan langsung naik kelas. Tekstur natural, look premium, siap jadi inspirasi project kamu. DM untuk konsultasi.`
      : `Detail ${brand} pilihan untuk tampilan interior yang lebih elegan. Tekstur naturalnya memberi kesan mewah, rapi, dan timeless untuk hunian maupun project komersial. Hubungi kami untuk konsultasi material.`;
    return localSpin(base, index);
  }
}

export const aiService = new AiService();
