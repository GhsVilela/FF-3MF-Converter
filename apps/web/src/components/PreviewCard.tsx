import { useEffect, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Loader2 } from 'lucide-react';
import { getUploadThumbnail } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';

interface PreviewCardProps {
  uploadId: string;
  fileName?: string;
  plateCount: number;
  plates: number[];
}

export function PreviewCard({ uploadId, fileName, plateCount, plates }: PreviewCardProps) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setIndex(0);
  }, [uploadId, plates]);

  const currentPlate = plates[index] ?? plates[0] ?? 1;

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setUrl(undefined);
    setFailed(false);
    void getUploadThumbnail(uploadId, currentPlate)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uploadId, currentPlate]);

  const previous = () => {
    if (plates.length < 2) return;
    setIndex((current) => (current - 1 + plates.length) % plates.length);
  };
  const next = () => {
    if (plates.length < 2) return;
    setIndex((current) => (current + 1) % plates.length);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    }
  };

  return (
    <section
      className="surface overflow-hidden"
      aria-roledescription="carousel"
      aria-label={t('preview.title')}
      tabIndex={plates.length > 1 ? 0 : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="h-[2px] bg-[var(--accent)]" />
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mono-label text-[var(--accent)]">PLATE PREVIEW</div>
            <h2 className="mt-1.5 text-base font-semibold">{t('preview.title')}</h2>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 font-mono text-[10px] text-[var(--muted)]"
              aria-live="polite"
            >
              {t('preview.plate', {
                plate: currentPlate,
                count: Math.max(1, plateCount),
              })}
            </span>
          </div>
        </div>

        <div className="preview-grid relative mt-4 flex min-h-[240px] items-center justify-center overflow-hidden border border-[var(--border)] bg-[var(--surface-2)] sm:min-h-[320px]">
          {url ? (
            <img
              src={url}
              alt={t('preview.alt', { plate: currentPlate, file: fileName ?? '3MF' })}
              className="max-h-[420px] w-full object-contain p-3"
            />
          ) : failed ? (
            <div className="flex flex-col items-center gap-2 px-6 text-center text-[var(--muted)]">
              <ImageOff className="size-6" />
              <span className="text-xs">{t('preview.unavailable')}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[var(--muted)]">
              <Loader2 className="size-4 animate-spin" />
              <span className="font-mono text-[10px]">{t('preview.loading')}</span>
            </div>
          )}

          {plates.length > 1 && (
            <>
              <button
                type="button"
                onClick={previous}
                aria-label={t('preview.previous')}
                className="focus-ring absolute left-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                onClick={next}
                aria-label={t('preview.next')}
                className="focus-ring absolute right-3 top-1/2 grid size-9 -translate-y-1/2 place-items-center border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <ChevronRight className="size-5" />
              </button>
            </>
          )}
        </div>

        {plates.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            {plates.map((plate, plateIndex) => (
              <button
                key={plate}
                type="button"
                onClick={() => setIndex(plateIndex)}
                aria-label={t('preview.goToPlate', { plate })}
                aria-current={plateIndex === index ? 'true' : undefined}
                className={cn(
                  'h-1.5 w-6 transition-colors',
                  plateIndex === index
                    ? 'bg-[var(--accent)]'
                    : 'bg-[var(--border-strong)] hover:bg-[var(--muted)]',
                )}
              />
            ))}
          </div>
        )}

        {plates.length < Math.max(1, plateCount) && (
          <p className="mt-2 text-center text-[10px] text-[var(--muted)]">
            {t('preview.partial', {
              available: plates.length,
              count: Math.max(1, plateCount),
            })}
          </p>
        )}

        <p className="mt-2 font-mono text-[10px] text-[var(--muted)]">
          {fileName} · {t('preview.note')}
        </p>
      </div>
    </section>
  );
}
