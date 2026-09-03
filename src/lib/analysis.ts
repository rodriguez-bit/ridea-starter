// AI analyza prepisu cez Claude API.
// Vystupom je striktne JSON, ktory ukladame do ideas.ai_analysis.

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export interface Analysis {
  score: number;          // 1-10
  title: string;          // kratky nazov napadu
  summary: string;        // 2-3 vety
  category: string;
  tags: string[];         // max 5
  strengths: string[];
  weaknesses: string[];
  next_steps: string[];
}

function buildPrompt(transcript: string, companyContext: string): string {
  return `Si analytik napadov. Dostanes prepis hlasovej nahravky, v ktorej niekto opisuje napad.

${companyContext ? `Kontext organizacie:\n${companyContext}\n` : ''}
Prepis nahravky:
"""
${transcript}
"""

Vyhodnot napad a vrat VYLUCNE JSON v tomto tvare, bez ziadneho textu okolo:
{
  "score": <cislo 1-10, celkova kvalita a realizovatelnost>,
  "title": "<kratky nazov napadu, max 60 znakov>",
  "summary": "<2-3 vety o com to je>",
  "category": "<jedno slovo alebo kratka fraza>",
  "tags": ["<max 5 tagov>"],
  "strengths": ["<1-3 silne stranky>"],
  "weaknesses": ["<1-3 rizika alebo slabiny>"],
  "next_steps": ["<1-3 konkretne dalsie kroky>"]
}

Pis po slovensky. Ak je prepis prazdny alebo nedava zmysel, daj score 1 a vysvetli to v summary.`;
}

export async function analyzeTranscript(
  transcript: string,
  apiKey: string,
  opts: { model?: string; companyContext?: string } = {}
): Promise<{ ok: boolean; analysis?: Analysis; error?: string }> {
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.model || DEFAULT_MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: buildPrompt(transcript, opts.companyContext || '') }],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      return { ok: false, error: `Claude ${resp.status}: ${await resp.text()}` };
    }

    const data = await resp.json() as { content?: Array<{ text?: string }> };
    const raw = data.content?.[0]?.text || '';

    // Model obcas obali JSON do ```json bloku - vytiahneme prvy { ... } blok.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { ok: false, error: 'Claude nevratil JSON' };

    const parsed = JSON.parse(match[0]) as Analysis;
    return { ok: true, analysis: parsed };
  } catch (e: unknown) {
    return { ok: false, error: `Analyza: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}
