import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { transcribe, cleanHallucinations, isGibberish, MAX_AUDIO_BYTES } from '../lib/stt';
import { analyzeTranscript } from '../lib/analysis';
import type { Env, User } from '../types';

const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();

app.use('*', authMiddleware);

// GET /api/ideas
app.get('/', async (c) => {
  try {
    const user = c.get('user');
    const status = c.req.query('status');
    const search = c.req.query('search');

    // Submitter vidi len svoje, reviewer a admin vidia vsetko.
    const where: string[] = [];
    const args: unknown[] = [];

    if (user.role === 'submitter') {
      where.push('i.user_id = ?');
      args.push(user.id);
    }
    if (status) {
      where.push('i.status = ?');
      args.push(status);
    }
    if (search) {
      where.push('(i.title LIKE ? OR i.transcript LIKE ?)');
      args.push(`%${search}%`, `%${search}%`);
    }

    const sql = `SELECT i.id, i.title, i.status, i.ai_score, i.ai_summary,
                        i.duration_sec, i.created_at, u.display_name AS author
                 FROM ideas i JOIN users u ON u.id = i.user_id
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY i.created_at DESC LIMIT 100`;

    const { results } = await c.env.DB.prepare(sql).bind(...args).all();
    return c.json({ ok: true, data: results });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// GET /api/ideas/:id
app.get('/:id', async (c) => {
  try {
    const user = c.get('user');
    const row = await c.env.DB
      .prepare(`SELECT i.*, u.display_name AS author
                FROM ideas i JOIN users u ON u.id = i.user_id WHERE i.id = ?`)
      .bind(c.req.param('id'))
      .first<Record<string, unknown>>();

    if (!row) return c.json({ error: 'Nenajdene' }, 404);
    if (user.role === 'submitter' && row.user_id !== user.id) {
      return c.json({ error: 'Nenajdene' }, 404);
    }
    return c.json({ ok: true, data: row });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// GET /api/ideas/:id/audio - streamuje nahravku z R2
app.get('/:id/audio', async (c) => {
  try {
    const user = c.get('user');
    const row = await c.env.DB
      .prepare('SELECT user_id, audio_key FROM ideas WHERE id = ?')
      .bind(c.req.param('id'))
      .first<{ user_id: number; audio_key: string | null }>();

    if (!row?.audio_key) return c.json({ error: 'Nenajdene' }, 404);
    if (user.role === 'submitter' && row.user_id !== user.id) {
      return c.json({ error: 'Nenajdene' }, 404);
    }

    const obj = await c.env.AUDIO.get(row.audio_key);
    if (!obj) return c.json({ error: 'Audio chyba v R2' }, 404);

    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'audio/webm',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// POST /api/ideas - multipart upload nahravky
// Odpoved pride hned, prepis a analyza bezia na pozadi cez waitUntil().
app.post('/', async (c) => {
  try {
    const user = c.get('user');
    const form = await c.req.formData();
    const entry = form.get('audio');
    const title = (form.get('title') as string | null) || null;

    // form.get() vracia string alebo subor - textovy zapis odmietneme.
    if (!entry || typeof entry === 'string') {
      return c.json({ error: 'Chyba subor audio' }, 400);
    }
    const file = entry as File;
    if (file.size === 0) return c.json({ error: 'Prazdna nahravka' }, 400);
    if (file.size > MAX_AUDIO_BYTES) {
      return c.json({
        error: `Nahravka je prilis velka (${(file.size / 1048576).toFixed(1)} MB, max 4 MB). ` +
               'Nahraj kratsiu alebo pozri README sekciu o dlhych nahravkach.',
      }, 413);
    }

    const ext = (file.name.split('.').pop() || 'webm').toLowerCase();
    const key = `ideas/${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const bytes = await file.arrayBuffer();

    await c.env.AUDIO.put(key, bytes, {
      httpMetadata: { contentType: file.type || 'audio/webm' },
    });

    const r = await c.env.DB
      .prepare(`INSERT INTO ideas (user_id, title, audio_key, status)
                VALUES (?, ?, ?, 'processing')`)
      .bind(user.id, title, key)
      .run();

    const ideaId = r.meta.last_row_id as number;

    c.executionCtx.waitUntil(processIdea(c.env, ideaId, key, bytes));

    return c.json({ ok: true, id: ideaId, status: 'processing' });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// DELETE /api/ideas/:id - autor alebo admin
app.delete('/:id', async (c) => {
  try {
    const user = c.get('user');
    const row = await c.env.DB
      .prepare('SELECT user_id, audio_key FROM ideas WHERE id = ?')
      .bind(c.req.param('id'))
      .first<{ user_id: number; audio_key: string | null }>();

    if (!row) return c.json({ error: 'Nenajdene' }, 404);
    if (row.user_id !== user.id && user.role !== 'admin') {
      return c.json({ error: 'Nedostatocne opravnenia' }, 403);
    }

    if (row.audio_key) await c.env.AUDIO.delete(row.audio_key);
    await c.env.DB.prepare('DELETE FROM ideas WHERE id = ?').bind(c.req.param('id')).run();
    return c.json({ ok: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// Pipeline na pozadi: STT -> cistenie -> Claude analyza -> ulozenie.
// Kazdy krok, ktory zlyha, ulozi status 'error' s dovodom. Nikdy nenechavame
// napad viset navzdy v stave 'processing'.
async function processIdea(
  env: Env, ideaId: number, key: string, bytes: ArrayBuffer
): Promise<void> {
  const fail = async (msg: string) => {
    await env.DB
      .prepare(`UPDATE ideas SET status='error', error_message=?,
                updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(msg.slice(0, 500), ideaId)
      .run();
  };

  try {
    // Kill switch: negativny, default zapnute. Nastav cez wrangler secret,
    // nie cez wrangler.toml [vars] (deploy by ho prepisal spat).
    if (env.STT_DISABLED === '1') return fail('STT je docasne vypnuty (STT_DISABLED=1)');

    const stt = await transcribe(bytes, key, env);
    if (!stt.ok) return fail(stt.error || 'STT zlyhalo');

    const transcript = cleanHallucinations(stt.text || '');
    if (!transcript) return fail('Prazdny prepis - nahravka je ticha alebo prilis kratka');
    if (isGibberish(transcript)) return fail('Prepis vyzera ako halucinacia (cudzie pismo)');

    const ctxRow = await env.DB
      .prepare("SELECT value FROM company_context WHERE key = 'context'")
      .first<{ value: string }>();

    const ai = await analyzeTranscript(transcript, env.ANTHROPIC_API_KEY, {
      model: env.CLAUDE_MODEL,
      companyContext: ctxRow?.value,
    });

    if (!ai.ok || !ai.analysis) {
      // Prepis mame - ulozime ho aj ked analyza padla, praca sa nestrati.
      await env.DB
        .prepare(`UPDATE ideas SET transcript=?, duration_sec=?, status='error',
                  error_message=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(transcript, stt.duration ?? null, (ai.error || 'Analyza zlyhala').slice(0, 500), ideaId)
        .run();
      return;
    }

    const a = ai.analysis;
    await env.DB
      .prepare(`UPDATE ideas SET transcript=?, duration_sec=?, ai_score=?, ai_summary=?,
                ai_analysis=?, title=COALESCE(NULLIF(title,''), ?), status='done',
                error_message=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(
        transcript, stt.duration ?? null,
        typeof a.score === 'number' ? Math.round(a.score) : null,
        a.summary || null, JSON.stringify(a), a.title || null, ideaId
      )
      .run();
  } catch (e: unknown) {
    await fail(e instanceof Error ? e.message : 'Neznama chyba v pipeline');
  }
}

export default app;
