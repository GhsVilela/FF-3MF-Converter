import type {
  ConversionOptions,
  ConversionReport,
  PrinterSummary,
  ProfileSource,
  SourceAnalysis,
} from '@ff3mf/shared';

export interface PrinterWithMaterials extends PrinterSummary {
  materials: string[];
}

export interface PrintersResponse {
  generatedAt: string;
  maxUploadMb?: number;
  sources: Record<string, ProfileSource>;
  printers: PrinterWithMaterials[];
}

export interface UploadResponse {
  uploadId: string;
  analysis: SourceAnalysis;
}

export type JobStatus = 'queued' | 'converting' | 'completed' | 'failed';

export interface JobResponse {
  id: string;
  status: JobStatus;
  progress: number;
  report?: ConversionReport;
  error?: { code: string; message: string; details?: string[] };
  download?: { url: string; filename: string; size: number } | null;
  createdAt: number;
  updatedAt: number;
}

export class ApiError extends Error {
  readonly code: string;
  readonly details?: string[];
  readonly status: number;

  constructor(status: number, code: string, message: string, details?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function apiBase(): string {
  return new URL('api/', document.baseURI).toString().replace(/\/$/, '');
}

export function getToken(): string {
  return sessionStorage.getItem('ff3mf-token') ?? '';
}

export function setToken(token: string): void {
  if (token) sessionStorage.setItem('ff3mf-token', token);
  else sessionStorage.removeItem('ff3mf-token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: string[] } })
      ?.error;
    throw new ApiError(
      response.status,
      error?.code ?? `HTTP_${response.status}`,
      error?.message ?? `Request failed with status ${response.status}`,
      error?.details,
    );
  }
  return payload as T;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  return parseResponse<T>(response);
}

export function getPrinters(): Promise<PrintersResponse> {
  return apiFetch<PrintersResponse>('/printers');
}

export function uploadFile(
  file: File,
  onProgress: (fraction: number) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${apiBase()}/uploads`);
    const token = getToken();
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    request.addEventListener('load', () => {
      let payload: unknown;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        payload = undefined;
      }
      if (request.status >= 200 && request.status < 300) {
        resolve(payload as UploadResponse);
        return;
      }
      const error = (payload as { error?: { code?: string; message?: string; details?: string[] } })
        ?.error;
      reject(
        new ApiError(
          request.status,
          error?.code ?? 'UPLOAD_FAILED',
          error?.message ?? 'Upload failed',
          error?.details,
        ),
      );
    });
    request.addEventListener('error', () => {
      reject(new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached.'));
    });
    const form = new FormData();
    form.append('file', file, file.name);
    request.send(form);
  });
}

export function createConversion(
  uploadId: string,
  options: ConversionOptions,
): Promise<JobResponse> {
  return apiFetch<JobResponse>('/conversions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, ...options }),
  });
}

export function getJob(jobId: string): Promise<JobResponse> {
  return apiFetch<JobResponse>(`/conversions/${jobId}`);
}

export function downloadUrl(jobId: string): string {
  return `${apiBase()}/conversions/${jobId}/download`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
