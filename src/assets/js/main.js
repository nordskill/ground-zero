import '../css/main.css';

const yearEl = document.getElementById('year');
if (yearEl) {
  yearEl.textContent = String(new Date().getFullYear());
}

const btnPop = document.getElementById('btn-pop');
const popEl = document.getElementById('pop');
if (btnPop) {
  btnPop.addEventListener('click', () => {
    // toggle visibility
    if (popEl) {
      popEl.style.display = popEl.style.display === 'block' ? 'none' : 'block';
    }
  });
}

// Keep minimal HMR feedback
/**
 * @typedef {Object} ViteHot
 * @property {(callback?: () => void) => void} accept
 */

/**
 * @typedef {Object} ImportMetaWithHot
 * @property {ViteHot | undefined} [hot]
 */

const meta = /** @type {ImportMeta & ImportMetaWithHot} */ (import.meta);
if (meta.hot) {
  meta.hot.accept(() => {
    console.log('[HMR] main.js updated');
  });
}
