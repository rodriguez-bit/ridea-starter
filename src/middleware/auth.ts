import type { Context, Next } from 'hono';
import { verifyJWT } from '../lib/jwt';
import type { Env, User, Role } from '../types';

type Ctx = Context<{ Bindings: Env; Variables: { user: User } }>;

export async function authMiddleware(c: Ctx, next: Next) {
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return c.json({ error: 'Chyba token' }, 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Neplatny token' }, 401);

  // Cerpame z DB, nie z tokenu - deaktivovany alebo zmeneny ucet sa prejavi hned.
  const user = await c.env.DB
    .prepare('SELECT id, email, display_name, role FROM users WHERE id = ?')
    .bind(payload.sub)
    .first<User>();
  if (!user) return c.json({ error: 'Pouzivatel neexistuje' }, 401);

  c.set('user', user);
  await next();
}

export function requireRole(...roles: Role[]) {
  return async (c: Ctx, next: Next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: 'Nedostatocne opravnenia' }, 403);
    }
    await next();
  };
}
