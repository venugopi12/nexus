import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().default('postgres://nexus:nexus@127.0.0.1:54329/nexus'),
  WEB_ORIGIN: z.string().default('http://localhost:5273'),
  SESSION_TTL_HOURS: z.coerce.number().default(24 * 7),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SIM_ENABLED: z.enum(['true', 'false']).default('true'),
  SIM_CHAOS: z.enum(['on', 'off']).default('on'),
  SIM_TICK_MS: z.coerce.number().default(2000),
  ALERT_EVAL_MS: z.coerce.number().default(10000),
  AI_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),
  EMBEDDED_PG_DIR: z.string().default('.pgdata'),
  SEED_PASSWORD: z.string().default('nexus-demo-2026'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.COOKIE_SECURE !== 'true') {
      // not fatal: allows plain-http docker demos, but loudly documented
      console.warn('[env] COOKIE_SECURE is not true in production');
    }
  }
  return parsed.data;
}

export const env = loadEnv();
