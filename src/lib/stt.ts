// Speech-to-text vrstva.
// Primarny: ElevenLabs Scribe (auto-detekcia jazyka, zvlada mix SK+EN).
// Fallback: OpenAI Whisper.
//
// POZOR na limity Cloudflare Workers:
//  - subor sa cely nacita do pamate (limit 128 MB)
//  - synchronne STT volanie ma ~100 s strop na strane providera
// Pre nahravky nad cca 4 MB potrebujes async/webhook cestu alebo sekanie na
// kusy. Starter to riesi jednoducho: velke subory odmietne s jasnou hlaskou.

export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

// Frazy, ktore STT modely halucinuju na tichu alebo sume.
const HALLUCINATIONS = [
  'dakujem za pozornost', 'dakujem', 'thank you for watching',
  'thanks for watching', 'thank you', 'subscribe', 'like and subscribe',
  'subtitles by', 'music', 'silence', 'you', 'bye', 'goodbye',
  'dovidenia', 'koniec', 'the end',
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function cleanHallucinations(text: string): string {
  if (!text || !text.trim()) return '';
  let cleaned = text.trim();
  const lower = cleaned.toLowerCase();
  for (const p of HALLUCINATIONS) {
    if (lower === p || lower === p + '.') return '';
  }
  for (const p of HALLUCINATIONS) {
    cleaned = cleaned.replace(new RegExp(`\\s*${escapeRegex(p)}[.!?]*\\s*$`, 'gi'), '');
  }
  return cleaned.trim();
}

// Nahravka v cudzom pisme (arabcina, CJK, cyrilika) na SK/EN vstupe je takmer
// vzdy halucinacia z ticha. Pocitame len pismena.
export function isGibberish(text: string): boolean {
  if (!text) return false;
  let latin = 0;
  let foreign = 0;
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    if ((ch.codePointAt(0) ?? 0) <= 0x024f) latin++;
    else foreign++;
  }
  const total = latin + foreign;
  if (total < 12) return false;
  return foreign / total > 0.5;
}

export function mimeFromKey(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    m4a: 'audio/mp4', mp4: 'audio/mp4', flac: 'audio/flac',
    webm: 'audio/webm', opus: 'audio/opus',
  };
  return map[ext] || 'audio/mpeg';
}

export interface STTResult {
  ok: boolean;
  text?: string;
  duration?: number | null;
  error?: string;
}

export async function tryElevenLabs(
  audio: ArrayBuffer, key: string, apiKey: string
): Promise<STTResult> {
  try {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mimeFromKey(key) }), key.split('/').pop() || 'audio.webm');
    form.append('model_id', 'scribe_v1');
    // Bez language_code -> Scribe si jazyk deteguje sam a zvlada mix jazykov
    // v jednej nahravke. Vnuteny jazyk by cudzojazycne casti skomolil.

    const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
      signal: AbortSignal.timeout(110_000),
    });

    if (!resp.ok) {
      return { ok: false, error: `ElevenLabs ${resp.status}: ${await resp.text()}` };
    }
    const data = await resp.json() as { text?: string; audio_duration?: number };
    return { ok: true, text: data.text || '', duration: data.audio_duration ?? null };
  } catch (e: unknown) {
    return { ok: false, error: `ElevenLabs: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}

export async function tryWhisper(
  audio: ArrayBuffer, key: string, apiKey: string
): Promise<STTResult> {
  try {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mimeFromKey(key) }), key.split('/').pop() || 'audio.webm');
    form.append('model', 'whisper-1');

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(110_000),
    });

    if (!resp.ok) {
      return { ok: false, error: `Whisper ${resp.status}: ${await resp.text()}` };
    }
    const data = await resp.json() as { text?: string; duration?: number };
    return { ok: true, text: data.text || '', duration: data.duration ?? null };
  } catch (e: unknown) {
    return { ok: false, error: `Whisper: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}

// ElevenLabs primarne, Whisper ako zachrana. Ak nie je nastaveny ziadny kluc,
// vratime chybu - fail closed, nie ticho prazdny prepis.
export async function transcribe(
  audio: ArrayBuffer,
  key: string,
  env: { ELEVENLABS_API_KEY?: string; OPENAI_API_KEY?: string }
): Promise<STTResult> {
  if (env.ELEVENLABS_API_KEY) {
    const r = await tryElevenLabs(audio, key, env.ELEVENLABS_API_KEY);
    if (r.ok) return r;
    if (!env.OPENAI_API_KEY) return r;
    console.log('STT fallback na Whisper:', r.error);
  }
  if (env.OPENAI_API_KEY) {
    return tryWhisper(audio, key, env.OPENAI_API_KEY);
  }
  return { ok: false, error: 'Ziadny STT kluc (ELEVENLABS_API_KEY ani OPENAI_API_KEY)' };
}
