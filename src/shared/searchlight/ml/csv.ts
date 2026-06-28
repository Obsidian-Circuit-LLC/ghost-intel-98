/**
 * Deterministic CSV parse/serialize for the ML corpus and dataset.
 *
 * Constraints:
 * - Column order is determined by the caller-supplied `header` in `toCsv`.
 * - Line endings are `\n` only.
 * - Numbers are serialized via `String(n)`.
 * - No quoting — our data is numeric + simple tokens. Any field value that
 *   contains a comma or newline is rejected by throwing.
 */

export interface ParsedCsv {
  header: string[];
  rows: Record<string, string>[];
}

/**
 * Parse a CSV text (produced by `toCsv` or a compatible tool).
 * The first line is the header. Trailing empty line is tolerated.
 */
export function parseCsv(text: string): ParsedCsv {
  const lines = text.split('\n');
  // Drop trailing empty line produced by a trailing newline
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    return { header: [], rows: [] };
  }
  const header = lines[0].split(',');
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = cells[j] ?? '';
    }
    rows.push(row);
  }
  return { header, rows };
}

/**
 * Serialize rows to CSV with `header` as the column order.
 * Numbers are written via `String(n)`. Throws if any field value contains
 * a comma or newline (which would corrupt the unquoted format).
 */
export function toCsv(header: string[], rows: Record<string, string | number>[]): string {
  const lines: string[] = [header.join(',')];
  for (const row of rows) {
    const cells = header.map((col) => {
      const val = String(row[col] ?? '');
      if (val.includes(',') || val.includes('\n')) {
        throw new Error(`toCsv: field value contains a comma or newline: ${JSON.stringify(val)}`);
      }
      return val;
    });
    lines.push(cells.join(','));
  }
  // Always end with a trailing newline for round-trip parity
  return lines.join('\n') + '\n';
}
