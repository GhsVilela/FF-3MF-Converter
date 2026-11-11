import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConversionOptions, ConversionReport, SourceAnalysis } from '@open3mf/shared';
import { config } from './config.js';

export type JobStatus = 'queued' | 'converting' | 'completed' | 'failed';

export interface UploadRecord {
  id: string;
  inputPath: string;
  originalName: string;
  size: number;
  analysis: SourceAnalysis;
  createdAt: number;
  expiresAt: number;
}

export interface JobRecord {
  id: string;
  uploadId: string;
  status: JobStatus;
  progress: number;
  options: ConversionOptions;
  report?: ConversionReport;
  outputPath?: string;
  filename?: string;
  error?: { code: string; message: string; details?: string[] };
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

const uploads = new Map<string, UploadRecord>();
const jobs = new Map<string, JobRecord>();

export function ensureDataDirs(): void {
  mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });
  mkdirSync(path.join(config.dataDir, 'conversions'), { recursive: true });
}

export function createUpload(
  id: string,
  inputPath: string,
  originalName: string,
  size: number,
  analysis: SourceAnalysis,
): UploadRecord {
  const now = Date.now();
  const record: UploadRecord = {
    id,
    inputPath,
    originalName,
    size,
    analysis,
    createdAt: now,
    expiresAt: now + config.jobTtlMinutes * 60_000,
  };
  uploads.set(id, record);
  return record;
}

export function getUpload(id: string): UploadRecord | undefined {
  const record = uploads.get(id);
  if (!record) return undefined;
  if (record.expiresAt < Date.now()) {
    uploads.delete(id);
    return undefined;
  }
  return record;
}

export function createJob(
  uploadId: string,
  options: ConversionOptions,
  filename: string,
): JobRecord {
  const now = Date.now();
  const id = randomUUID();
  const outputPath = path.join(conversionDir(id), 'output.3mf');
  const record: JobRecord = {
    id,
    uploadId,
    status: 'queued',
    progress: 0,
    options,
    outputPath,
    filename,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + config.jobTtlMinutes * 60_000,
  };
  jobs.set(id, record);
  return record;
}

export function getJob(id: string): JobRecord | undefined {
  const record = jobs.get(id);
  if (!record) return undefined;
  if (record.expiresAt < Date.now()) {
    jobs.delete(id);
    return undefined;
  }
  return record;
}

export function updateJob(id: string, patch: Partial<JobRecord>): JobRecord | undefined {
  const record = jobs.get(id);
  if (!record) return undefined;
  Object.assign(record, patch, { updatedAt: Date.now() });
  return record;
}

export function deleteJob(id: string): boolean {
  const record = jobs.get(id);
  if (!record) return false;
  jobs.delete(id);
  try {
    rmSync(path.dirname(record.outputPath ?? ''), { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures.
  }
  return true;
}

export function cleanupExpired(): void {
  const now = Date.now();
  for (const [id, upload] of uploads) {
    if (upload.expiresAt >= now) continue;
    uploads.delete(id);
    try {
      rmSync(path.dirname(upload.inputPath), { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures.
    }
  }
  for (const [id, job] of jobs) {
    if (job.expiresAt >= now || job.status === 'converting') continue;
    jobs.delete(id);
    try {
      rmSync(path.dirname(job.outputPath ?? ''), { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures.
    }
  }
}

export function counts() {
  return { uploads: uploads.size, jobs: jobs.size };
}

export function uploadDir(id: string): string {
  return path.join(config.dataDir, 'uploads', id);
}

export function conversionDir(id: string): string {
  return path.join(config.dataDir, 'conversions', id);
}
