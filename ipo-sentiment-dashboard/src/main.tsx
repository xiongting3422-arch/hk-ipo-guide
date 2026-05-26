import { StrictMode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from './App';
import './styles.css';

const MOUNT_ID = 'nnq-heat-root';
let reactRoot: Root | null = null;
let reloadKey = 0;
let mounted = false;

function mount(force = false) {
  const el = document.getElementById(MOUNT_ID);
  if (!el) return;

  if (force) reloadKey += 1;

  if (!reactRoot) {
    reactRoot = createRoot(el);
    mounted = true;
  }

  reactRoot.render(
    <StrictMode>
      <App forceKey={reloadKey} />
    </StrictMode>,
  );
}

function ensureLoaded(force?: boolean) {
  mount(!!force);
}

function boot() {
  mount();
  document.addEventListener('ipo-tab-change', (e) => {
    const tab = (e as CustomEvent<{ name?: string }>).detail?.name;
    if (tab === 'listed') mount();
  });
}

if (typeof window !== 'undefined') {
  window.ensureIpoSentimentLoaded = ensureLoaded;
  window.ensureNnqHeatLoaded = ensureLoaded;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

export { ensureLoaded, mount };
