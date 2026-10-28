/* SHA-256 Byte Inspector - MIT (c) 2026 ipusiron
 * theme-init.js decides the theme before the first paint. index.html loads it in
 * <head> right after style.css, without defer, so the page is never drawn in the
 * other theme first. It sets data-theme on <html> from the saved display setting
 * (sha256-byte-inspector.display, {"theme": "dark" | "light"}), or dark (blueprint)
 * when none is saved, whatever the OS setting is. app.js reads data-theme back at
 * start-up to set the toggle, and saves the choice when the toggle is pressed.
 * A storage error or a broken saved value falls back to dark. */
(function (global) {
  'use strict';

  let theme = null;
  try {
    const raw = global.localStorage.getItem('sha256-byte-inspector.display');
    const saved = raw ? JSON.parse(raw) : null;
    theme = saved && typeof saved === 'object' ? saved.theme : null;
  } catch (error) {
    /* Storage is optional. */
  }
  global.document.documentElement.dataset.theme = theme === 'light' || theme === 'dark' ? theme : 'dark';
})(typeof window !== 'undefined' ? window : globalThis);
