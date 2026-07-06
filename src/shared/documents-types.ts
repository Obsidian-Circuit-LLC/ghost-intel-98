/** One entry in a My Documents folder listing. */
export interface DocEntry {
  name: string;
  kind: 'file' | 'folder';
  size: number;
  modifiedAt: string;
}

/** Result of importing dropped host files into a documents folder. */
export interface DocImportResult {
  imported: DocEntry[];
  failures: { originalName: string; error: string }[];
}
