import { Check } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';

const stepKeys = ['steps.upload', 'steps.configure', 'steps.convert', 'steps.download'] as const;

export function Steps({ current }: { current: number }) {
  const { t } = useI18n();
  return (
    <ol className="flex items-center gap-2 sm:gap-3" aria-label="Conversion progress">
      {stepKeys.map((key, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={key} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <div
              className={cn(
                'step-dot grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                active && 'step-dot-active',
                done && 'step-dot-done',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
            </div>
            <span
              className={cn(
                'hidden truncate text-xs font-medium text-[var(--muted)] sm:block',
                active && 'text-[var(--text)]',
              )}
            >
              {t(key)}
            </span>
            {index < stepKeys.length - 1 && (
              <div
                className={cn(
                  'h-px min-w-2 flex-1',
                  done
                    ? 'bg-[color-mix(in_srgb,var(--success)_45%,transparent)]'
                    : 'bg-[var(--border)]',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
