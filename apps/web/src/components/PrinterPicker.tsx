import { Check, Layers3, Palette, Printer as PrinterIcon } from 'lucide-react';
import type { PrinterSummary } from '@ff3mf/shared';
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
              'focus-ring group relative border bg-[var(--surface)] p-4 text-left transition',
              selected
                ? 'border-[var(--accent)] shadow-[inset_0_0_0_1px_var(--accent)]'
                : 'border-[var(--border)] hover:border-[var(--border-strong)]',
            )}
          >
            {selected && <span className="absolute inset-x-0 top-0 h-[2px] bg-[var(--accent)]" />}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'grid size-9 place-items-center border',
                    selected
                      ? 'border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]',
                  )}
                >
                  <PrinterIcon className="size-4.5" strokeWidth={1.8} />
                </div>
                <div>
                  <div className="text-sm font-semibold leading-tight">{printer.name}</div>
                  <div className="mono-label mt-1 text-[var(--muted)]">{printer.id}</div>
                </div>
              </div>
              {selected && (
                <span className="grid size-5 place-items-center bg-[var(--accent)] text-white">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 border-t border-l border-[var(--border)]">
              <div className="border-b border-r border-[var(--border)] px-2.5 py-2">
                <div className="mono-label text-[var(--muted)]">BED</div>
                <div className="mt-1 font-mono text-[11px]">
                  {bed.width} × {bed.height} mm
                </div>
              </div>
              <div className="border-b border-r border-[var(--border)] px-2.5 py-2">
                <div className="mono-label text-[var(--muted)]">COLOUR</div>
                <div className="mt-1 font-mono text-[11px]">
                  {printer.maxColors === 1 ? t('configure.oneColor') : `1–${printer.maxColors}`}
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-1.5 font-mono text-[10px] text-[var(--muted)]">
              <Layers3 className="size-3" />
              {nozzles} mm
              <span className="ml-auto inline-flex items-center gap-1">
                <Palette className="size-3" />
                {printer.compatibility.templateSource.replace('OrcaSlicer ', 'Orca ')}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
