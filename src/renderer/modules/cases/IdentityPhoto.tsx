/**
 * The case's photo, shown beside Identity.
 *
 * GhostExodus asked for the first bio image to appear at the top of the case alongside the Identity
 * fields, not only in the Bio images strip at the bottom — his cases are people, and the face is
 * the fastest way to know which case is open.
 *
 * Two decisions worth stating:
 *
 *  - WHICH image: the same rule the case-list row already uses (`bio-images.ts` `primaryThumb`) —
 *    the explicitly marked primary, else the first one added. Inventing a second rule here would
 *    let the list row and the case header disagree about which photo represents the case.
 *
 *  - NOT STRETCHED: `object-fit: contain`. `cover` would fill the frame more attractively but
 *    silently crops, and this is evidence — a face partly outside the box is a worse default than
 *    a letterboxed one. It also directly answers the request ("without the image stretching").
 *
 * The full-size original is read rather than the 96px list thumbnail, which is visibly soft at
 * portrait size. Every failure path degrades to NO photo: a locked vault, a deleted file or an
 * older preload without the bridge must never take the Identity panel down with it.
 */
import { useEffect, useState, type JSX } from 'react';
import type { BioImage } from '@shared/types';

/** The case's representative image, by the same rule the case list uses. */
export function pickIdentityPhoto(images: readonly BioImage[] | undefined): BioImage | null {
  if (!images || images.length === 0) return null;
  return images.find((i) => i.isPrimary) ?? images[0] ?? null;
}

export function IdentityPhoto({
  caseId,
  images,
}: {
  caseId: string;
  images: readonly BioImage[] | undefined;
}): JSX.Element | null {
  const chosen = pickIdentityPhoto(images);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSrc(null);
    if (!chosen) return;
    const read = window.api?.bioImages?.readOriginal;
    if (typeof read !== 'function') return;
    void (async () => {
      try {
        const uri = await read(caseId, chosen.id);
        if (active) setSrc(uri ?? null);
      } catch {
        // Vault locked, file gone, decrypt failed — show no photo, keep the panel.
        if (active) setSrc(null);
      }
    })();
    return () => { active = false; };
  }, [caseId, chosen?.id]);

  if (!chosen || !src) return null;

  return (
    <img
      className="ga98-case-identity-photo"
      src={src}
      alt={chosen.caption || chosen.originalName || 'Case photo'}
      title={chosen.caption || chosen.originalName}
      style={{ objectFit: 'contain' }}
    />
  );
}
