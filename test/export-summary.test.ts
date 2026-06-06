import { describe, it, expect } from 'vitest';
import { buildSummaryHtml, type ReportImages } from '../src/main/services/report-html';
import type { CaseRecord } from '../src/shared/types';

function baseCase(over: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: 'case-1',
    title: 'Kerry Tomlin',
    reference: 'Star-0001',
    status: 'New',
    priority: 'Medium',
    tags: [],
    description: 'desc',
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
    archived: false,
    entities: [],
    tasks: [],
    links: [],
    reminders: [],
    attachments: [],
    timeline: [],
    bioImages: [],
    ...over
  } as unknown as CaseRecord;
}

const PNG_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('buildSummaryHtml image embedding', () => {
  it('renders no gallery when images are absent', () => {
    const html = buildSummaryHtml(baseCase());
    expect(html).not.toContain('Bio images');
    expect(html).not.toContain('Attachment images');
    expect(html).toContain('<h2>Attachments</h2>');
  });

  it('embeds bio and attachment images as inline data URIs', () => {
    const images: ReportImages = {
      bio: [{ caption: 'Profile', dataUri: PNG_URI }],
      attachments: [{ caption: 'evidence.jpg', dataUri: PNG_URI }]
    };
    const html = buildSummaryHtml(baseCase(), images);
    expect(html).toContain('<h2>Bio images</h2>');
    expect(html).toContain('<h2>Attachment images</h2>');
    expect(html).toContain(`src="${PNG_URI}"`);
    expect(html).toContain('<figcaption>Profile</figcaption>');
    expect(html).toContain('<figcaption>evidence.jpg</figcaption>');
  });

  it('drops malformed / non-image data URIs instead of rendering them', () => {
    const images: ReportImages = {
      bio: [{ caption: 'x', dataUri: 'javascript:alert(1)' }],
      attachments: [{ caption: 'y', dataUri: 'data:text/html;base64,PHNjcmlwdD4=' }]
    };
    const html = buildSummaryHtml(baseCase(), images);
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('text/html');
    // both galleries empty → no headers
    expect(html).not.toContain('Bio images');
    expect(html).not.toContain('Attachment images');
  });

  it('HTML-escapes captions', () => {
    const images: ReportImages = {
      bio: [{ caption: '<b>x</b>&"', dataUri: PNG_URI }],
      attachments: []
    };
    const html = buildSummaryHtml(baseCase(), images);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;&amp;&quot;');
    expect(html).not.toContain('<figcaption><b>x</b>');
  });

  it('renders the omitted note when provided', () => {
    const html = buildSummaryHtml(baseCase(), { bio: [], attachments: [], omittedNote: '2 images not embedded (too large for the report).' });
    expect(html).toContain('2 images not embedded');
  });
});
