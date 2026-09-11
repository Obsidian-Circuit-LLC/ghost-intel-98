/**
 * HumanDB (renamed from Address Book) — the contact record and its input shape.
 *
 * Field set is GhostExodus's spec verbatim: name, alias, email, phone, URL, social media,
 * occupation, skills, notes, thoughts, a bio picture and a photo album — later extended with date
 * of birth, place of birth, address and criminal record. The five repeatable fields (email / phone
 * / URL / social / affiliation) are arrays because his UI adds entries with a plus sign; a contact
 * with one email and a contact with six are the same shape.
 *
 * `dob`/`placeOfBirth`/`address`/`criminalRecord` are plain free text, same posture as `notes` —
 * whatever the analyst typed, never parsed into a structured date/address, never adjudicated. A
 * criminal-record entry is the analyst's own research note about what they found, not a verified
 * legal fact; it carries no more authority than anything else typed into this record.
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
  /** Groups, orgs or collectives the contact is tied to. Repeatable — an OSINT subject can belong
   *  to several, and the network is often the point. */
  affiliations: ContactValues;
  occupation: string;
  skills: string;
  /** Free text, as typed — no calendar/date parsing, so a partial or uncertain date ("circa 1990")
   *  is not forced into a shape the analyst never observed. */
  dob: string;
  placeOfBirth: string;
  /** Free text — may be one line or several (street, then city/state/zip). */
  address: string;
  /** The analyst's own research note, not a verified legal record — same posture as `notes`. */
  criminalRecord: string;
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
  affiliations?: ContactValues;
  occupation?: string;
  skills?: string;
  dob?: string;
  placeOfBirth?: string;
  address?: string;
  criminalRecord?: string;
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
