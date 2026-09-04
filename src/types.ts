export interface Env {
  DB: D1Database;
  AUDIO: R2Bucket;
  ASSETS: Fetcher;

  JWT_SECRET: string;
  ANTHROPIC_API_KEY: string;
  ELEVENLABS_API_KEY?: string;
  OPENAI_API_KEY?: string;
  BOOTSTRAP_TOKEN?: string;

  CLAUDE_MODEL?: string;
  // Denny strop vydavkov na prepis a analyzu v EUR (default 2). Pozri lib/spend.ts.
  DAILY_SPEND_LIMIT_EUR?: string;
  // Kill switch: negativny, default = zapnute. NEDAVAJ ho do wrangler.toml [vars].
  STT_DISABLED?: string;
}

export type Role = 'submitter' | 'reviewer' | 'admin';

export interface User {
  id: number;
  email: string;
  display_name: string;
  role: Role;
}

export interface JWTPayload {
  sub: number;
  email: string;
  role: Role;
  exp: number;
}
