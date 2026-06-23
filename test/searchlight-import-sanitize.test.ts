import { describe, it, expect } from 'vitest';
import { sanitizeImportedCase } from '../src/shared/searchlight/import-sanitize';

const minimalCase = { id: 'case-1', name: 'Test Case' };

describe('sanitizeImportedCase', () => {
  it('preserves id, name, and arrays for a valid case', () => {
    const result = sanitizeImportedCase({
      id: 'case-abc',
      name: 'My Case',
      description: 'desc',
      notes: 'some notes',
      tags: ['tag1', 'tag2'],
      createdAt: 1000,
      updatedAt: 2000,
      searches: [],
      graphNodes: [],
      graphEdges: [],
      whiteboardFiles: [],
      whiteboardNotes: [],
    });
    expect(result).not.toBeNull();
    expect(result!.id).toBe('case-abc');
    expect(result!.name).toBe('My Case');
    expect(result!.description).toBe('desc');
    expect(result!.notes).toBe('some notes');
    expect(result!.tags).toEqual(['tag1', 'tag2']);
    expect(result!.createdAt).toBe(1000);
    expect(result!.updatedAt).toBe(2000);
  });

  it('returns null when id is missing', () => {
    expect(sanitizeImportedCase({ name: 'No ID' })).toBeNull();
  });

  it('returns null when id is not a string', () => {
    expect(sanitizeImportedCase({ id: 42, name: 'Bad ID' })).toBeNull();
  });

  it('returns null when id is an empty string', () => {
    expect(sanitizeImportedCase({ id: '', name: 'Empty ID' })).toBeNull();
  });

  it('returns null when name is missing', () => {
    expect(sanitizeImportedCase({ id: 'x' })).toBeNull();
  });

  it('returns null when name is not a string', () => {
    expect(sanitizeImportedCase({ id: 'x', name: 123 })).toBeNull();
  });

  it('returns null for null input', () => {
    expect(sanitizeImportedCase(null)).toBeNull();
  });

  it('returns null for array input', () => {
    expect(sanitizeImportedCase([{ id: 'x', name: 'y' }])).toBeNull();
  });

  it('coerces searches: not an array → []', () => {
    const result = sanitizeImportedCase({ ...minimalCase, searches: 'bad' });
    expect(result).not.toBeNull();
    expect(result!.searches).toEqual([]);
  });

  it('coerces searches: null → []', () => {
    const result = sanitizeImportedCase({ ...minimalCase, searches: null });
    expect(result).not.toBeNull();
    expect(result!.searches).toEqual([]);
  });

  it('preserves valid search job fields', () => {
    const result = sanitizeImportedCase({
      ...minimalCase,
      searches: [{
        id: 'job-1',
        username: 'alice',
        startedAt: 100,
        completedAt: 200,
        status: 'completed',
        totalSites: 10,
        checkedSites: 10,
        useTor: false,
        results: [],
      }],
    });
    expect(result!.searches).toHaveLength(1);
    expect(result!.searches[0].id).toBe('job-1');
    expect(result!.searches[0].username).toBe('alice');
    expect(result!.searches[0].status).toBe('completed');
  });

  it('coerces invalid job status to completed', () => {
    const result = sanitizeImportedCase({
      ...minimalCase,
      searches: [{ id: 'j', username: 'u', startedAt: 0, status: 'hacked', totalSites: 0, checkedSites: 0, useTor: false, results: [] }],
    });
    expect(result!.searches[0].status).toBe('completed');
  });

  it('drops whiteboardFiles with javascript: dataUrl', () => {
    const result = sanitizeImportedCase({
      id: 'x',
      name: 'y',
      whiteboardFiles: [
        { id: 'f1', dataUrl: 'javascript:alert(1)', x: 0, y: 0, width: 100, height: 100, name: 'f', type: 'image', mimeType: 'image/png' },
        { id: 'f2', dataUrl: 'data:image/png;base64,xxx', x: 0, y: 0, width: 100, height: 100, name: 'f', type: 'image', mimeType: 'image/png' },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.whiteboardFiles).toHaveLength(1);
    expect(result!.whiteboardFiles![0].dataUrl).toBe('data:image/png;base64,xxx');
  });

  it('drops whiteboardFiles with http: dataUrl', () => {
    const result = sanitizeImportedCase({
      ...minimalCase,
      whiteboardFiles: [
        { id: 'f1', dataUrl: 'http://evil.com/img.png', x: 0, y: 0, width: 100, height: 100, name: 'f', type: 'image', mimeType: 'image/png' },
      ],
    });
    expect(result!.whiteboardFiles).toHaveLength(0);
  });

  it('keeps whiteboardFiles with data: dataUrl', () => {
    const result = sanitizeImportedCase({
      ...minimalCase,
      whiteboardFiles: [
        { id: 'f1', dataUrl: 'data:image/jpeg;base64,/9j/', x: 10, y: 20, width: 50, height: 60, name: 'photo', type: 'image', mimeType: 'image/jpeg' },
      ],
    });
    expect(result!.whiteboardFiles).toHaveLength(1);
    expect(result!.whiteboardFiles![0].x).toBe(10);
  });

  it('coerces statusCode string to number in results', () => {
    const result = sanitizeImportedCase({
      ...minimalCase,
      searches: [{
        id: 'j', username: 'u', startedAt: 0, status: 'completed',
        totalSites: 1, checkedSites: 1, useTor: false,
        results: [{
          id: 'r1', jobId: 'j', siteName: 'GitHub', username: 'u',
          url: 'https://github.com/u', statusCode: '200', statusMessage: 'OK',
          elapsed: '123', redirectUrl: null, error: null, category: 'dev',
          tags: [], checkType: 'status_code', found: true, confidence: 'high',
          status: 'found', timestamp: 0,
        }],
      }],
    });
    expect(result!.searches[0].results[0].statusCode).toBe(200);
    expect(result!.searches[0].results[0].elapsed).toBe(123);
  });

  it('maps bogus status to unknown', () => {
    const result = sanitizeImportedCase({
      ...minimalCase,
      searches: [{
        id: 'j', username: 'u', startedAt: 0, status: 'completed',
        totalSites: 1, checkedSites: 1, useTor: false,
        results: [{
          id: 'r1', jobId: 'j', siteName: 'S', username: 'u',
          url: 'https://example.com', statusCode: 200, statusMessage: '',
          elapsed: 0, redirectUrl: null, error: null, category: 'c',
          tags: [], checkType: 'status_code', found: false, confidence: 'low',
          status: 'bogus_status', timestamp: 0,
        }],
      }],
    });
    expect(result!.searches[0].results[0].status).toBe('unknown');
  });

  it('maps unknown error type to null', () => {
    const result = sanitizeImportedCase({
      ...minimalCase,
      searches: [{
        id: 'j', username: 'u', startedAt: 0, status: 'completed',
        totalSites: 1, checkedSites: 1, useTor: false,
        results: [{
          id: 'r1', jobId: 'j', siteName: 'S', username: 'u',
          url: 'https://example.com', statusCode: 404, statusMessage: '',
          elapsed: 0, redirectUrl: null, error: 'NOPE', category: 'c',
          tags: [], checkType: 'status_code', found: false, confidence: 'low',
          status: 'not_found', timestamp: 0,
        }],
      }],
    });
    expect(result!.searches[0].results[0].error).toBeNull();
  });

  it('keeps valid ProbeErrorType', () => {
    const result = sanitizeImportedCase({
      ...minimalCase,
      searches: [{
        id: 'j', username: 'u', startedAt: 0, status: 'completed',
        totalSites: 1, checkedSites: 1, useTor: false,
        results: [{
          id: 'r1', jobId: 'j', siteName: 'S', username: 'u',
          url: 'https://example.com', statusCode: 0, statusMessage: '',
          elapsed: 0, redirectUrl: null, error: 'DNS_ERROR', category: 'c',
          tags: [], checkType: 'status_code', found: false, confidence: 'low',
          status: 'error', timestamp: 0,
        }],
      }],
    });
    expect(result!.searches[0].results[0].error).toBe('DNS_ERROR');
  });

  it('maps invalid graphNode type to custom', () => {
    const result = sanitizeImportedCase({
      ...minimalCase,
      graphNodes: [{ id: 'n1', type: 'evil', label: 'Node', x: 0, y: 0 }],
    });
    expect(result!.graphNodes).toHaveLength(1);
    expect(result!.graphNodes[0].type).toBe('custom');
  });

  it('keeps valid graphNode types', () => {
    for (const type of ['username', 'result', 'note', 'file', 'custom'] as const) {
      const result = sanitizeImportedCase({
        ...minimalCase,
        graphNodes: [{ id: 'n1', type, label: 'L', x: 1, y: 2 }],
      });
      expect(result!.graphNodes[0].type).toBe(type);
    }
  });

  it('drops graphNode data that is not a plain object', () => {
    const result = sanitizeImportedCase({
      ...minimalCase,
      graphNodes: [{ id: 'n1', type: 'custom', label: 'L', x: 0, y: 0, data: [1, 2, 3] }],
    });
    expect(result!.graphNodes[0].data).toBeUndefined();
  });

  it('passes graphNode data through if it is a plain object', () => {
    const result = sanitizeImportedCase({
      ...minimalCase,
      graphNodes: [{ id: 'n1', type: 'custom', label: 'L', x: 0, y: 0, data: { key: 'val' } }],
    });
    expect(result!.graphNodes[0].data).toEqual({ key: 'val' });
  });

  it('sanitizes graphEdges', () => {
    const result = sanitizeImportedCase({
      ...minimalCase,
      graphEdges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    });
    expect(result!.graphEdges).toHaveLength(1);
    expect(result!.graphEdges[0].source).toBe('n1');
  });

  it('defaults missing description/notes to empty string', () => {
    const result = sanitizeImportedCase({ id: 'x', name: 'y' });
    expect(result!.description).toBe('');
    expect(result!.notes).toBe('');
  });

  it('defaults missing tags to []', () => {
    const result = sanitizeImportedCase({ id: 'x', name: 'y' });
    expect(result!.tags).toEqual([]);
  });

  it('filters non-string entries from tags', () => {
    const result = sanitizeImportedCase({ id: 'x', name: 'y', tags: ['a', 42, null, 'b'] });
    expect(result!.tags).toEqual(['a', 'b']);
  });

  it('defaults missing createdAt/updatedAt to 0', () => {
    const result = sanitizeImportedCase({ id: 'x', name: 'y' });
    expect(result!.createdAt).toBe(0);
    expect(result!.updatedAt).toBe(0);
  });
});
