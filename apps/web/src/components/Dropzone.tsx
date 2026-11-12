import { useRef, useState } from 'react';
import { FileUp, Loader2, LockKeyhole } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';

interface DropzoneProps {
  maxMb: number;
  uploading: boolean;
  progress: number;
  fileName?: string;
  onFile: (file: File) => void;
}

export function Dropzone({ maxMb, uploading, progress, fileName, onFile }: DropzoneProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const choose = (file?: File) => {
    if (!file) return;
    onFile(file);
  };

  return (
    <div
      className={cn(
        'dropzone relative overflow-hidden p-5 sm:p-7',
        uploading && 'pointer-events-none opacity-90',
      )}
      data-active={dragging}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        choose(event.dataTransfer.files[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".3mf"
        className="sr-only"
        onChange={(event) => choose(event.target.files?.[0])}
      />

      <div className="mb-4 flex items-center justify-between border-b border-[var(--border)] pb-3">
        <span className="mono-label text-[var(--accent)]">INTAKE / .3MF</span>
        <span className="mono-label text-[var(--muted)]">LOCAL ONLY</span>
      </div>

      <div
        className={cn(
          'relative flex min-h-[290px] flex-col items-center justify-center border border-dashed border-[var(--border-strong)] px-4 py-8 text-center transition sm:min-h-[320px]',
          dragging && 'border-[var(--orange)] bg-[var(--orange-soft)]',
        )}
      >
        <span className="corner-mark tl" />
        <span className="corner-mark tr" />
        <span className="corner-mark bl" />
        <span className="corner-mark br" />

        <div className="grid size-14 place-items-center border border-[var(--accent)]/35 bg-[var(--accent-soft)] text-[var(--accent)]">
          {uploading ? <Loader2 className="size-6 animate-spin" /> : <FileUp className="size-6" />}
        </div>

        <h2 className="mt-5 max-w-[260px] text-xl font-semibold tracking-[-0.02em]">
          {uploading ? t('progress.upload') : t('upload.drop')}
        </h2>
        <p className="mx-auto mt-2 max-w-[300px] text-xs leading-5 text-[var(--muted)]">
          {uploading && fileName ? fileName : t('upload.hint')}
        </p>

        {uploading ? (
          <div className="mt-6 w-full max-w-[260px]">
            <div className="progress-track h-2 overflow-hidden">
              <div className="progress-bar h-full" style={{ width: `${progress}%` }} />
            </div>
            <div className="mono-label mt-2 text-[var(--muted)]">{Math.round(progress)}%</div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="focus-ring mt-6 inline-flex items-center gap-2 rounded-sm bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold tracking-wide text-white transition hover:bg-[var(--accent-strong)]"
            >
              <FileUp className="size-4" />
              {t('upload.browse')}
            </button>
            <div className="mono-label mt-3 text-[var(--muted)]">
              {t('upload.format', { size: maxMb })}
            </div>
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-[var(--muted)]">
          <LockKeyhole className="size-3 text-[var(--success)]" />
          {t('hero.privacy')}
        </span>
        <span className="font-mono text-[10px] text-[var(--muted)]">MAX {maxMb} MB</span>
      </div>
    </div>
  );
}
