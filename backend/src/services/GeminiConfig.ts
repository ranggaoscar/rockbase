export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

export function cleanEnv(value?: string): string {
  return (value || '').trim().replace(/^["']|["']$/g, '');
}

export function isPlaceholderKey(value?: string): boolean {
  const key = cleanEnv(value);
  if (!key) return true;

  const lower = key.toLowerCase();
  return [
    'dummy_key',
    'dummy_key_for_now',
    'your_key_here',
    'your_gemini_api_key_here',
    'your_openai_api_key_here',
  ].some((placeholder) => lower === placeholder || lower.includes(placeholder));
}

export function getGeminiApiKey(): string | undefined {
  const key = cleanEnv(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  return isPlaceholderKey(key) ? undefined : key;
}

function normalizeGeminiModel(model?: string): string {
  const value = cleanEnv(model);
  if (!value || value === 'gemini-1.5-flash') return DEFAULT_GEMINI_MODEL;
  return value;
}

export function getGeminiModel(): string {
  return normalizeGeminiModel(process.env.GEMINI_MODEL || process.env.GEMINI_VISION_MODEL || process.env.AI_VISION_MODEL);
}

export function getGeminiVisionModel(): string {
  return normalizeGeminiModel(process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || process.env.AI_VISION_MODEL);
}
