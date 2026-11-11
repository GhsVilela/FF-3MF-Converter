import { Boxes, Github, Languages, Moon, Sun } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';

interface HeaderProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export function Header({ theme, onToggleTheme }: HeaderProps) {
  const { t, language, setLanguage } = useI18n();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-[var(--accent)] text-white shadow-lg shadow-orange-500/20">
            <Boxes className="size-5" strokeWidth={2.2} />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">{t('brand.name')}</div>
            <div className="hidden text-[11px] text-[var(--muted)] sm:block">
              {t('brand.subtitle')}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <a
            className="focus-ring hidden rounded-lg p-2 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] sm:block"
            href="https://github.com/GhsVilela/Open3MFConverter"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
          >
            <Github className="size-4.5" />
          </a>
          <button
            type="button"
            onClick={() => setLanguage(language === 'en' ? 'pt-BR' : 'en')}
            className={cn(
              'focus-ring flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-[var(--muted)] transition',
              'hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
            )}
            aria-label={t('language.toggle')}
          >
            <Languages className="size-4" />
            <span className="hidden sm:inline">{language === 'en' ? 'PT' : 'EN'}</span>
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            className="focus-ring rounded-lg p-2 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            aria-label={t('theme.toggle')}
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
