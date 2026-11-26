(() => {
  const themeKey = 'recipe_journal_theme';
  const root = document.documentElement;
  const toggle = document.querySelector('[data-theme-toggle]');
  let theme = 'light';

  try {
    if (localStorage.getItem(themeKey) === 'dark') theme = 'dark';
  } catch {
    // Theme can still change on this page when storage is unavailable.
  }

  function applyTheme() {
    root.dataset.theme = theme;
    if (toggle) toggle.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  }

  applyTheme();
  toggle?.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    try {
      localStorage.setItem(themeKey, theme);
    } catch {
      // Preserve the in-page choice if storage is unavailable.
    }
  });
})();
