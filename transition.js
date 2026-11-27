/* =========================================================
   Max Yuan · page transition
   Opening a project fades the page out, and the project page
   fades in. Reduced motion skips it. Shared by every page.
   window.wamImagine(href) starts it (the playground uses this).
   ========================================================= */

(() => {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KEY = 'wam-arrive';
  const OUT = 200;
  const html = document.documentElement;

  const style = document.createElement('style');
  style.textContent = `
  html.wam-leave body{opacity:0;transition:opacity ${OUT}ms ease}
  html.wam-enter body{opacity:0}
  html.wam-entering body{transition:opacity .35s ease}
  `;
  document.head.append(style);

  function isProject(href) {
    let url;
    try { url = new URL(href, location.href); } catch (e) { return false; }
    return url.origin === location.origin
      && /projects\/[\w-]+\.html$/.test(url.pathname)
      && url.pathname !== location.pathname;
  }

  let busy = false;
  function go(href) {
    if (busy) return;
    if (reduce || !isProject(href)) { location.href = href; return; }
    busy = true;
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch (e) { /* private mode */ }
    html.classList.add('wam-on', 'wam-leave');   // wam-on: the home hero stops drawing
    setTimeout(() => { location.href = href; }, OUT);
  }
  window.wamImagine = go;

  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    if (!isProject(a.href)) return;
    e.preventDefault();
    go(a.href);
  });

  // arriving: fade the page in
  let t = 0;
  try { t = Number(sessionStorage.getItem(KEY)) || 0; sessionStorage.removeItem(KEY); } catch (e) { /* private mode */ }
  if (t && Date.now() - t < 8000 && !reduce) {
    html.classList.add('wam-enter');
    html.classList.remove('wam-arriving');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      html.classList.add('wam-entering');
      html.classList.remove('wam-enter');
      setTimeout(() => html.classList.remove('wam-entering'), 500);
    }));
  } else {
    html.classList.remove('wam-arriving');
  }

  // coming back with the back button: undo the fade-out
  window.addEventListener('pageshow', e => {
    if (e.persisted) {
      html.classList.remove('wam-leave', 'wam-on', 'wam-enter', 'wam-entering');
      busy = false;
    }
  });
})();
