import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: intEnv('PORT', 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR ?? path.resolve(here, '../../../data')),
  webDir: process.env.WEB_DIR ?? path.resolve(here, '../../web/dist'),
  maxUploadMb: intEnv('MAX_UPLOAD_MB', 100),
  maxConcurrentJobs: intEnv('MAX_CONCURRENT_JOBS', 1),
  maxQueuedJobs: intEnv('MAX_QUEUED_JOBS', 10),
  jobTtlMinutes: intEnv('JOB_TTL_MINUTES', 60),
  conversionTimeoutSeconds: intEnv('CONVERSION_TIMEOUT_SECONDS', 120),
  authToken: process.env.AUTH_TOKEN?.trim() || undefined,
  basePath: (process.env.BASE_PATH ?? '/').replace(/\/+$/, '') || '/',
  trustProxy: /^(1|true|yes)$/i.test(process.env.TRUST_PROXY ?? ''),
  corsOrigin: process.env.CORS_ORIGIN ?? '',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  version: process.env.APP_VERSION ?? '0.2.0',
  gitSha: process.env.GIT_SHA ?? 'dev',
  buildDate: process.env.BUILD_DATE ?? '',
  rateLimitMax: intEnv('RATE_LIMIT_MAX', 120),
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
};

export const MAX_UPLOAD_BYTES = config.maxUploadMb * 1024 * 1024;
