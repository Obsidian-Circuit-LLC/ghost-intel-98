/**
 * Human-readable notice for case files the AI assistant could NOT include in a request. Referenced
 * files that get silently dropped (binary/Office files, scanned PDFs with no text layer, read errors)
 * only landed in a buried context line the model may not relay — which read to GhostExodus as "it
 * breaks when I reference a file". This surfaces exactly which files Q won't see, and why. Pure/testable.
 */
export function describeSkippedFiles(skipped: { name: string; reason: string }[]): string | null {
  if (!skipped.length) return null;
  const label = (r: string): string =>
    (({
      binary: 'not text — a binary or Office file (use "➕ Add to memory" for DOCX/PDF)',
      'pdf-no-text-layer': 'a scanned/image PDF with no text layer',
      'pdf-error': 'a PDF that could not be read',
      'read-error': 'could not be read',
      empty: 'empty',
      budget: 'skipped — the context budget was already full',
    } as Record<string, string>)[r] ?? r);
  return (
    `${skipped.length} file(s) couldn't be included, so Q won't see them: ` +
    skipped.map((s) => `${s.name} (${label(s.reason)})`).join('; ')
  );
}
