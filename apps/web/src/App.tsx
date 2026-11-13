import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Loader2,
  LockKeyhole,
  X,
} from 'lucide-react';
import type { ConversionOptions, JobStage, PrinterSummary, SourceAnalysis } from '@ff3mf/shared';
import { Header } from './components/Header';
import { Steps } from './components/Steps';
import { Dropzone } from './components/Dropzone';
import { AnalysisCard } from './components/AnalysisCard';
import { PreviewCard } from './components/PreviewCard';
import { PrinterPicker } from './components/PrinterPicker';
import { ColorMapping } from './components/ColorMapping';
import { ReportView } from './components/ReportView';
import { AuthGate } from './components/AuthGate';
import {
  ApiError,
  createConversion,
  formatBytes,
  getJob,
  getPrinters,
  setToken,
  uploadFile,
  type JobResponse,
  type PrinterWithMaterials,
  type UploadProgress,
} from './lib/api';
import { useI18n, type TranslationKey } from './lib/i18n';
import { cn } from './lib/utils';

type Stage = 'upload' | 'configure' | 'converting' | 'done';

const DEFAULT_MAX_UPLOAD_MB = 100;
const CONVERSION_POLL_MS = 900;
const MAX_POLL_FAILURES = 10;
const EMPTY_UPLOAD_PROGRESS: UploadProgress = {
  percent: 0,
  loaded: 0,
  total: 0,
  phase: 'uploading',
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stageLabelKey(stage: JobStage | undefined): TranslationKey {
  switch (stage) {
    case 'analysing':
      return 'progress.analysing';
    case 'profiling':
      return 'progress.profiling';
    case 'rewriting':
      return 'progress.rewriting';
    case 'packaging':
      return 'progress.packaging';
    case 'validating':
      return 'progress.validating';
    case 'completed':
      return 'progress.completed';
    case 'failed':
      return 'progress.failed';
    default:
      return 'progress.queued';
  }
}

function isTransientError(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500)
  );
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function parseLayerHeight(entry: { layerHeight: string }): number {
  return Number.parseFloat(entry.layerHeight) || 0.2;
}

function defaultPrinter(
  analysis: SourceAnalysis,
  printers: PrinterWithMaterials[],
): PrinterWithMaterials | undefined {
  if (printers.length === 0) return undefined;
  const used = analysis.usedColorCount;
  const preferred =
    used > 1
      ? (printers.find((printer) => printer.id === 'ad5x' && printer.maxColors >= used) ??
        printers.find((printer) => printer.maxColors >= used) ??
        printers.find((printer) => printer.maxColors === 4))
      : (printers.find((printer) => printer.id === 'ad5m') ??
        printers.find((printer) => printer.maxColors === 1));
  return preferred ?? printers[0];
}

function defaultNozzle(printer: PrinterWithMaterials, analysis?: SourceAnalysis): string {
  if (analysis?.nozzle && printer.nozzles.some((entry) => entry.diameter === analysis.nozzle)) {
    return analysis.nozzle;
  }
  if (printer.nozzles.some((entry) => entry.diameter === '0.4')) return '0.4';
  return printer.nozzles[0]?.diameter ?? '0.4';
}

function defaultMapping(
  analysis: SourceAnalysis | undefined,
  printer: PrinterWithMaterials | undefined,
  keepAllColors = false,
): Record<string, number> {
  if (!analysis || !printer) return {};
  const used = analysis.colors.filter((color) => color.used);
  const result: Record<string, number> = {};
  used.forEach((color, index) => {
    result[String(color.slot)] =
      printer.maxColors === 1 ? 1 : keepAllColors ? index + 1 : (index % printer.maxColors) + 1;
  });
  return result;
}

function closestProcessName(
  printer: PrinterWithMaterials | undefined,
  nozzle: string,
  analysis: SourceAnalysis | undefined,
): string | undefined {
  const entry = printer?.nozzles.find((candidate) => candidate.diameter === nozzle);
  if (!entry) return undefined;
  const sourceHeight = analysis?.layerHeight ?? 0.2;
  return [...entry.processes].sort(
    (left, right) =>
      Math.abs(parseLayerHeight(left) - sourceHeight) -
      Math.abs(parseLayerHeight(right) - sourceHeight),
  )[0]?.name;
}

export default function App() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    localStorage.getItem('ff3mf-theme') === 'dark' ? 'dark' : 'light',
  );
  const [printers, setPrinters] = useState<PrinterWithMaterials[]>([]);
  const [maxUploadMb, setMaxUploadMb] = useState(DEFAULT_MAX_UPLOAD_MB);
  const [stage, setStage] = useState<Stage>('upload');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>(EMPTY_UPLOAD_PROGRESS);
  const [fileName, setFileName] = useState<string>();
  const [uploadId, setUploadId] = useState<string>();
  const [hasThumbnail, setHasThumbnail] = useState(false);
  const [analysis, setAnalysis] = useState<SourceAnalysis>();
  const [selectedPrinterId, setSelectedPrinterId] = useState('');
  const [selectedNozzle, setSelectedNozzle] = useState('0.4');
  const [selectedProcess, setSelectedProcess] = useState('');
  const [colorMapping, setColorMapping] = useState<Record<string, number>>({});
  const [keepAllColors, setKeepAllColors] = useState(false);
  const [preserveTemperatures, setPreserveTemperatures] = useState(true);
  const [layout, setLayout] = useState<NonNullable<ConversionOptions['layout']>>('center');
  const [job, setJob] = useState<JobResponse>();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pollWarning, setPollWarning] = useState<string>();
  const [error, setError] = useState<{ message: string; details?: string[] }>();
  const [authRequired, setAuthRequired] = useState(false);
  const [authError, setAuthError] = useState<string>();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('ff3mf-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (stage !== 'converting') return;
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  const loadPrinters = async () => {
    try {
      const response = await getPrinters();
      setPrinters(response.printers);
      if (response.maxUploadMb) setMaxUploadMb(response.maxUploadMb);
      setAuthRequired(false);
      setAuthError(undefined);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setAuthRequired(true);
        return;
      }
      setError({ message: caught instanceof Error ? caught.message : t('error.generic') });
    }
  };

  useEffect(() => {
    void loadPrinters();
    // The catalog is static for a running instance.
  }, []);

  const selectedPrinter = printers.find((printer) => printer.id === selectedPrinterId);
  const selectedNozzleEntry = selectedPrinter?.nozzles.find(
    (entry) => entry.diameter === selectedNozzle,
  );
  const autoProcess = useMemo(
    () => closestProcessName(selectedPrinter, selectedNozzle, analysis),
    [analysis, selectedNozzle, selectedPrinter],
  );

  const selectPrinter = (printer: PrinterSummary) => {
    const full = printers.find((entry) => entry.id === printer.id);
    if (!full) return;
    const nozzle = defaultNozzle(full, analysis);
    const keepAll = keepAllColors && full.maxColors > 1;
    setSelectedPrinterId(full.id);
    setSelectedNozzle(nozzle);
    setSelectedProcess('');
    setKeepAllColors(keepAll);
    setColorMapping(defaultMapping(analysis, full, keepAll));
  };

  const handleFile = async (file: File) => {
    setError(undefined);
    if (!/\.3mf$/i.test(file.name)) {
      setError({ message: 'Only .3mf files are supported.' });
      return;
    }
    if (file.size > maxUploadMb * 1024 * 1024) {
      setError({ message: `The file exceeds the ${maxUploadMb} MB upload limit.` });
      return;
    }

    setFileName(file.name);
    setUploading(true);
    setUploadProgress({
      percent: 0,
      loaded: 0,
      total: file.size,
      phase: 'uploading',
    });
    setStage('upload');
    try {
      let availablePrinters = printers;
      if (availablePrinters.length === 0) {
        const catalog = await getPrinters();
        availablePrinters = catalog.printers;
        setPrinters(availablePrinters);
        if (catalog.maxUploadMb) setMaxUploadMb(catalog.maxUploadMb);
      }
      const response = await uploadFile(file, setUploadProgress);
      setUploadId(response.uploadId);
      setHasThumbnail(Boolean(response.hasThumbnail));
      setAnalysis(response.analysis);
      setKeepAllColors(false);
      const printer = defaultPrinter(response.analysis, availablePrinters);
      if (printer) {
        const nozzle = defaultNozzle(printer, response.analysis);
        setSelectedPrinterId(printer.id);
        setSelectedNozzle(nozzle);
        setSelectedProcess('');
        setColorMapping(defaultMapping(response.analysis, printer));
      }
      setStage('configure');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setAuthRequired(true);
        return;
      }
      setError({
        message: caught instanceof Error ? caught.message : t('error.upload'),
        details: caught instanceof ApiError ? caught.details : undefined,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleConvert = async () => {
    if (!uploadId || !selectedPrinter || !analysis) return;
    setError(undefined);
    setPollWarning(undefined);
    setStage('converting');
    setJob(undefined);
    try {
      let current = await createConversion(uploadId, {
        printerId: selectedPrinter.id,
        nozzle: selectedNozzle,
        processName: selectedProcess || undefined,
        colorMapping,
        preserveTemperatures,
        keepAllColors,
        layout,
      });
      setJob(current);
      let failures = 0;
      while (current.status === 'queued' || current.status === 'converting') {
        await delay(CONVERSION_POLL_MS);
        try {
          current = await getJob(current.id);
          failures = 0;
          setPollWarning(undefined);
          setJob(current);
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 404) {
            throw new ApiError(404, 'CONVERSION_LOST', t('error.interrupted'));
          }
          if (isTransientError(caught) && failures < MAX_POLL_FAILURES) {
            failures += 1;
            setPollWarning(t('progress.reconnecting'));
            await delay(Math.min(5_000, 1_000 * failures));
            continue;
          }
          throw caught;
        }
      }
      if (current.status === 'failed') {
        throw new ApiError(
          422,
          current.error?.code ?? 'CONVERSION_FAILED',
          current.error?.message ?? t('error.convert'),
          current.error?.details,
        );
      }
      setStage('done');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setAuthRequired(true);
        return;
      }
      setError({
        message: caught instanceof Error ? caught.message : t('error.convert'),
        details: caught instanceof ApiError ? caught.details : undefined,
      });
      setPollWarning(undefined);
      setStage('configure');
    }
  };

  const reset = () => {
    setStage('upload');
    setUploadId(undefined);
    setHasThumbnail(false);
    setAnalysis(undefined);
    setFileName(undefined);
    setJob(undefined);
    setError(undefined);
    setPollWarning(undefined);
    setUploadProgress(EMPTY_UPLOAD_PROGRESS);
    setSelectedProcess('');
    setColorMapping({});
    setKeepAllColors(false);
  };

  const handleKeepAllColors = (enabled: boolean) => {
    setKeepAllColors(enabled);
    setColorMapping(defaultMapping(analysis, selectedPrinter, enabled));
  };

  const handleAuth = async (token: string) => {
    setToken(token);
    setAuthError(undefined);
    try {
      const response = await getPrinters();
      setPrinters(response.printers);
      if (response.maxUploadMb) setMaxUploadMb(response.maxUploadMb);
      setAuthRequired(false);
      setAuthError(undefined);
    } catch (caught) {
      setAuthError(
        caught instanceof ApiError && caught.status === 401
          ? t('auth.invalid')
          : caught instanceof Error
            ? caught.message
            : t('error.generic'),
      );
    }
  };

  const conversionStageIndex = (() => {
    switch (job?.stage) {
      case 'profiling':
      case 'rewriting':
        return 2;
      case 'packaging':
      case 'validating':
        return 3;
      case 'completed':
        return 4;
      default:
        return 1;
    }
  })();
  const conversionProgress =
    job?.status === 'completed' ? 100 : Math.max(2, Math.round(job?.progress ?? 0));

  return (
    <div className="flex min-h-screen flex-col">
      <Header theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />

      <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 py-8 sm:px-8 sm:py-10">
        {authRequired ? (
          <div className="py-12">
            <AuthGate error={authError} onSubmit={(token) => void handleAuth(token)} />
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-5 flex items-start gap-3 rounded-sm border border-[var(--danger)]/30 bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-4">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--danger)]">{error.message}</div>
                  {error.details && error.details.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
                      {error.details.slice(0, 4).map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setError(undefined)}
                  className="focus-ring rounded-sm p-1 text-[var(--muted)] hover:text-[var(--text)]"
                  aria-label={t('error.dismiss')}
                >
                  <X className="size-4" />
                </button>
              </div>
            )}

            {stage === 'upload' && (
              <div className="rise">
                <div className="flex flex-wrap items-center justify-between gap-2 border-y border-[var(--border)] py-2">
                  <span className="mono-label text-[var(--accent)]">{t('hero.kicker')}</span>
                  <span className="mono-label text-[var(--muted)]">REV 0.3.0 / LOCAL INSTANCE</span>
                </div>

                <div className="grid items-start gap-10 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14 lg:py-14">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-1 bg-[var(--orange)]" />
                      <span className="mono-label text-[var(--muted)]">{t('hero.eyebrow')}</span>
                    </div>
                    <h1 className="hero-title mt-5 text-[2.9rem] font-semibold sm:text-6xl">
                      {t('hero.titleA')} <em>{t('hero.titleB')}</em>
                    </h1>
                    <p className="mt-6 max-w-xl text-[15px] leading-7 text-[var(--muted)]">
                      {t('hero.subtitle')}
                    </p>

                    <div className="mt-7 grid max-w-xl grid-cols-2 border-l border-t border-[var(--border)]">
                      {[
                        [t('hero.specTargets'), t('hero.specTargetsValue')],
                        [t('hero.specColors'), t('hero.specColorsValue')],
                        [t('hero.specProfiles'), t('hero.specProfilesValue')],
                        [t('hero.specPrivacy'), t('hero.specPrivacyValue')],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="border-b border-r border-[var(--border)] bg-[var(--surface)] px-4 py-3"
                        >
                          <div className="mono-label text-[var(--muted)]">{label}</div>
                          <div className="mt-1.5 text-sm font-semibold">{value}</div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[var(--muted)]">
                      <span className="inline-flex items-center gap-1.5">
                        <LockKeyhole className="size-3.5 text-[var(--accent)]" />
                        AGPL-3.0 · no telemetry
                      </span>
                    </div>
                  </div>

                  <Dropzone
                    maxMb={maxUploadMb}
                    uploading={uploading}
                    progress={uploadProgress}
                    fileName={fileName}
                    onFile={(file) => void handleFile(file)}
                  />
                </div>

                <div className="grid border border-[var(--border)] bg-[var(--surface)] lg:grid-cols-3">
                  {[
                    {
                      mark: '+',
                      title: t('landing.keptTitle'),
                      items: [
                        t('landing.kept1'),
                        t('landing.kept2'),
                        t('landing.kept3'),
                        t('landing.kept4'),
                      ],
                      color: 'var(--success)',
                    },
                    {
                      mark: '~',
                      title: t('landing.replacedTitle'),
                      items: [
                        t('landing.replaced1'),
                        t('landing.replaced2'),
                        t('landing.replaced3'),
                        t('landing.replaced4'),
                      ],
                      color: 'var(--accent)',
                    },
                    {
                      mark: '−',
                      title: t('landing.droppedTitle'),
                      items: [
                        t('landing.dropped1'),
                        t('landing.dropped2'),
                        t('landing.dropped3'),
                        t('landing.dropped4'),
                      ],
                      color: 'var(--orange)',
                    },
                  ].map((group) => (
                    <div
                      key={group.title}
                      className="border-b border-[var(--border)] p-4 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="grid size-5 place-items-center border font-mono text-[11px]"
                          style={{ color: group.color, borderColor: group.color }}
                        >
                          {group.mark}
                        </span>
                        <span className="text-xs font-semibold">{group.title}</span>
                      </div>
                      <ul className="mt-3 space-y-1.5">
                        {group.items.map((item) => (
                          <li
                            key={item}
                            className="flex gap-2 text-[11px] leading-5 text-[var(--muted)]"
                          >
                            <span className="mt-2 size-1 shrink-0 bg-[var(--border-strong)]" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
                  <div className="flex flex-wrap items-center gap-2 border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                    <span className="mono-label mr-2 text-[var(--muted)]">
                      {t('landing.supported')}
                    </span>
                    {(printers.length > 0
                      ? printers.map((printer) => printer.name)
                      : [
                          'FlashForge AD5X',
                          'Adventurer 5M',
                          'Adventurer 5M Pro',
                          'Creator 5',
                          'Creator 5 Pro',
                        ]
                    ).map((name) => (
                      <span
                        key={name}
                        className="border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] text-[var(--muted)]"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                    <span className="mono-label text-[var(--orange)]">WORKFLOW</span>
                    <span className="font-mono text-[10px] text-[var(--muted)]">
                      UPLOAD → MAP → CONVERT → OPEN IN FLASH STUDIO
                    </span>
                  </div>
                </div>
              </div>
            )}

            {stage !== 'upload' && (
              <div className="mb-6">
                <Steps current={stage === 'configure' ? 1 : stage === 'converting' ? 2 : 3} />
              </div>
            )}

            {stage === 'configure' && analysis && selectedPrinter && (
              <div className="space-y-4 rise">
                <div className="flex flex-wrap items-center justify-between gap-3 border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                  <button
                    type="button"
                    onClick={reset}
                    className="focus-ring inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-[var(--muted)] transition hover:text-[var(--text)]"
                  >
                    <ArrowLeft className="size-3.5" />
                    {t('common.back')}
                  </button>
                  <div className="font-mono text-[10px] text-[var(--muted)]">
                    {fileName} · {analysis ? formatBytes(analysis.fileSize) : ''}
                  </div>
                </div>

                {uploadId && hasThumbnail && (
                  <PreviewCard
                    uploadId={uploadId}
                    fileName={fileName}
                    plateCount={analysis.plates}
                  />
                )}

                <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
                  <AnalysisCard analysis={analysis} />

                  <section className="surface overflow-hidden">
                    <div className="h-[2px] bg-[var(--accent)]" />
                    <div className="p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="mono-label text-[var(--accent)]">TARGET / 02</div>
                          <h2 className="mt-1.5 text-base font-semibold">{t('configure.title')}</h2>
                        </div>
                        <div className="border border-[var(--border)] px-2 py-1 font-mono text-[10px] text-[var(--muted)]">
                          {selectedPrinter.id}
                        </div>
                      </div>
                      <p className="mt-2 max-w-xl text-xs leading-5 text-[var(--muted)]">
                        {t('configure.subtitle')}
                      </p>

                      <div className="mt-5 grid gap-4 sm:grid-cols-2">
                        <label className="block">
                          <span className="mono-label mb-1.5 block text-[var(--muted)]">
                            {t('configure.nozzle')}
                          </span>
                          <select
                            value={selectedNozzle}
                            onChange={(event) => {
                              setSelectedNozzle(event.target.value);
                              setSelectedProcess('');
                            }}
                            className="focus-ring h-10 w-full rounded-sm border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm"
                          >
                            {selectedPrinter.nozzles.map((entry) => (
                              <option key={entry.diameter} value={entry.diameter}>
                                {entry.diameter} mm
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="mono-label mb-1.5 block text-[var(--muted)]">
                            {t('configure.process')}
                          </span>
                          <select
                            value={selectedProcess}
                            onChange={(event) => setSelectedProcess(event.target.value)}
                            className="focus-ring h-10 w-full rounded-sm border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm"
                          >
                            <option value="">{t('configure.processAuto')}</option>
                            {selectedNozzleEntry?.processes.map((process) => (
                              <option key={process.name} value={process.name}>
                                {process.name}
                              </option>
                            ))}
                          </select>
                          <div className="mt-1.5 text-[10px] text-[var(--muted)]">
                            {selectedProcess || autoProcess || '—'}
                          </div>
                        </label>
                      </div>

                      <div className="mt-5 space-y-3">
                        <label className="flex items-start gap-3 border border-[var(--border)] bg-[var(--surface-2)] p-3">
                          <input
                            type="checkbox"
                            checked={preserveTemperatures}
                            onChange={(event) => setPreserveTemperatures(event.target.checked)}
                            className="mt-0.5 size-4 accent-[var(--accent)]"
                          />
                          <span>
                            <span className="block text-sm font-medium">
                              {t('configure.preserveTemps')}
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-5 text-[var(--muted)]">
                              {t('configure.preserveTempsHelp')}
                            </span>
                          </span>
                        </label>

                        <label className="block border border-[var(--border)] bg-[var(--surface-2)] p-3">
                          <span className="mono-label mb-1.5 block text-[var(--muted)]">
                            {t('configure.layout')}
                          </span>
                          <select
                            value={layout}
                            onChange={(event) =>
                              setLayout(
                                event.target.value as NonNullable<ConversionOptions['layout']>,
                              )
                            }
                            className="focus-ring h-9 w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
                          >
                            <option value="center">{t('configure.layoutCenter')}</option>
                            <option value="keep">{t('configure.layoutKeep')}</option>
                            <option value="scale">{t('configure.layoutScale')}</option>
                          </select>
                          <span className="mt-1.5 block text-[10px] leading-5 text-[var(--muted)]">
                            {t('configure.layoutHelp')}
                          </span>
                        </label>
                      </div>

                      <div className="mt-5 border-t border-[var(--border)] pt-3">
                        <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                          <span className="mono-label text-[var(--muted)]">
                            {t('configure.output')}
                          </span>
                          <span>{t('configure.outputValue')}</span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[10px]">
                          <span className="mono-label text-[var(--muted)]">
                            {t('configure.profileSource')}
                          </span>
                          <span>{selectedPrinter.compatibility.templateSource}</span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[10px]">
                          <span className="mono-label text-[var(--muted)]">
                            {t('configure.reportIncluded')}
                          </span>
                          <span>{t('configure.reportIncludedValue')}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleConvert()}
                        disabled={!selectedNozzleEntry}
                        className="focus-ring mt-4 inline-flex w-full items-center justify-center gap-2 bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ArrowRight className="size-4" />
                        {t('configure.convert', { printer: selectedPrinter.name })}
                        <ChevronRight className="size-4" />
                      </button>
                    </div>
                  </section>
                </div>

                <section className="surface overflow-hidden">
                  <div className="h-[2px] bg-[var(--orange)]" />
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="mono-label text-[var(--orange)]">PRINTER / 03</div>
                        <h2 className="mt-1.5 text-base font-semibold">{t('configure.printer')}</h2>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {selectedPrinter.compatibility.flashStudio}
                        </p>
                      </div>
                      <div className="border border-[var(--border)] px-2.5 py-1 font-mono text-[10px] text-[var(--muted)]">
                        {selectedPrinter.compatibility.templateSource}
                      </div>
                    </div>
                    <div className="mt-4">
                      <PrinterPicker
                        printers={printers}
                        selectedId={selectedPrinterId}
                        onSelect={selectPrinter}
                      />
                    </div>
                  </div>
                </section>

                <ColorMapping
                  printer={selectedPrinter}
                  analysis={analysis}
                  mapping={colorMapping}
                  keepAllColors={keepAllColors}
                  onKeepAllColorsChange={handleKeepAllColors}
                  onChange={setColorMapping}
                />
              </div>
            )}

            {stage === 'converting' && (
              <div className="mx-auto max-w-2xl rise">
                <section className="surface overflow-hidden">
                  <div className="h-[2px] bg-[var(--accent)]" />
                  <div className="p-6 sm:p-8">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="mono-label text-[var(--accent)]">EXECUTION / 03</div>
                        <h2 className="mt-1.5 text-lg font-semibold">{t('progress.title')}</h2>
                      </div>
                      <div className="grid size-10 place-items-center border border-[var(--accent)]/35 bg-[var(--accent-soft)] text-[var(--accent)]">
                        <Loader2 className="size-5 animate-spin" />
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 border-t border-l border-[var(--border)] font-mono text-[10px]">
                      <div className="border-b border-r border-[var(--border)] px-3 py-2">
                        <div className="mono-label text-[var(--muted)]">TARGET</div>
                        <div className="mt-1">{selectedPrinter?.name}</div>
                      </div>
                      <div className="border-b border-r border-[var(--border)] px-3 py-2">
                        <div className="mono-label text-[var(--muted)]">NOZZLE</div>
                        <div className="mt-1">{selectedNozzle} mm</div>
                      </div>
                      <div className="border-b border-r border-[var(--border)] px-3 py-2">
                        <div className="mono-label text-[var(--muted)]">PLATES</div>
                        <div className="mt-1">{analysis?.plates ?? 1}</div>
                      </div>
                      <div className="border-b border-r border-[var(--border)] px-3 py-2">
                        <div className="mono-label text-[var(--muted)]">COLOURS</div>
                        <div className="mt-1">{analysis?.usedColorCount ?? 1}</div>
                      </div>
                    </div>

                    <div className="mt-6">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="text-[var(--text)]">{t(stageLabelKey(job?.stage))}</span>
                        <span className="font-mono text-[10px] text-[var(--muted)]">
                          {conversionProgress}%
                        </span>
                      </div>
                      <div className="progress-track mt-2 h-2 overflow-hidden">
                        <div
                          className="progress-bar h-full transition-[width] duration-500"
                          style={{ width: `${conversionProgress}%` }}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 font-mono text-[10px] text-[var(--muted)]">
                        <span>
                          {t('progress.elapsed', { time: formatElapsed(elapsedSeconds) })}
                        </span>
                        <span className="max-w-[340px] text-right">{t('progress.hint')}</span>
                      </div>
                    </div>

                    {pollWarning && (
                      <div className="mt-3 border border-[var(--orange)]/40 bg-[var(--orange-soft)] px-3 py-2 text-[11px] leading-5 text-[var(--orange)]">
                        {pollWarning}
                      </div>
                    )}

                    <ul className="mt-6 space-y-2">
                      {[
                        t('progress.upload'),
                        t('progress.analyse'),
                        t('progress.config'),
                        t('progress.package'),
                      ].map((label, index) => {
                        const done = index < conversionStageIndex;
                        const active = index === conversionStageIndex;
                        return (
                          <li key={label} className="flex items-center gap-2.5 text-xs">
                            <span
                              className={cn(
                                'grid size-5 place-items-center border font-mono text-[10px]',
                                done &&
                                  'border-[var(--success)]/40 bg-[color-mix(in_srgb,var(--success)_12%,var(--surface))] text-[var(--success)]',
                                active &&
                                  'border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]',
                                !done && !active && 'border-[var(--border)] text-[var(--muted)]',
                              )}
                            >
                              {done ? (
                                <Check className="size-3" />
                              ) : active ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                index + 1
                              )}
                            </span>
                            <span
                              className={cn(
                                'transition-colors',
                                done || active ? 'text-[var(--text)]' : 'text-[var(--muted)]',
                              )}
                            >
                              {label}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </section>
              </div>
            )}

            {stage === 'done' && job && job.report && (
              <ReportView job={job} report={job.report} onNew={reset} />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-[var(--border)] py-6">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-2 px-5 font-mono text-[10px] leading-5 text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="max-w-3xl">{t('footer.disclaimer')}</p>
          <div className="flex shrink-0 items-center gap-3">
            <span>{t('footer.license')}</span>
            <span>·</span>
            <span>{t('footer.local')}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
