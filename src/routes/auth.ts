import { Hono } from 'hono';
import { signJWT } from '../lib/jwt';
import { hashPassword, verifyPassword, hashIp, timingSafeEqual, DUMMY_PASSWORD_HASH } from '../lib/password';
import { authMiddleware } from '../middleware/auth';
import type { Env, User } from '../types';

const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();

const MAX_ATTEMPTS = 5;
const WINDOW = '-5 minutes';

// POST /api/auth/login
app.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json<{ email?: string; password?: string }>();
    if (!email || !password) return c.json({ error: 'Zadaj email a heslo' }, 400);

    const ip = c.req.header('CF-Connecting-IP') || '0.0.0.0';
    const ipHash = await hashIp(ip, c.env.JWT_SECRET);

    // Sliding window cez SQLite-native datetime(). NIKDY nepouzivaj
    // new Date().toISOString() - format s 'T' sa proti CURRENT_TIMESTAMP
    // (format s medzerou) porovnava lexikograficky zle a limit sa ticho vypne.
    const recent = await c.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM login_attempts
                WHERE ip_hash = ? AND created_at > datetime('now', '${WINDOW}')`)
      .bind(ipHash)
      .first<{ n: number }>();

    if ((recent?.n ?? 0) >= MAX_ATTEMPTS) {
      return c.json({ error: 'Prilis vela pokusov, skus o 5 minut' }, 429);
    }
    await c.env.DB
      .prepare('INSERT INTO login_attempts (ip_hash) VALUES (?)')
      .bind(ipHash)
      .run();

    const row = await c.env.DB
      .prepare('SELECT id, email, display_name, role, password_hash FROM users WHERE email = ?')
      .bind(email.toLowerCase().trim())
      .first<User & { password_hash: string }>();

    // Overujeme aj ked ucet neexistuje (dummy hash) -> rovnaky cas odpovede,
    // ziadna enumeracia emailov.
    const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!row || !ok) return c.json({ error: 'Nespravny email alebo heslo' }, 401);

    const token = await signJWT(
      {
        sub: row.id,
        email: row.email,
        role: row.role,
        exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      },
      c.env.JWT_SECRET
    );

    return c.json({
      token,
      user: { id: row.id, email: row.email, display_name: row.display_name, role: row.role },
    });
  } catch (e: unknown) {
    // Interne chyby (SQL, upstream) nepatria do odpovede - vidiet ich v
    // `npx wrangler tail`.
    console.error(e);
    return c.json({ error: 'Chyba servera' }, 500);
  }
});

// GET /api/auth/me
app.get('/me', authMiddleware, (c) => c.json({ user: c.get('user') }));

// POST /api/bootstrap - vytvori prveho admina. Funguje LEN kym je tabulka
// users prazdna a len so spravnym BOOTSTRAP_TOKEN. Po setupe token zmaz:
//   npx wrangler secret delete BOOTSTRAP_TOKEN
app.post('/bootstrap', async (c) => {
  try {
    if (!c.env.BOOTSTRAP_TOKEN) return c.json({ error: 'Bootstrap je vypnuty' }, 403);

    // Rovnaky sliding-window limit ako na logine. Bez neho sa da BOOTSTRAP_TOKEN
    // skusat donekonecna, kym ho po setupe niekto nezmaze.
    const ip = c.req.header('CF-Connecting-IP') || '0.0.0.0';
    const ipHash = await hashIp(ip, c.env.JWT_SECRET);
    const recent = await c.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM login_attempts
                WHERE ip_hash = ? AND created_at > datetime('now', '${WINDOW}')`)
      .bind(ipHash)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= MAX_ATTEMPTS) {
      return c.json({ error: 'Prilis vela pokusov, skus o 5 minut' }, 429);
    }
    await c.env.DB
      .prepare('INSERT INTO login_attempts (ip_hash) VALUES (?)')
      .bind(ipHash)
      .run();

    const { token, email, password, display_name } = await c.req.json<{
      token?: string; email?: string; password?: string; display_name?: string;
    }>();

    // Constant-time porovnanie: `!==` prezradi dlzku zhodneho prefixu casom.
    if (!token || !timingSafeEqual(token, c.env.BOOTSTRAP_TOKEN)) {
      return c.json({ error: 'Neplatny token' }, 403);
    }
    if (!email || !password) return c.json({ error: 'Zadaj email a heslo' }, 400);
    if (password.length < 10) return c.json({ error: 'Heslo min. 10 znakov' }, 400);

    const existing = await c.env.DB
      .prepare('SELECT COUNT(*) AS n FROM users')
      .first<{ n: number }>();
    if ((existing?.n ?? 0) > 0) return c.json({ error: 'Pouzivatel uz existuje' }, 409);

    const hash = await hashPassword(password);
    const r = await c.env.DB
      .prepare(`INSERT INTO users (email, display_name, password_hash, role)
                VALUES (?, ?, ?, 'admin')`)
      .bind(email.toLowerCase().trim(), display_name || 'Admin', hash)
      .run();

    return c.json({ ok: true, id: r.meta.last_row_id });
  } catch (e: unknown) {
    // Interne chyby (SQL, upstream) nepatria do odpovede - vidiet ich v
    // `npx wrangler tail`.
    console.error(e);
    return c.json({ error: 'Chyba servera' }, 500);
  }
});

// POST /api/auth/users - admin vytvara dalsich pouzivatelov
app.post('/users', authMiddleware, async (c) => {
  try {
    const me = c.get('user');
    if (me.role !== 'admin') return c.json({ error: 'Len admin' }, 403);

    const { email, password, display_name, role } = await c.req.json<{
      email?: string; password?: string; display_name?: string; role?: string;
    }>();
    if (!email || !password) return c.json({ error: 'Zadaj email a heslo' }, 400);
    if (password.length < 10) return c.json({ error: 'Heslo min. 10 znakov' }, 400);

    const allowed = ['submitter', 'reviewer', 'admin'];
    const r = await c.env.DB
      .prepare('INSERT INTO users (email, display_name, password_hash, role) VALUES (?, ?, ?, ?)')
      .bind(
        email.toLowerCase().trim(),
        display_name || email,
        await hashPassword(password),
        allowed.includes(role || '') ? role : 'submitter'
      )
      .run();

    return c.json({ ok: true, id: r.meta.last_row_id });
  } catch (e: unknown) {
    // Interne chyby (SQL, upstream) nepatria do odpovede - vidiet ich v
    // `npx wrangler tail`.
    console.error(e);
    return c.json({ error: 'Chyba servera' }, 500);
  }
});

export default app;
