import { useEffect } from 'react';
import { usePersistentState } from './usePersistentState.js';

export const THEMES = ['system', 'light', 'dark'];

// The same key the inline script in index.html reads, so the first paint is
// already in the right theme rather than flashing light.
export const THEME_KEY = 'multi-llm.theme';

const darkQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)');

function apply(theme) {
  const dark = theme === 'dark' || (theme === 'system' && Boolean(darkQuery()?.matches));
  document.documentElement.classList.toggle('dark', dark);
}

/**
 * Light, dark, or whatever the system says — and, for that last one, following
 * the system when it changes, as it does at sunset on a Mac set to Auto.
 */
export function useTheme() {
  const [theme, setTheme] = usePersistentState(THEME_KEY, 'system', (value) => THEMES.includes(value));

  useEffect(() => {
    apply(theme);
    if (theme !== 'system') return undefined;
    const query = darkQuery();
    const follow = () => apply('system');
    query?.addEventListener('change', follow);
    return () => query?.removeEventListener('change', follow);
  }, [theme]);

  return [theme, setTheme];
}
