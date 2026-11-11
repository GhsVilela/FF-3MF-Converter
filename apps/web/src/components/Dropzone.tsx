import { useRef, useState } from 'react';
import { FileBox, Loader2, UploadCloud } from 'lucide-react';
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
        'dropzone surface relative overflow-hidden rounded-3xl border-2 border-dashed border-[var(--border)] p-8 text-center sm:p-12',
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

      <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
        {uploading ? (
          <Loader2 className="size-7 animate-spin" />
        ) : (
          <UploadCloud className="size-7" />
        )}
      </div>

      <h2 className="mt-5 text-xl font-semibold tracking-tight sm:text-2xl">
        {uploading ? t('progress.upload') : t('upload.drop')}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
        {uploading && fileName ? fileName : t('upload.hint')}
      </p>

      {uploading ? (
        <div className="mx-auto mt-6 max-w-sm">
          <div className="progress-track h-2 overflow-hidden rounded-full">
            <div className="progress-bar h-full rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-2 text-xs text-[var(--muted)]">{Math.round(progress)}%</div>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="focus-ring mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:brightness-110"
          >
            <FileBox className="size-4" />
            {t('upload.browse')}
          </button>
          <div className="mt-4 text-xs text-[var(--muted)]">
            {t('upload.format', { size: maxMb })}
          </div>
        </>
      )}

      {fileName && !uploading && (
        <div className="mt-5 inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--muted)]">
          <FileBox className="size-3.5 shrink-0" />
          <span className="truncate">{fileName}</span>
        </div>
      )}
    </div>
  );
}
