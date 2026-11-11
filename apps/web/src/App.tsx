import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { ConversionOptions, PrinterSummary, SourceAnalysis } from '@open3mf/shared';
import { Header } from './components/Header';
import { Steps } from './components/Steps';
import { Dropzone } from './components/Dropzone';
import { AnalysisCard } from './components/AnalysisCard';
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
} from './lib/api';
import { useI18n } from './lib/i18n';
import { cn } from './lib/utils';

type Stage = 'upload' | 'configure' | 'converting' | 'done';

const DEFAULT_MAX_UPLOAD_MB = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
): Record<string, number> {
  if (!analysis || !printer) return {};
  const used = analysis.colors.filter((color) => color.used);
  const result: Record<string, number> = {};
  used.forEach((color, index) => {
    result[String(color.slot)] = printer.maxColors === 1 ? 1 : (index % printer.maxColors) + 1;
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
    localStorage.getItem('open3mf-theme') === 'light' ? 'light' : 'dark',
  );
  const [printers, setPrinters] = useState<PrinterWithMaterials[]>([]);
  const [maxUploadMb, setMaxUploadMb] = useState(DEFAULT_MAX_UPLOAD_MB);
  const [stage, setStage] = useState<Stage>('upload');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileName, setFileName] = useState<string>();
  const [uploadId, setUploadId] = useState<string>();
  const [analysis, setAnalysis] = useState<SourceAnalysis>();
  const [selectedPrinterId, setSelectedPrinterId] = useState('');
  const [selectedNozzle, setSelectedNozzle] = useState('0.4');
  const [selectedProcess, setSelectedProcess] = useState('');
  const [colorMapping, setColorMapping] = useState<Record<string, number>>({});
  const [preserveTemperatures, setPreserveTemperatures] = useState(true);
  const [layout, setLayout] = useState<NonNullable<ConversionOptions['layout']>>('center');
  const [job, setJob] = useState<JobResponse>();
  const [error, setError] = useState<{ message: string; details?: string[] }>();
  const [authRequired, setAuthRequired] = useState(false);
  const [authError, setAuthError] = useState<string>();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('open3mf-theme', theme);
  }, [theme]);

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
    setSelectedPrinterId(full.id);
    setSelectedNozzle(nozzle);
    setSelectedProcess('');
    setColorMapping(defaultMapping(analysis, full));
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
    setUploadProgress(0);
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
      setAnalysis(response.analysis);
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
    setStage('converting');
    setJob(undefined);
    try {
      let current = await createConversion(uploadId, {
        printerId: selectedPrinter.id,
        nozzle: selectedNozzle,
        processName: selectedProcess || undefined,
        colorMapping,
        preserveTemperatures,
        layout,
      });
      setJob(current);
      while (current.status === 'queued' || current.status === 'converting') {
        await delay(650);
        current = await getJob(current.id);
        setJob(current);
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
      setStage('configure');
    }
  };

  const reset = () => {
    setStage('upload');
    setUploadId(undefined);
    setAnalysis(undefined);
    setFileName(undefined);
    setJob(undefined);
    setError(undefined);
    setSelectedProcess('');
    setColorMapping({});
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

  return (
    <div className="flex min-h-screen flex-col">
      <Header theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8 sm:py-12">
        {authRequired ? (
          <div className="py-12">
            <AuthGate error={authError} onSubmit={(token) => void handleAuth(token)} />
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[var(--danger)]/30 bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-4">
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
                  className="focus-ring rounded-lg p-1 text-[var(--muted)] hover:text-[var(--text)]"
                  aria-label={t('error.dismiss')}
                >
                  <X className="size-4" />
                </button>
              </div>
            )}

            {stage === 'upload' && (
              <div className="rise">
                <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)]/60 px-3 py-1 text-[11px] font-medium text-[var(--muted)]">
                      <ShieldCheck className="size-3.5 text-[var(--success)]" />
                      {t('hero.eyebrow')}
                    </div>
                    <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.4rem]">
                      {t('hero.title')}
                    </h1>
                    <p className="mt-5 max-w-xl text-base leading-7 text-[var(--muted)]">
                      {t('hero.subtitle')}
                    </p>
                    <div className="mt-6 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)]/50 px-3 py-1.5">
                        <Check className="size-3 text-[var(--success)]" /> 5 printers
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)]/50 px-3 py-1.5">
                        <Check className="size-3 text-[var(--success)]" /> 4-colour projects
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)]/50 px-3 py-1.5">
                        <LockKeyhole className="size-3 text-[var(--success)]" /> {t('hero.privacy')}
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

                <div className="mt-14 grid gap-3 sm:grid-cols-3">
                  {[
                    [
                      '01',
                      'Any 3MF project',
                      'Bambu Studio, OrcaSlicer, Creality, Anycubic, Prusa and plain geometry.',
                    ],
                    [
                      '02',
                      'Author intent',
                      'Layers, walls, infill, supports, temperatures, painted colours and plates.',
                    ],
                    [
                      '03',
                      'Flash Studio ready',
                      'A transparent report explains every kept, adapted and dropped setting.',
                    ],
                  ].map(([number, title, copy]) => (
                    <div
                      key={number}
                      className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/45 p-4"
                    >
                      <div className="text-[10px] font-semibold tracking-widest text-[var(--accent)]">
                        {number}
                      </div>
                      <div className="mt-2 text-sm font-semibold">{title}</div>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{copy}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  {[
                    {
                      title: t('landing.keptTitle'),
                      items: [
                        t('landing.kept1'),
                        t('landing.kept2'),
                        t('landing.kept3'),
                        t('landing.kept4'),
                      ],
                      dot: 'var(--success)',
                    },
                    {
                      title: t('landing.replacedTitle'),
                      items: [
                        t('landing.replaced1'),
                        t('landing.replaced2'),
                        t('landing.replaced3'),
                        t('landing.replaced4'),
                      ],
                      dot: 'var(--accent)',
                    },
                    {
                      title: t('landing.droppedTitle'),
                      items: [
                        t('landing.dropped1'),
                        t('landing.dropped2'),
                        t('landing.dropped3'),
                        t('landing.dropped4'),
                      ],
                      dot: 'var(--danger)',
                    },
                  ].map((group) => (
                    <div
                      key={group.title}
                      className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/45 p-4"
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: group.dot }}
                        />
                        {group.title}
                      </div>
                      <ul className="mt-3 space-y-1.5">
                        {group.items.map((item) => (
                          <li
                            key={item}
                            className="flex gap-2 text-[11px] leading-5 text-[var(--muted)]"
                          >
                            <span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--border)]" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/35 px-4 py-3">
                  <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                    {t('landing.supported')}
                  </span>
                  {['AD5X', 'Adventurer 5M', 'Adventurer 5M Pro', 'Creator 5', 'Creator 5 Pro'].map(
                    (name) => (
                      <span
                        key={name}
                        className="rounded-full border border-[var(--border)] bg-[var(--surface-2)]/60 px-2.5 py-1 text-[10px] text-[var(--muted)]"
                      >
                        {name}
                      </span>
                    ),
                  )}
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={reset}
                    className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                  >
                    <ArrowLeft className="size-3.5" />
                    {t('common.back')}
                  </button>
                  <div className="text-xs text-[var(--muted)]">
                    {fileName} · {analysis ? formatBytes(analysis.fileSize) : ''}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
                  <AnalysisCard analysis={analysis} />

                  <section className="surface rounded-3xl p-5 sm:p-6">
                    <h2 className="text-base font-semibold">{t('configure.title')}</h2>
                    <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--muted)]">
                      {t('configure.subtitle')}
                    </p>

                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                          {t('configure.nozzle')}
                        </span>
                        <select
                          value={selectedNozzle}
                          onChange={(event) => {
                            setSelectedNozzle(event.target.value);
                            setSelectedProcess('');
                          }}
                          className="focus-ring h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm"
                        >
                          {selectedPrinter.nozzles.map((entry) => (
                            <option key={entry.diameter} value={entry.diameter}>
                              {entry.diameter} mm
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                          {t('configure.process')}
                        </span>
                        <select
                          value={selectedProcess}
                          onChange={(event) => setSelectedProcess(event.target.value)}
                          className="focus-ring h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm"
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
                      <label className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/45 p-3">
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

                      <label className="block rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/45 p-3">
                        <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
                          {t('configure.layout')}
                        </span>
                        <select
                          value={layout}
                          onChange={(event) =>
                            setLayout(
                              event.target.value as NonNullable<ConversionOptions['layout']>,
                            )
                          }
                          className="focus-ring h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-sm"
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

                    <button
                      type="button"
                      onClick={() => void handleConvert()}
                      disabled={!selectedNozzleEntry}
                      className="focus-ring mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Sparkles className="size-4" />
                      {t('configure.convert', { printer: selectedPrinter.name })}
                      <ChevronRight className="size-4" />
                    </button>
                  </section>
                </div>

                <section className="surface rounded-3xl p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold">{t('configure.printer')}</h2>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {selectedPrinter.compatibility.flashStudio}
                      </p>
                    </div>
                    <div className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--muted)]">
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
                </section>

                <ColorMapping
                  printer={selectedPrinter}
                  analysis={analysis}
                  mapping={colorMapping}
                  onChange={setColorMapping}
                />
              </div>
            )}

            {stage === 'converting' && (
              <div className="mx-auto max-w-xl rise">
                <section className="surface rounded-3xl p-6 sm:p-8">
                  <div className="flex items-center gap-4">
                    <div className="grid size-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                      <Loader2 className="size-6 animate-spin" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold">{t('progress.title')}</h2>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {selectedPrinter?.name} · {selectedNozzle} mm
                      </p>
                    </div>
                  </div>

                  <div className="mt-6">
                    <div className="progress-track h-2 overflow-hidden rounded-full">
                      <div
                        className="progress-bar h-full rounded-full"
                        style={{ width: `${job?.progress ?? 5}%` }}
                      />
                    </div>
                    <div className="mt-2 flex justify-between text-[11px] text-[var(--muted)]">
                      <span>
                        {job?.status === 'queued' ? t('progress.analyse') : t('progress.config')}
                      </span>
                      <span>{job?.progress ?? 0}%</span>
                    </div>
                  </div>

                  <ul className="mt-6 space-y-2">
                    {[
                      t('progress.upload'),
                      t('progress.analyse'),
                      t('progress.config'),
                      t('progress.package'),
                    ].map((label, index) => {
                      const progress = job?.progress ?? 0;
                      const threshold = [5, 25, 60, 85][index] ?? 0;
                      const done = progress >= threshold;
                      return (
                        <li key={label} className="flex items-center gap-2.5 text-xs">
                          <span
                            className={cn(
                              'grid size-5 place-items-center rounded-full border',
                              done
                                ? 'border-[var(--success)]/40 bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-[var(--success)]'
                                : 'border-[var(--border)] text-[var(--muted)]',
                            )}
                          >
                            {done ? <Check className="size-3" /> : index + 1}
                          </span>
                          <span className={done ? 'text-[var(--text)]' : 'text-[var(--muted)]'}>
                            {label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
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
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 text-[10px] leading-5 text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
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
