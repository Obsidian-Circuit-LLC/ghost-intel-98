import { describe, it, expect } from 'vitest';
import { fileIconKind } from '../src/renderer/modules/my-documents/file-icons';

describe('fileIconKind', () => {
  const cases: [string, string][] = [
    ['notes.txt', 'text'], ['README.md', 'text'], ['a.LOG', 'text'],
    ['Tribunal.pdf', 'document'], ['brief.docx', 'document'], ['x.DOC', 'document'],
    ['ledger.csv', 'spreadsheet'], ['book.xlsx', 'spreadsheet'],
    ['manifest.json', 'data'], ['feed.xml', 'data'], ['c.yaml', 'data'],
    ['photo.JPG', 'image'], ['scan.png', 'image'], ['logo.svg', 'image'],
    ['song.mp3', 'audio'], ['clip.wav', 'audio'],
    ['movie.mp4', 'video'], ['reel.mpeg', 'video'], ['v.MKV', 'video'],
    ['bundle.zip', 'archive'], ['x.tar', 'archive'], ['y.gz', 'archive'],
    ['app.ts', 'code'], ['index.html', 'code'], ['s.py', 'code'],
    ['unknown.xyz', 'generic'], ['noext', 'generic'], ['', 'generic'], ['.gitignore', 'generic'],
  ];
  it.each(cases)('%s → %s', (name, kind) => {
    expect(fileIconKind(name)).toBe(kind);
  });
});
