/**
 * Renderer entry. Mounts the React tree into #root.
 */

import './lib/uint8-hex-polyfill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '98.css';
import './styles/theme.css';
import './styles/98.overrides.css';
import { App } from './App';
import { registerBuiltins } from './modules/register-builtins';

registerBuiltins();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Renderer root element missing.');
}
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
