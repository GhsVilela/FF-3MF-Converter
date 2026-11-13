import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ConversionOptions, ConversionReport, ConversionStage } from '@ff3mf/shared';
import { ConversionError } from '@ff3mf/core';
import { loadTargetProfile } from '@ff3mf/profiles';
import { config } from './config.js';
import {
  conversionDir,
  getJob,
  getUpload,
  updateJob,
  type JobRecord,
  type UploadRecord,
} from './store.js';

interface WorkerProgressMessage {
  type: 'progress';
  stage: ConversionStage;
  progress: number;
}

interface WorkerResultMessage {
  type: 'result';
  ok: boolean;
  report?: ConversionReport;
  error?: { code: string; message: string; details?: string[] };
}

type WorkerMessage = WorkerProgressMessage | WorkerResultMessage;

let active = 0;
const queue: string[] = [];

function chooseProcessName(upload: UploadRecord, options: ConversionOptions): string {
  const profile = loadTargetProfile(options.printerId, options.nozzle, options.processName);
  if (options.processName || !upload.analysis.layerHeight) return profile.process.name;

  const sourceHeight = upload.analysis.layerHeight;
  const closest = [...profile.processes].sort((left, right) => {
    const leftHeight = Number.parseFloat(left.layerHeight);
    const rightHeight = Number.parseFloat(right.layerHeight);
    return Math.abs(leftHeight - sourceHeight) - Math.abs(rightHeight - sourceHeight);
  })[0];
  return closest?.name ?? profile.process.name;
}

function runConversionWorker(
  upload: UploadRecord,
  job: JobRecord,
  outputPath: string,
  timeoutMs: number,
): Promise<ConversionReport> {
  const processName = chooseProcessName(upload, job.options);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url));
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(
        new Error(
          `The conversion timed out after ${Math.round(timeoutMs / 1000)} seconds. Large projects may need a higher CONVERSION_TIMEOUT_SECONDS value.`,
        ),
      );
    }, timeoutMs);
    timer.unref();

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      callback();
    };

    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'progress') {
        updateJob(job.id, { stage: message.stage, progress: message.progress });
        return;
      }
      if (message.ok && message.report) {
        finish(() => resolve(message.report as ConversionReport));
        return;
      }
      const error = new ConversionError(
        (message.error?.code as ConversionError['code']) ?? 'CONVERSION_FAILED',
        message.error?.message ?? 'Conversion failed',
        message.error?.details,
      );
      finish(() => reject(error));
    });
    worker.once('error', (error) => finish(() => reject(error)));
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => reject(new Error(`Conversion worker exited with code ${code}`)));
    });

    try {
      worker.postMessage({
        inputPath: upload.inputPath,
        outputPath,
        printerId: job.options.printerId,
        nozzle: job.options.nozzle,
        processName,
        options: job.options,
      });
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export function safeBaseName(name: string): string {
  return (
    name
      .replace(/\.3mf$/i, '')
      .replace(/[^a-zA-Z0-9._ -]+/g, '_')
      .replace(/^[._ -]+|[._ -]+$/g, '')
      .slice(0, 120) || 'model'
  );
}

async function runJob(job: JobRecord, upload: UploadRecord): Promise<void> {
  active += 1;
  try {
    updateJob(job.id, { status: 'converting', stage: 'analysing', progress: 2 });
    const outputPath = path.join(conversionDir(job.id), 'output.3mf');
    const report = await runConversionWorker(
      upload,
      job,
      outputPath,
      config.conversionTimeoutSeconds * 1000,
    );
    report.source.fileName = upload.originalName;
    report.source.fileSize = upload.size;
    updateJob(job.id, {
      status: 'completed',
      stage: 'completed',
      progress: 100,
      report,
      outputPath,
      expiresAt: Date.now() + config.jobTtlMinutes * 60_000,
    });
  } catch (error) {
    const conversionError = error instanceof ConversionError ? error : null;
    updateJob(job.id, {
      status: 'failed',
      stage: 'failed',
      progress: 100,
      error: {
        code: conversionError?.code ?? 'CONVERSION_FAILED',
        message: error instanceof Error ? error.message : 'Conversion failed',
        details: conversionError?.details,
      },
    });
  } finally {
    active -= 1;
    pump();
  }
}

function pump(): void {
  while (active < config.maxConcurrentJobs && queue.length > 0) {
    const id = queue.shift();
    if (!id) return;
    const job = getJob(id);
    if (!job || job.status !== 'queued') continue;
    const upload = getUpload(job.uploadId);
    if (!upload) {
      updateJob(job.id, {
        status: 'failed',
        stage: 'failed',
        progress: 100,
        error: { code: 'INVALID_FILE', message: 'The uploaded file has expired' },
      });
      continue;
    }
    void runJob(job, upload);
  }
}

export function enqueueJob(job: JobRecord): void {
  if (queue.length >= config.maxQueuedJobs) {
    updateJob(job.id, {
      status: 'failed',
      stage: 'failed',
      progress: 100,
      error: {
        code: 'CONVERSION_FAILED',
        message: 'The conversion queue is full. Try again in a moment.',
      },
    });
    return;
  }
  queue.push(job.id);
  setImmediate(pump);
}

export function runnerStatus() {
  return { active, queued: queue.length };
}
