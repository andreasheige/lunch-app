// Light/dark: the header's sun/moon button switches and remembers the theme (localStorage "lunch-theme"); until
// then the page follows the system. Layout.astro's inline script applies a saved theme before the first paint.
import { t } from './i18n.js';

const KEY = 'lunch-theme';
const dark = matchMedia('(prefers-color-scheme: dark)');
const current = () => document.documentElement.dataset.theme ?? (dark.matches ? 'dark' : 'light');

function sync(button) {
  const theme = current();
  button.dataset.current = theme;
  button.setAttribute('aria-label', t(theme === 'dark' ? 'theme.to-light' : 'theme.to-dark'));
  button.title = button.getAttribute('aria-label');
  for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
    meta.content = theme === 'dark' ? '#1c1916' : '#faf7f2';
}

const button = document.getElementById('theme-toggle');
if (button) {
  button.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    sync(button);
  });
  dark.addEventListener('change', () => sync(button));
  sync(button);
}
