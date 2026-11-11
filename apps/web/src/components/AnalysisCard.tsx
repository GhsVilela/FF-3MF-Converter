import {
  AlertTriangle,
  CaseSensitive,
  Layers3,
  Paintbrush,
  ShieldAlert,
  Triangle,
} from 'lucide-react';
import type { SourceAnalysis } from '@open3mf/shared';
import { useI18n } from '../lib/i18n';

function Value({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/60 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-medium" title={String(value ?? '—')}>
        {value === undefined || value === null || value === '' ? '—' : value}
      </div>
    </div>
  );
}

export function AnalysisCard({ analysis }: { analysis: SourceAnalysis }) {
  const { t } = useI18n();
  const usedColors = analysis.colors.filter((color) => color.used);

  return (
    <section className="surface rounded-3xl p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t('analysis.title')}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{analysis.fileName}</p>
        </div>
        <div className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[10px] font-medium text-[var(--muted)]">
          {analysis.sourceApp}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Value label={t('analysis.printer')} value={analysis.sourcePrinter} />
        <Value label={t('analysis.process')} value={analysis.sourceProcess} />
        <Value
          label={t('analysis.layerHeight')}
          value={analysis.layerHeight ? `${analysis.layerHeight} mm` : undefined}
        />
        <Value
          label={t('analysis.nozzle')}
          value={analysis.nozzle ? `${analysis.nozzle} mm` : undefined}
        />
        <Value label={t('analysis.plates')} value={analysis.plates} />
        <Value label={t('analysis.objects')} value={analysis.objects} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1">
          <Triangle className="size-3" /> {analysis.triangles.toLocaleString()} triangles
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1">
          <Layers3 className="size-3" /> {analysis.plates} plate{analysis.plates === 1 ? '' : 's'}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1">
          <Paintbrush className="size-3" /> {usedColors.length} colour
          {usedColors.length === 1 ? '' : 's'}
        </span>
        {analysis.hasCustomSupports && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1">
            <ShieldAlert className="size-3" /> painted supports
          </span>
        )}
        {analysis.hasCustomSeams && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 py-1">
            <CaseSensitive className="size-3" /> painted seams
          </span>
        )}
      </div>

      <div className="mt-5">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
          {t('analysis.colors')}
        </div>
        <div className="flex flex-wrap gap-2">
          {analysis.colors.map((color) => (
            <div
              key={color.slot}
              className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)]/60 px-2.5 py-1.5 text-xs"
              title={`${color.name} · ${color.type}${color.used ? '' : ' (unused)'}`}
            >
              <span
                className="size-3.5 rounded-full border border-black/20"
                style={{ backgroundColor: color.color }}
              />
              <span className={color.used ? 'font-medium' : 'text-[var(--muted)]'}>
                {color.type} · {color.slot}
              </span>
            </div>
          ))}
        </div>
      </div>

      {!analysis.hasProjectSettings && (
        <div className="mt-5 flex gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
          <div>
            <div className="text-sm font-medium">{t('analysis.noSettings')}</div>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              {t('analysis.noSettingsHelp')}
            </p>
          </div>
        </div>
      )}

      {analysis.warnings.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
            <AlertTriangle className="size-3.5" /> {t('analysis.warnings')}
          </div>
          <ul className="space-y-1.5">
            {analysis.warnings.map((warning) => (
              <li
                key={warning}
                className="rounded-lg bg-[var(--surface-2)]/60 px-3 py-2 text-xs leading-5 text-[var(--muted)]"
              >
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
