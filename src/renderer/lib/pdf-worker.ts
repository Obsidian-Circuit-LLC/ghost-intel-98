/**
 * Dedicated pdf.js worker entry.
 *
 * pdf.js runs its parsing in a Web Worker, which is a SEPARATE JavaScript realm with its
 * own global object and its own `Uint8Array.prototype`. The hex/base64 polyfill imported
 * in main.tsx only patches the *renderer* realm, so it is invisible to the worker — which
 * is why the shipping build still threw `a.toHex is not a function` when rendering a PDF
 * even though the polyfill "existed". Importing the polyfill HERE installs it in the
 * worker realm before pdf.js' worker code runs. Order matters: polyfill first, then the
 * real worker, whose top-level code wires up the message handler.
 */
import './uint8-hex-polyfill';
import 'pdfjs-dist/build/pdf.worker.min.mjs';
