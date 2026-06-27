import { GoogleGenerativeAI } from '@google/generative-ai';

function getGenAI() {
  const key = process.env.GEMINI_API_KEY || 'dummy_key';
  return new GoogleGenerativeAI(key);
}

function getModel() {
  return getGenAI().getGenerativeModel({ model: 'gemini-1.5-flash' });
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

    try {
      const model = getModel();
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/```(?:json)?([\s\S]*?)```/) || [null, text];
      return JSON.parse(jsonMatch[1]!.trim());
    } catch {
      // Fallback for missing/invalid API key
      const captions: Record<string, string> = {}
      const hashtags: Record<string, string[]> = {}
      platforms.forEach(p => {
        captions[p] = `Temukan keindahan ${topic} premium kami! Material alam berkualitas tinggi untuk hunian mewah Anda. ✨ Hubungi kami sekarang untuk penawaran terbaik! #marmer #granit #batualam`
        hashtags[p] = FALLBACK_HASHTAGS[p] || FALLBACK_HASHTAGS['Instagram']
      })
      return { captions, hashtags }
    }
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

    try {
      const model = getModel();
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/```(?:json)?([\s\S]*?)```/) || [null, text];
      return JSON.parse(jsonMatch[1]!.trim());
    } catch {
      // Fallback
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
  }

  public async suggestBestPostingTime(niche: string, platform: string): Promise<string[]> {
    const prompt = `Based on Indonesian social media analytics, suggest the top 3 best posting times on ${platform} for "${niche}" niche. Return strictly as JSON array: ["09:00 WIB", "12:00 WIB", "20:00 WIB"]`;
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
}

export const aiService = new AiService();
