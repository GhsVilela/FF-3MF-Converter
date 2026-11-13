import { useEffect, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { getUploadThumbnail } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface PreviewCardProps {
  uploadId: string;
  fileName?: string;
  plateCount: number;
}

export function PreviewCard({ uploadId, fileName, plateCount }: PreviewCardProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setUrl(undefined);
    setFailed(false);
    void getUploadThumbnail(uploadId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uploadId]);

  return (
    <section className="surface overflow-hidden">
      <div className="h-[2px] bg-[var(--accent)]" />
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mono-label text-[var(--accent)]">PLATE PREVIEW</div>
            <h2 className="mt-1.5 text-base font-semibold">{t('preview.title')}</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 font-mono text-[10px] text-[var(--muted)]">
              {t('preview.plate', { count: Math.max(1, plateCount) })}
            </span>
          </div>
        </div>

        <div className="preview-grid relative mt-4 flex min-h-[240px] items-center justify-center overflow-hidden border border-[var(--border)] bg-[var(--surface-2)] sm:min-h-[320px]">
          {url ? (
            <img
              src={url}
              alt={t('preview.alt', { file: fileName ?? '3MF' })}
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
        </div>

        <p className="mt-2 font-mono text-[10px] text-[var(--muted)]">
          {fileName} · {t('preview.note')}
        </p>
      </div>
    </section>
  );
}
