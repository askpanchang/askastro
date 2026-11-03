// Applies the saved theme before first paint (kept out of index.html so the
// Content-Security-Policy can forbid inline scripts).
try {
  var t = localStorage.getItem('theme');
  var dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
