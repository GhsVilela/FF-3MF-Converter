import { ArrowRight, Palette } from 'lucide-react';
import type { SourceAnalysis } from '@ff3mf/shared';
import type { PrinterWithMaterials } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface ColorMappingProps {
  printer: PrinterWithMaterials;
  analysis: SourceAnalysis;
  mapping: Record<string, number>;
  onChange: (mapping: Record<string, number>) => void;
}

export function ColorMapping({ printer, analysis, mapping, onChange }: ColorMappingProps) {
  const { t } = useI18n();
  const used = analysis.colors.filter((color) => color.used);
  const slots = Array.from({ length: printer.maxColors }, (_, index) => index + 1);

  if (used.length === 0) return null;

  return (
    <section className="surface overflow-hidden">
      <div className="h-[2px] bg-[var(--accent)]" />
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <Palette className="size-4 text-[var(--accent)]" />
          <h2 className="text-base font-semibold">{t('configure.colors')}</h2>
          <span className="mono-label ml-auto text-[var(--muted)]">SLOT MAPPING</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t('configure.colorsHelp')}</p>

        {printer.maxColors === 1 ? (
          <div className="mt-4 border border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm">
            <div className="flex items-center gap-3">
              <span
                className="size-8 rounded-full border border-black/20"
                style={{ backgroundColor: used[0]?.color }}
              />
              <div>
                <div className="font-medium">
                  {used[0]?.type} · {t('configure.targetSlot')} 1
                </div>
                <div className="text-xs text-[var(--muted)]">{used[0]?.color}</div>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
              {t('configure.singleColor')}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {used.map((color) => {
              const current = mapping[String(color.slot)] ?? 1;
              const shared = used.filter(
                (candidate) =>
                  (mapping[String(candidate.slot)] ?? 1) === current &&
                  candidate.slot !== color.slot,
              );
              return (
                <div
                  key={color.slot}
                  className="flex flex-wrap items-center gap-3 border border-[var(--border)] bg-[var(--surface-2)] p-3"
                >
                  <span
                    className="size-8 shrink-0 rounded-full border border-black/20"
                    style={{ backgroundColor: color.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {color.type} · slot {color.slot}
                    </div>
                    <div className="truncate text-[11px] text-[var(--muted)]">{color.name}</div>
                  </div>
                  <div className="flex items-center gap-2 text-[var(--muted)]">
                    <ArrowRight className="size-3.5" />
                    <select
                      value={current}
                      onChange={(event) =>
                        onChange({ ...mapping, [String(color.slot)]: Number(event.target.value) })
                      }
                      className="focus-ring border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 font-mono text-xs text-[var(--text)]"
                      aria-label={`Target slot for source filament ${color.slot}`}
                    >
                      {slots.map((slot) => (
                        <option key={slot} value={slot}>
                          Slot {slot}
                        </option>
                      ))}
                    </select>
                  </div>
                  {shared.length > 0 && (
                    <span className="border border-[var(--orange)]/35 bg-[var(--orange-soft)] px-2 py-1 font-mono text-[10px] font-medium text-[var(--warning)]">
                      {t('filaments.merged')}
                    </span>
                  )}
                </div>
              );
            })}
            {used.length > printer.maxColors && (
              <div className="rounded-sm border border-[var(--orange)]/30 bg-[var(--orange-soft)] px-3 py-2 text-xs leading-5 text-[var(--warning)]">
                {t('configure.mergeNote')}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
