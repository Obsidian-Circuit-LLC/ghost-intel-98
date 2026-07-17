import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

// Capture every ipcMain.handle registration so the test can drive the REAL handlers registered by
// registerIpc (mirrors documents-ipc-surface.test.ts / media-ipc-channels.test.ts). The wrapped
// handler has shape (event, ...args).
const { handlers, showSaveDialog } = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  showSaveDialog: vi.fn()
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/ga98-pdfsign-ipc-test', on: () => {}, whenReady: () => Promise.resolve(), quit: () => {} },
  ipcMain: { handle: (c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn) },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn(), openExternal: vi.fn() },
  dialog: { showSaveDialog },
  BrowserWindow: class {}
}));

// signPdf is unit-tested on its own (test/pdf-signer-sign.test.ts) — spy on the real implementation
// here so this suite proves the IPC WIRING (validate → sign → save), not the pdf-lib overlay math.
vi.mock('../src/main/pdf-signer/sign', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/pdf-signer/sign')>();
  return { ...actual, signPdf: vi.fn(actual.signPdf) };
});

import { channels } from '../src/shared/ipc-contracts';
import { registerIpc } from '../src/main/ipc/register';
import { signPdf } from '../src/main/pdf-signer/sign';

// Invoke a registered handler the way ipcRenderer.invoke would (event arg + renderer args).
const invoke = (channel: string, ...args: unknown[]): unknown => {
  const h = handlers.get(channel);
  if (!h) throw new Error(`no handler registered for ${channel}`);
  return h({}, ...args);
};

// a 1x1 png (same fixture used by pdf-signer-sign.test.ts / board-docx tests)
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function fixturePdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  return doc.save();
}

// saveBufferWithDialog is the real implementation (only the OS dialog is mocked) — it actually
// writes the signed bytes to disk via a real fs.writeFile+rename, so the mocked dialog's filePath
// must resolve inside a real, writable directory.
let saveDir: string;

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  registerIpc(() => null);
  saveDir = mkdtempSync(join(tmpdir(), 'ga98-pdfsign-save-'));
});

afterEach(() => {
  if (saveDir) rmSync(saveDir, { recursive: true, force: true });
});

describe('pdfsign IPC channels', () => {
  it('names both channels', () => {
    expect(channels.pdfsign.read).toBe('pdfsign:read');
    expect(channels.pdfsign.sign).toBe('pdfsign:sign');
  });

  describe('pdfsign:read', () => {
    let dir: string;
    afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

    it('returns the raw bytes for a path under the cap', async () => {
      dir = mkdtempSync(join(tmpdir(), 'ga98-pdfsign-'));
      const p = join(dir, 'a.pdf');
      writeFileSync(p, Buffer.from('%PDF-fake'));
      const out = (await invoke(channels.pdfsign.read, p)) as Uint8Array;
      expect(Buffer.from(out).toString()).toBe('%PDF-fake');
    });

    it('rejects a path whose file exceeds MAX_PDF_SIGN_BYTES', async () => {
      dir = mkdtempSync(join(tmpdir(), 'ga98-pdfsign-'));
      const p = join(dir, 'big.pdf');
      writeFileSync(p, Buffer.alloc(26 * 1024 * 1024));
      await expect(invoke(channels.pdfsign.read, p)).rejects.toThrow(/too large/i);
    });

    it('rejects a non-absolute path (ensureImportSourcePath enforced)', async () => {
      await expect(invoke(channels.pdfsign.read, 'relative.pdf')).rejects.toThrow();
    });
  });

  describe('pdfsign:sign', () => {
    it('signs and hands the bytes to saveBufferWithDialog under a <stem>-signed.pdf default name', async () => {
      const pdfBytes = await fixturePdfBytes();
      showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: join(saveDir, 'a-signed.pdf') });
      const result = await invoke(channels.pdfsign.sign, {
        pdfBytes,
        signatureDataUrl: `data:image/png;base64,${PNG_B64}`,
        placement: { page: 0, xFrac: 0.5, yFrac: 0.1, wFrac: 0.2 },
        sourceName: 'a.pdf'
      });
      expect(signPdf).toHaveBeenCalledWith(
        pdfBytes,
        expect.any(Buffer),
        'image/png',
        { page: 0, xFrac: 0.5, yFrac: 0.1, wFrac: 0.2 }
      );
      expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: expect.stringContaining('a-signed.pdf') }));
      expect(result).toEqual({ saved: true });
    });

    it('falls back to a generic stem when no sourceName is given', async () => {
      const pdfBytes = await fixturePdfBytes();
      showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: join(saveDir, 'document-signed.pdf') });
      await invoke(channels.pdfsign.sign, {
        pdfBytes,
        signatureDataUrl: `data:image/png;base64,${PNG_B64}`,
        placement: { page: 0, xFrac: 0.5, yFrac: 0.1, wFrac: 0.2 }
      });
      expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: expect.stringContaining('document-signed.pdf') }));
    });

    it('reports saved:false (never throws) when the user cancels the save dialog', async () => {
      const pdfBytes = await fixturePdfBytes();
      showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
      const result = await invoke(channels.pdfsign.sign, {
        pdfBytes,
        signatureDataUrl: `data:image/png;base64,${PNG_B64}`,
        placement: { page: 0, xFrac: 0.5, yFrac: 0.1, wFrac: 0.2 }
      });
      expect(result).toEqual({ saved: false });
    });

    it('rejects an oversize signature via ensureAssetInput (>2MB) before signPdf is ever called', async () => {
      const pdfBytes = await fixturePdfBytes();
      const bigB64 = Buffer.alloc(2_100_000).toString('base64');
      await expect(
        invoke(channels.pdfsign.sign, {
          pdfBytes,
          signatureDataUrl: `data:image/png;base64,${bigB64}`,
          placement: { page: 0, xFrac: 0.5, yFrac: 0.1, wFrac: 0.2 }
        })
      ).rejects.toThrow(/too large/i);
      expect(signPdf).not.toHaveBeenCalled();
    });

    it('rejects a malformed placement shape before signPdf is ever called', async () => {
      const pdfBytes = await fixturePdfBytes();
      await expect(
        invoke(channels.pdfsign.sign, {
          pdfBytes,
          signatureDataUrl: `data:image/png;base64,${PNG_B64}`,
          placement: { page: 'x', xFrac: 0.5, yFrac: 0.1, wFrac: 0.2 }
        })
      ).rejects.toThrow();
      expect(signPdf).not.toHaveBeenCalled();
    });

    it('clamps out-of-range fractions into [0,1] rather than passing them through raw', async () => {
      const pdfBytes = await fixturePdfBytes();
      showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: join(saveDir, 'x.pdf') });
      await invoke(channels.pdfsign.sign, {
        pdfBytes,
        signatureDataUrl: `data:image/png;base64,${PNG_B64}`,
        placement: { page: 0, xFrac: 1.5, yFrac: -0.2, wFrac: 0.2 }
      });
      expect(signPdf).toHaveBeenCalledWith(
        pdfBytes,
        expect.any(Buffer),
        'image/png',
        { page: 0, xFrac: 1, yFrac: 0, wFrac: 0.2 }
      );
    });

    it('rejects an oversize pdfBytes payload (>MAX_PDF_SIGN_BYTES) before signPdf is ever called', async () => {
      const bigPdfBytes = new Uint8Array(26 * 1024 * 1024);
      await expect(
        invoke(channels.pdfsign.sign, {
          pdfBytes: bigPdfBytes,
          signatureDataUrl: `data:image/png;base64,${PNG_B64}`,
          placement: { page: 0, xFrac: 0.5, yFrac: 0.1, wFrac: 0.2 }
        })
      ).rejects.toThrow(/too large/i);
      expect(signPdf).not.toHaveBeenCalled();
    });
  });
});
