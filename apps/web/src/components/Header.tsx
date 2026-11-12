import { Github, Languages, Moon, Sun } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { BrandMark } from './BrandMark';
import { cn } from '../lib/utils';

interface HeaderProps {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export function Header({ theme, onToggleTheme }: HeaderProps) {
  const { t, language, setLanguage } = useI18n();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="brand-stripe h-[3px] w-full" />
      <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-3.5">
          <BrandMark className="size-9" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-[0.02em]">{t('brand.name')}</div>
            <div className="mono-label mt-1 text-[var(--muted)]">{t('brand.subtitle')}</div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <div className="mr-3 hidden items-center gap-2 border border-[var(--border)] px-2.5 py-1.5 lg:flex">
            <span className="size-1.5 rounded-full bg-[var(--success)]" />
            <span className="mono-label text-[var(--muted)]">LOCAL INSTANCE</span>
          </div>
          <a
            className="focus-ring hidden rounded-sm p-2 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] sm:block"
            href="https://github.com/GhsVilela/FF-3MF-Converter"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
          >
            <Github className="size-4" />
          </a>
          <button
            type="button"
            onClick={() => setLanguage(language === 'en' ? 'pt-BR' : 'en')}
            className={cn(
              'focus-ring flex items-center gap-1.5 rounded-sm px-2.5 py-2 text-xs font-medium text-[var(--muted)] transition',
              'hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
            )}
            aria-label={t('language.toggle')}
          >
            <Languages className="size-4" />
            <span className="hidden font-mono text-[10px] font-medium tracking-wider sm:inline">
              {language === 'en' ? 'PT-BR' : 'EN'}
            </span>
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            className="focus-ring rounded-sm p-2 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            aria-label={t('theme.toggle')}
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
