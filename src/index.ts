import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authRoutes from './routes/auth';
import ideaRoutes from './routes/ideas';
import type { Env, User } from './types';

const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();

app.use('/api/*', cors({
  origin: (origin) => {
    if (!origin) return origin;
    // Uprav si na vlastnu domenu, ked nasadis na produkciu.
    if (origin.startsWith('http://localhost')) return origin;
    if (origin.endsWith('.workers.dev')) return origin;
    return null;
  },
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.get('/api/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ ok: true, db: 'up', ts: new Date().toISOString() });
  } catch {
    return c.json({ ok: false, db: 'down' }, 503);
  }
});

app.route('/api/auth', authRoutes);
app.route('/api/ideas', ideaRoutes);

// Vsetko ostatne obsluhuju staticke subory z public/
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
