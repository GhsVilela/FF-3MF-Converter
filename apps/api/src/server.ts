import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCors from '@fastify/cors';
import fastifyCompress from '@fastify/compress';
import { createConversionSchema } from '@ff3mf/shared';
import { analyze3mf, ConversionError, asConversionError } from '@ff3mf/core';
import {
  availableMaterials,
  getCatalog,
  loadTargetProfile,
  profileManifest,
} from '@ff3mf/profiles';
import { config, MAX_UPLOAD_BYTES } from './config.js';
import {
  cleanupExpired,
  conversionDir,
  createJob,
  createUpload,
  deleteJob,
  ensureDataDirs,
  getJob,
  getUpload,
  uploadDir,
  type JobRecord,
} from './store.js';
import { enqueueJob, runnerStatus, safeBaseName } from './runner.js';

const startedAt = Date.now();
const app = Fastify({
  logger: {
    level: config.logLevel,
    redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
  },
  trustProxy: config.trustProxy,
  bodyLimit: 1024 * 1024,
});

function safeTokenEqual(provided: string | undefined): boolean {
  if (!config.authToken) return true;
  if (!provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(config.authToken);
  return left.length === right.length && timingSafeEqual(left, right);
}

function errorPayload(error: ConversionError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  };
}

function jobPayload(job: JobRecord) {
  const download =
    job.status === 'completed' && job.outputPath && existsSync(job.outputPath)
      ? {
          url: `/api/conversions/${job.id}/download`,
          filename: job.filename ?? 'converted.3mf',
          size: statSync(job.outputPath).size,
        }
      : null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    report: job.report,
    error: job.error,
    download,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

async function registerPlugins() {
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(fastifyCompress, { global: true, threshold: 1024 });
  await app.register(fastifyRateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
  });
  if (config.corsOrigin) {
    await app.register(fastifyCors, {
      origin: config.corsOrigin.split(',').map((entry) => entry.trim()),
    });
  }
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      fields: 12,
      parts: 16,
    },
  });
}

app.addHook('onRequest', async (request, reply) => {
  if (!config.authToken) return;
  if (!request.url.startsWith('/api/')) return;
  if (request.url === '/api/health' || request.url === '/api/version') return;
  const authorization = request.headers.authorization;
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  const apiKey = request.headers['x-api-key'];
  const provided = bearer ?? (typeof apiKey === 'string' ? apiKey : undefined);
  if (!safeTokenEqual(provided)) {
    await reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'A valid API token is required.' },
    });
  }
});

app.get('/api/health', async () => ({
  status: 'ok',
  version: config.version,
  uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  profiles: profileManifest(),
  runner: runnerStatus(),
}));

app.get('/api/version', async () => ({
  version: config.version,
  gitSha: config.gitSha,
  buildDate: config.buildDate,
}));

app.get('/api/printers', async () => {
  const catalog = getCatalog();
  return {
    generatedAt: catalog.generatedAt,
    maxUploadMb: config.maxUploadMb,
    sources: catalog.sources,
    printers: catalog.printers.map((printer) => ({
      ...printer,
      materials: availableMaterials(printer.id),
    })),
  };
});

app.post(
  '/api/uploads',
  { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
  async (request, reply) => {
    let file;
    try {
      file = await request.file();
    } catch (error) {
      throw new ConversionError(
        'INVALID_FILE',
        'Upload one .3mf file using a multipart/form-data request.',
        [error instanceof Error ? error.message : String(error)],
      );
    }
    if (!file) {
      throw new ConversionError('INVALID_FILE', 'No file was uploaded.');
    }
    const originalName = path.basename(file.filename || 'model.3mf');
    if (!/\.3mf$/i.test(originalName)) {
      throw new ConversionError('UNSUPPORTED_FILE', 'Only .3mf files are supported.');
    }

    const id = randomUUID();
    const directory = uploadDir(id);
    mkdirSync(directory, { recursive: true });
    const inputPath = path.join(directory, 'input.3mf');
    try {
      await pipeline(file.file, createWriteStream(inputPath));
      if (file.file.truncated) {
        throw new ConversionError(
          'INVALID_FILE',
          `The file exceeds the ${config.maxUploadMb} MB upload limit.`,
        );
      }
      const analysis = await analyze3mf(inputPath);
      analysis.fileName = originalName;
      analysis.fileSize = statSync(inputPath).size;
      createUpload(id, inputPath, originalName, analysis.fileSize, analysis);
      request.log.info({ uploadId: id, bytes: analysis.fileSize }, 'upload analysed');
      return reply.code(201).send({ uploadId: id, analysis });
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  },
);

app.post(
  '/api/conversions',
  { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
  async (request, reply) => {
    const parsed = createConversionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'The conversion request is invalid.',
          details: parsed.error.issues.map(
            (issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`,
          ),
        },
      });
    }
    const upload = getUpload(parsed.data.uploadId);
    if (!upload) {
      throw new ConversionError(
        'INVALID_FILE',
        'The uploaded file has expired or does not exist. Upload it again.',
      );
    }
    // Fail early with a useful message if the target is unknown.
    try {
      loadTargetProfile(parsed.data.printerId, parsed.data.nozzle, parsed.data.processName);
    } catch (error) {
      throw new ConversionError(
        'PROFILE_ERROR',
        error instanceof Error ? error.message : 'Unknown target profile',
      );
    }
    const filename = `${safeBaseName(upload.originalName)}_${parsed.data.printerId}.3mf`;
    const job = createJob(upload.id, parsed.data, filename);
    mkdirSync(conversionDir(job.id), { recursive: true });
    enqueueJob(job);
    request.log.info({ jobId: job.id, uploadId: upload.id }, 'conversion queued');
    return reply.code(202).send(jobPayload(job));
  },
);

app.get('/api/conversions/:id', async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const job = getJob(id);
  if (!job)
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found.' } });
  return jobPayload(job);
});

app.get('/api/conversions/:id/download', async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const job = getJob(id);
  if (!job)
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found.' } });
  if (job.status !== 'completed' || !job.outputPath || !existsSync(job.outputPath)) {
    return reply.code(409).send({
      error: { code: 'NOT_READY', message: 'The conversion is not ready for download.' },
    });
  }
  const filename = job.filename ?? 'converted.3mf';
  return reply
    .header('Content-Type', 'application/octet-stream')
    .header('Content-Disposition', `attachment; filename="${filename.replaceAll('"', '')}"`)
    .header('Content-Length', statSync(job.outputPath).size)
    .send(createReadStream(job.outputPath));
});

app.delete('/api/conversions/:id', async (request, reply) => {
  const id = (request.params as { id: string }).id;
  if (!deleteJob(id)) {
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Job not found.' } });
  }
  return reply.code(204).send();
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ConversionError) {
    const status = error.code === 'INVALID_FILE' || error.code === 'UNSUPPORTED_FILE' ? 400 : 422;
    return reply.code(status).send(errorPayload(error));
  }
  if ((error as { statusCode?: number }).statusCode === 413) {
    return reply.code(413).send({
      error: {
        code: 'FILE_TOO_LARGE',
        message: `The file exceeds the ${config.maxUploadMb} MB upload limit.`,
      },
    });
  }
  const conversionError = asConversionError(error);
  request.log.error({ err: error }, 'request failed');
  return reply.code(500).send(errorPayload(conversionError));
});

async function registerStaticUi() {
  if (!existsSync(path.join(config.webDir, 'index.html'))) {
    app.log.warn({ webDir: config.webDir }, 'web UI build not found; API-only mode');
    return;
  }
  await app.register(fastifyStatic, {
    root: config.webDir,
    prefix: '/',
    index: false,
    wildcard: false,
  });
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
    }
    return reply.type('text/html').sendFile('index.html');
  });
}

async function start() {
  ensureDataDirs();
  await registerPlugins();
  await registerStaticUi();
  const cleanupTimer = setInterval(cleanupExpired, 60_000);
  cleanupTimer.unref();
  app.addHook('onClose', async () => clearInterval(cleanupTimer));
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { port: config.port, dataDir: config.dataDir, profiles: profileManifest().sources },
    'FF-3MF Converter ready',
  );
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
