/**
 * CaptionSpinnerService
 *
 * Takes a base caption and produces N slightly-different variations using Gemini.
 * Falls back to lightweight local text transformations if no API key is set.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

function getModel() {
  const key = process.env.GEMINI_API_KEY || '';
  if (!key || key === 'dummy_key') return null;
  return new GoogleGenerativeAI(key).getGenerativeModel({ model: 'gemini-1.5-flash' });
}

// ── Local fallback transformations ────────────────────────────────────────
// Synonym banks for common caption words in Indonesian marble/granite niche
const SYNONYMS: Record<string, string[]> = {
  'premium':   ['eksklusif', 'terbaik', 'pilihan', 'unggulan', 'mewah'],
  'mewah':     ['eksklusif', 'premium', 'elegan', 'berkelas', 'indah'],
  'indah':     ['cantik', 'menawan', 'elegan', 'memukau', 'estetis'],
  'kualitas':  ['mutu', 'standar tinggi', 'kelas dunia', 'berkualitas'],
  'terbaik':   ['terpilih', 'unggulan', 'nomor satu', 'premium', 'top'],
  'hunian':    ['rumah', 'tempat tinggal', 'properti', 'kediaman'],
  'hubungi':   ['kontak', 'DM', 'WhatsApp', 'chat'],
  'sekarang':  ['segera', 'hari ini', 'langsung'],
  'penawaran': ['promo', 'harga spesial', 'deal menarik'],
  'material':  ['bahan', 'material alam', 'produk'],
  'natural':   ['alami', 'organik', 'dari alam'],
  'cantik':    ['indah', 'elegan', 'menawan', 'estetis'],
};

const CTA_VARIATIONS = [
  'Hubungi kami sekarang! 📞',
  'DM untuk harga terbaik! 💬',
  'WhatsApp kami hari ini! 📱',
  'Kontak kami untuk konsultasi gratis! 🤝',
  'Order sekarang sebelum kehabisan! ⚡',
  'Chat kami untuk penawaran eksklusif! 💎',
];

const OPENING_VARIATIONS = [
  '✨ ',
  '🏠 ',
  '💎 ',
  '🌟 ',
  '🪨 ',
  '🏛️ ',
  '',
];

function localSpin(caption: string, index: number): string {
  let spun = caption;

  // Replace some synonyms
  for (const [word, syns] of Object.entries(SYNONYMS)) {
    if (spun.toLowerCase().includes(word)) {
      const syn = syns[(index + syns.length) % syns.length];
      spun = spun.replace(new RegExp(word, 'gi'), syn);
    }
  }

  // Vary the CTA at the end
  const cta = CTA_VARIATIONS[index % CTA_VARIATIONS.length];
  const opening = OPENING_VARIATIONS[index % OPENING_VARIATIONS.length];

  // Strip old CTAs, add new one
  spun = spun.replace(/Hubungi.*?!/gi, '').replace(/DM.*?!/gi, '').replace(/WhatsApp.*?!/gi, '').trim();
  spun = `${opening}${spun}\n\n${cta}`;

  return spun;
}

/** Vary the hashtag list slightly per account (shuffle + small additions) */
export function spinHashtags(hashtags: string[], index: number): string {
  const extra = [
    '#marmerputih', '#granitlantai', '#batualamnatural', '#interiorjogja',
    '#interiorjakarta', '#interiorsurabaya', '#interiormedan', '#rumahminimalis',
    '#desainrumah', '#homestyle', '#luxuryhome', '#modernhome',
  ];

  // Shuffle base hashtags deterministically using index as seed
  const shuffled = [...hashtags].sort((a, b) => {
    const h = (s: string) => s.split('').reduce((acc, c) => ((acc * 31 + c.charCodeAt(0)) | 0), index);
    return h(a) - h(b);
  });

  // Add 2-3 extra hashtags from the pool (different per account)
  const extras = extra.slice((index * 3) % extra.length, (index * 3) % extra.length + 3);
  return [...shuffled, ...extras].join(' ');
}

// ── Main spinner ──────────────────────────────────────────────────────────

export interface SpinResult {
  caption: string;
  hashtags: string;
}

/**
 * Generate N caption variations from a base caption.
 * Uses Gemini AI if API key is set, falls back to local synonym replacement.
 */
export async function spinCaptions(
  baseCaption: string,
  baseHashtags: string[],
  count: number,
): Promise<SpinResult[]> {
  const model = getModel();

  if (model) {
    // Try Gemini batch spin
    try {
      const prompt = `
You are a social media caption writer for an Indonesian marble/granite business.
Given this base caption, generate exactly ${count} unique variations.
Each variation must:
- Keep the same meaning and tone
- Use slightly different words, sentence order, or emoji
- Be in Indonesian (Bahasa Indonesia) 
- Not be longer than 300 characters
- NOT include hashtags (they will be added separately)

Base caption:
"${baseCaption.replace(/#\S+/g, '').trim()}"

Return ONLY valid JSON array (no markdown):
["variation1", "variation2", ...]
`.trim();

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/```(?:json)?([\s\S]*?)```/) || [null, text];
      const variations: string[] = JSON.parse(jsonMatch[1]!.trim());

      if (!Array.isArray(variations) || variations.length === 0) throw new Error('Empty response');

      return variations.slice(0, count).map((cap, i) => ({
        caption: cap,
        hashtags: spinHashtags(baseHashtags, i),
      }));
    } catch (err) {
      console.warn('[CaptionSpinner] Gemini failed, falling back to local spin:', err);
    }
  }

  // Local fallback — deterministic synonym replacement
  return Array.from({ length: count }, (_, i) => ({
    caption: localSpin(baseCaption.replace(/#\S+/g, '').trim(), i),
    hashtags: spinHashtags(baseHashtags, i),
  }));
}
