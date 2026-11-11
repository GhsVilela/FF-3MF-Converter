import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson2,
  Layers3,
  Palette,
  RotateCcw,
  Settings2,
  Sparkles,
} from 'lucide-react';
import type { ChangeEntry, ConversionReport } from '@open3mf/shared';
import { formatBytes, formatDuration, downloadUrl, type JobResponse } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';

type Tab = 'settings' | 'filaments' | 'plates';
type Filter = 'all' | 'kept' | 'changed' | 'dropped';

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) {
    const text = value.map((entry) => String(entry)).join(', ');
    return text.length > 100 ? `${text.slice(0, 97)}…` : text;
  }
  if (typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > 100 ? `${text.slice(0, 97)}…` : text;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function DecisionBadge({ entry }: { entry: ChangeEntry }) {
  const { t } = useI18n();
  const className =
    entry.decision === 'kept'
      ? 'badge-kept'
      : entry.decision === 'dropped'
        ? 'badge-dropped'
        : 'badge-changed';
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold',
        className,
      )}
    >
      {t(`decision.${entry.decision}` as 'decision.kept')}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]/55 px-4 py-3',
        accent && 'border-[var(--accent)]/30 bg-[var(--accent-soft)]',
      )}
    >
      <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-xl font-semibold tracking-tight',
          accent && 'text-[var(--accent)]',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function FlashStudioGuide() {
  const { t } = useI18n();
  return (
    <section className="surface rounded-3xl p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-[var(--accent)]" />
        <h2 className="text-base font-semibold">{t('flash.title')}</h2>
      </div>
      <ol className="mt-4 grid gap-2.5 sm:grid-cols-2">
        {[1, 2, 3, 4].map((step) => (
          <li
            key={step}
            className="flex gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]/45 p-3"
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent)]">
              {step}
            </span>
            <span className="text-xs leading-5 text-[var(--muted)]">
              {t(`flash.step${step}` as 'flash.step1')}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-[var(--warning)]">
        {t('flash.note')}
      </p>
    </section>
  );
}

export function ReportView({
  job,
  report,
  onNew,
}: {
  job: JobResponse;
  report: ConversionReport;
  onNew: () => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('settings');
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return report.settings;
    if (filter === 'kept') return report.settings.filter((entry) => entry.decision === 'kept');
    if (filter === 'dropped')
      return report.settings.filter((entry) => entry.decision === 'dropped');
    return report.settings.filter((entry) =>
      ['translated', 'clamped', 'replaced'].includes(entry.decision),
    );
  }, [filter, report.settings]);

  const downloadReport = () => {
    const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${report.source.fileName.replace(/\.3mf$/i, '')}_report.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const tabs: Array<{ id: Tab; label: string; icon: typeof Settings2 }> = [
    { id: 'settings', label: t('tabs.settings'), icon: Settings2 },
    { id: 'filaments', label: t('tabs.filaments'), icon: Palette },
    { id: 'plates', label: t('tabs.plates'), icon: Layers3 },
  ];

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: t('filter.all') },
    { id: 'kept', label: t('filter.kept') },
    { id: 'changed', label: t('filter.changed') },
    { id: 'dropped', label: t('filter.dropped') },
  ];

  return (
    <div className="space-y-4 rise">
      <section className="surface overflow-hidden rounded-3xl">
        <div className="border-b border-[var(--border)] bg-[linear-gradient(120deg,var(--accent-soft),transparent_60%)] p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex gap-4">
              <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-[var(--success)]">
                <CheckCircle2 className="size-6" />
              </div>
              <div>
                <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
                  {t('result.title')}
                </h2>
                <p className="mt-1 max-w-xl text-sm leading-6 text-[var(--muted)]">
                  {t('result.subtitle')}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={downloadUrl(job.id)}
                className="focus-ring inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:brightness-110"
              >
                <Download className="size-4" />
                {t('result.download')}
              </a>
              <button
                type="button"
                onClick={onNew}
                className="focus-ring inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2.5 text-sm font-medium transition hover:border-[var(--accent)]/40"
              >
                <RotateCcw className="size-4" />
                {t('result.new')}
              </button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <SummaryCard
              label={t('result.targetPrinter')}
              value={report.target.printerName}
              accent
            />
            <SummaryCard label={t('result.targetProcess')} value={report.target.processName} />
            <SummaryCard
              label={t('result.duration')}
              value={formatDuration(report.stats.durationMs)}
            />
            <SummaryCard
              label={t('result.download')}
              value={formatBytes(report.stats.outputBytes)}
            />
          </div>
        </div>

        {report.warnings.length > 0 && (
          <div className="border-b border-[var(--border)] p-5 sm:p-6">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
              <AlertTriangle className="size-3.5" /> {t('result.warnings')}
            </div>
            <ul className="space-y-1.5">
              {report.warnings.map((warning) => (
                <li
                  key={warning}
                  className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs leading-5 text-[var(--warning)]"
                >
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 pt-5 sm:px-6">
          <div>
            <div className="text-sm font-semibold">{t('result.report')}</div>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{t('result.reportHelp')}</p>
          </div>
          <button
            type="button"
            onClick={downloadReport}
            className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:text-[var(--text)]"
          >
            <FileJson2 className="size-3.5" />
            {t('result.downloadReport')}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 sm:px-6">
          <div className="flex gap-1">
            {tabs.map((entry) => {
              const Icon = entry.icon;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  className={cn(
                    'focus-ring inline-flex items-center gap-2 rounded-t-lg border-b-2 px-3 py-2.5 text-xs font-medium transition',
                    tab === entry.id
                      ? 'border-[var(--accent)] text-[var(--text)]'
                      : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]',
                  )}
                >
                  <Icon className="size-3.5" />
                  {entry.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {tab === 'settings' && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {filters.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setFilter(entry.id)}
                    className={cn(
                      'focus-ring rounded-full border px-2.5 py-1 text-[10px] font-medium transition',
                      filter === entry.id
                        ? 'border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]',
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
                <span className="ml-auto text-[10px] text-[var(--muted)]">
                  {filtered.length} / {report.settings.length}
                </span>
              </div>
              <div className="max-h-[520px] overflow-auto rounded-2xl border border-[var(--border)] scroll-thin">
                <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[var(--surface-2)] text-[10px] uppercase tracking-wider text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">{t('table.key')}</th>
                      <th className="px-3 py-2.5 font-medium">{t('table.decision')}</th>
                      <th className="px-3 py-2.5 font-medium">{t('table.source')}</th>
                      <th className="px-3 py-2.5 font-medium">{t('table.target')}</th>
                      <th className="px-3 py-2.5 font-medium">{t('table.reason')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((entry, index) => (
                      <tr
                        key={`${entry.key}-${index}`}
                        className="border-t border-[var(--border)] align-top hover:bg-[var(--surface-2)]/45"
                      >
                        <td
                          className="max-w-[180px] truncate px-3 py-2 font-mono text-[11px]"
                          title={entry.key}
                        >
                          {entry.key}
                        </td>
                        <td className="px-3 py-2">
                          <DecisionBadge entry={entry} />
                        </td>
                        <td
                          className="max-w-[180px] px-3 py-2 text-[var(--muted)]"
                          title={formatValue(entry.sourceValue)}
                        >
                          {formatValue(entry.sourceValue)}
                        </td>
                        <td
                          className="max-w-[180px] px-3 py-2"
                          title={formatValue(entry.targetValue)}
                        >
                          {formatValue(entry.targetValue)}
                        </td>
                        <td className="max-w-[260px] px-3 py-2 text-[var(--muted)]">
                          {entry.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <div className="px-4 py-8 text-center text-xs text-[var(--muted)]">
                    {t('table.empty')}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'filaments' && (
            <div className="overflow-auto rounded-2xl border border-[var(--border)] scroll-thin">
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead className="bg-[var(--surface-2)] text-[10px] uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">{t('filaments.source')}</th>
                    <th className="px-3 py-2.5 font-medium">{t('filaments.colour')}</th>
                    <th className="px-3 py-2.5 font-medium">{t('filaments.target')}</th>
                    <th className="px-3 py-2.5 font-medium">{t('filaments.preset')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.filaments.map((filament) => (
                    <tr key={filament.sourceSlot} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2.5">
                        <div className="font-medium">Slot {filament.sourceSlot}</div>
                        <div className="text-[10px] text-[var(--muted)]">{filament.sourceType}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-4 rounded-full border border-black/20"
                            style={{ backgroundColor: filament.sourceColor }}
                          />
                          <span className="font-mono text-[10px]">{filament.sourceColor}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Slot {filament.targetSlot}</span>
                          {filament.merged && (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-[var(--warning)]">
                              {t('filaments.merged')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
                          <span
                            className="size-3 rounded-full border border-black/20"
                            style={{ backgroundColor: filament.targetColor }}
                          />
                          {filament.targetColor}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[11px]">{filament.targetPreset}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'plates' && (
            <div className="grid gap-3 sm:grid-cols-2">
              {report.plates.map((plate) => (
                <div
                  key={plate.plate}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]/50 p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Layers3 className="size-4 text-[var(--accent)]" />
                      {t('plates.plate', { number: plate.plate })}
                    </div>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                        plate.fits ? 'badge-kept' : 'badge-dropped',
                      )}
                    >
                      {plate.fits ? t('plates.fits') : '!'}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-[var(--muted)]">
                    {t('plates.objects', { count: plate.objects })}
                    {plate.moved ? ` · ${t('plates.moved')}` : ''}
                  </div>
                  {plate.note && (
                    <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">{plate.note}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <FlashStudioGuide />
    </div>
  );
}
