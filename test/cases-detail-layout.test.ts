// @vitest-environment node
/**
 * Case detail section order and the identity row's contents.
 *
 * TWO THINGS THIS PINS, both from the same slip. When the case photo was added beside Identity
 * (v3.73.1) the wrapper it introduced was closed after the WRONG `</fieldset>` — it swallowed
 * Attachments too, making Identity and Attachments flex SIBLINGS laid out side by side. At a
 * maximised window that merely looked odd; at the default window size the two overlapped into each
 * other and the panel was unusable (GhostExodus: "when the app is in its default size the interface
 * is all crumpled").
 *
 * Attachments also belongs BELOW Bio images — his request, and the right call regardless: it is the
 * tallest section on the panel and does not deserve the space above the fold.
 *
 * A structural assertion rather than a rendered one, because the failure was structural: the JSX
 * nested correctly enough to compile and to render fine at full width.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/renderer/modules/cases/CaseDetail.tsx'),
  'utf8'
);

const at = (needle: string): number => {
  const i = source.indexOf(needle);
  expect(i, `not found: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe('case detail layout', () => {
  it('puts Attachments below Bio images', () => {
    expect(at('<BioImagesSection')).toBeLessThan(at('<legend>Attachments</legend>'));
  });

  it('keeps Identity above Bio images', () => {
    expect(at('<legend>Identity</legend>')).toBeLessThan(at('<BioImagesSection'));
  });

  it('closes the photo row BEFORE Attachments, so they are not side-by-side flex siblings', () => {
    const rowStart = at('className="ga98-case-identity-row"');
    const rowEnd = source.indexOf('</div>', at('<legend>Identity</legend>'));
    // Everything between the row opening and Bio images must contain Identity and NOT Attachments.
    const rowRegion = source.slice(rowStart, at('<BioImagesSection'));
    expect(rowRegion).toContain('<legend>Identity</legend>');
    expect(rowRegion, 'Attachments must not live inside the identity row').not.toContain(
      '<legend>Attachments</legend>'
    );
    expect(rowEnd).toBeGreaterThan(rowStart);
  });

  it('still renders the identity photo inside that row', () => {
    const rowRegion = source.slice(
      at('className="ga98-case-identity-row"'),
      at('<BioImagesSection')
    );
    expect(rowRegion).toContain('<IdentityPhoto');
  });
});
