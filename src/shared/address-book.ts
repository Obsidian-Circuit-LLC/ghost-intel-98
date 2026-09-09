/**
 * Address Book — the contact record and its input shape.
 *
 * Field set is GhostExodus's spec verbatim: name, alias, email, phone, URL, social media,
 * occupation, skills, notes, thoughts, a bio picture and a photo album. The four repeatable fields
 * (email / phone / URL / social) are arrays because his UI adds entries with a plus sign; a contact
 * with one email and a contact with six are the same shape.
 *
 * `commonContacts` is the one field with a rule attached, and the rule lives in the STORE rather
 * than the UI: "I want that common contact attribution to be retro-active, and attribute the common
 * contact to the other one, too." A link is therefore SYMMETRIC by construction — see
 * `storage/address-book.ts`. Nothing in the renderer can create a one-sided link, because the
 * renderer does not get to decide.
 */

/** A repeatable free-text field (email / phone / URL / social). Stored as given — never parsed,
 *  normalised or validated into a shape the analyst did not type. */
export type ContactValues = string[];

export interface Contact {
  id: string;
  /** Sort key. Alphabetisation is ALWAYS by name, never by alias — his spec is explicit. */
  name: string;
  alias: string;
  emails: ContactValues;
  phones: ContactValues;
  urls: ContactValues;
  socials: ContactValues;
  occupation: string;
  skills: string;
  /** Important facts about the contact. */
  notes: string;
  /** Impressions ABOUT the person — deliberately a separate field from `notes`, so an observation
   *  and an opinion are never stored as the same kind of claim. */
  thoughts: string;
  /** Encrypted-asset ref for the bio picture, or null. */
  bioPicRef: string | null;
  /** Encrypted-asset refs for the album, in display order. */
  photoRefs: string[];
  /** Contact ids this person is known to. Always symmetric — see the store. */
  commonContacts: string[];
  createdAt: string;
  updatedAt: string;
}

/** What the renderer may send. The store owns `id` on first save, both timestamps, and the
 *  symmetry of `commonContacts`. */
export interface ContactInput {
  id?: string;
  name: string;
  alias?: string;
  emails?: ContactValues;
  phones?: ContactValues;
  urls?: ContactValues;
  socials?: ContactValues;
  occupation?: string;
  skills?: string;
  notes?: string;
  thoughts?: string;
  bioPicRef?: string | null;
  photoRefs?: string[];
  commonContacts?: string[];
}

/** The list view's row: enough to render and search without loading every note and photo. */
export interface ContactSummary {
  id: string;
  name: string;
  alias: string;
  occupation: string;
  bioPicRef: string | null;
  commonContactCount: number;
  updatedAt: string;
}
