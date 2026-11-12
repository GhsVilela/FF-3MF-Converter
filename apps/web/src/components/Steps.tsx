import { Check } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';

const stepKeys = ['steps.upload', 'steps.configure', 'steps.convert', 'steps.download'] as const;

export function Steps({ current }: { current: number }) {
  const { t } = useI18n();
  return (
    <ol className="grid grid-cols-4 overflow-hidden border border-[var(--border)] bg-[var(--surface)]">
      {stepKeys.map((key, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={key}
            className={cn(
              'relative flex min-w-0 items-center gap-2 border-r border-[var(--border)] px-2.5 py-2.5 last:border-r-0 sm:gap-3 sm:px-4 sm:py-3',
              active && 'bg-[var(--accent-soft)]',
            )}
            aria-current={active ? 'step' : undefined}
          >
            {active && <span className="absolute inset-x-0 top-0 h-[2px] bg-[var(--accent)]" />}
            <span
              className={cn(
                'step-dot grid size-6 shrink-0 place-items-center rounded-sm font-mono text-[10px] font-medium',
                active && 'step-dot-active',
                done && 'step-dot-done',
              )}
            >
              {done ? (
                <Check className="size-3" strokeWidth={3} />
              ) : (
                String(index + 1).padStart(2, '0')
              )}
            </span>
            <span
              className={cn(
                'mono-label truncate text-[9px] text-[var(--muted)] sm:text-[10px]',
                (active || done) && 'text-[var(--text)]',
              )}
            >
              {t(key)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
