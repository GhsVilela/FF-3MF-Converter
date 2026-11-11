import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useI18n } from '../lib/i18n';

export function AuthGate({
  error,
  onSubmit,
}: {
  error?: string;
  onSubmit: (token: string) => void;
}) {
  const { t } = useI18n();
  const [token, setToken] = useState('');

  return (
    <div className="mx-auto w-full max-w-md rise">
      <div className="surface rounded-3xl p-6 sm:p-8">
        <div className="grid size-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <ShieldCheck className="size-6" />
        </div>
        <h2 className="mt-5 text-xl font-semibold">{t('auth.title')}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t('auth.help')}</p>
        <form
          className="mt-5 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(token.trim());
          }}
        >
          <label className="block">
            <span className="sr-only">{t('auth.title')}</span>
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3">
              <KeyRound className="size-4 text-[var(--muted)]" />
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={t('auth.placeholder')}
                className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
                autoFocus
              />
            </div>
          </label>
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          <button
            type="submit"
            className="focus-ring w-full rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            {t('auth.save')}
          </button>
        </form>
      </div>
    </div>
  );
}
