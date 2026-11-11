import { Check, Layers3, Palette, Printer as PrinterIcon } from 'lucide-react';
import type { PrinterSummary } from '@open3mf/shared';
import type { PrinterWithMaterials } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { cn, parseBed } from '../lib/utils';

interface PrinterPickerProps {
  printers: PrinterWithMaterials[];
  selectedId: string;
  onSelect: (printer: PrinterSummary) => void;
}

export function PrinterPicker({ printers, selectedId, onSelect }: PrinterPickerProps) {
  const { t } = useI18n();

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {printers.map((printer) => {
        const selected = printer.id === selectedId;
        const bed = parseBed(printer.nozzles[0]?.build.area ?? []);
        const nozzles = printer.nozzles.map((nozzle) => nozzle.diameter).join(' / ');
        return (
          <button
            key={printer.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(printer)}
            className={cn(
              'focus-ring group relative overflow-hidden rounded-2xl border p-4 text-left transition',
              selected
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] shadow-lg shadow-orange-500/10'
                : 'border-[var(--border)] bg-[var(--surface-2)]/45 hover:border-[var(--accent)]/50 hover:bg-[var(--surface-2)]',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'grid size-10 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface)]',
                    selected && 'border-[var(--accent)]/40 text-[var(--accent)]',
                  )}
                >
                  <PrinterIcon className="size-5" strokeWidth={1.8} />
                </div>
                <div>
                  <div className="text-sm font-semibold leading-tight">{printer.name}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--muted)]">{printer.series}</div>
                </div>
              </div>
              {selected && (
                <div className="grid size-5 place-items-center rounded-full bg-[var(--accent)] text-white">
                  <Check className="size-3" strokeWidth={3} />
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2 py-1">
                <Layers3 className="size-3" />
                {bed.width} × {bed.height} mm
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2 py-1">
                <Palette className="size-3" />
                {printer.maxColors === 1
                  ? t('configure.oneColor')
                  : t('configure.maxColors', { count: printer.maxColors })}
              </span>
            </div>

            <div className="mt-3 truncate text-[10px] text-[var(--muted)]" title={nozzles}>
              {nozzles} mm
            </div>
          </button>
        );
      })}
    </div>
  );
}
