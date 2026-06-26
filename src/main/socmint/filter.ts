/**
 * Literal keyword filter for harvested SOCMINT items.
 *
 * Invariant: NEVER construct a RegExp from a keyword or from harvested text.
 * Matching uses String.prototype.includes on case-folded strings only.
 * This defends against ReDoS — harvested text is attacker-controlled.
 */

import type { HarvestedItem } from '../../shared/socmint/types';

/**
 * Returns true when `text` contains at least one of the `keywords` as a
 * literal case-insensitive substring.
 *
 * Empty `keywords` ⇒ match all (no filtering applied).
 *
 * Matching is strictly literal — a keyword value of ".*" or "a|b" must
 * appear verbatim in the text; it is NOT interpreted as a regular expression.
 */
export function matchesKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;

  const haystack = text.toLowerCase();
  for (const kw of keywords) {
    // Literal case-folded substring check — no RegExp construction.
    if (haystack.includes(kw.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Filters `items` to those whose `text` field matches at least one keyword
 * (OR semantics).  Preserves the original order of matching items.
 *
 * Empty `keywords` ⇒ all items pass through unchanged.
 */
export function filterByKeywords(
  items: HarvestedItem[],
  keywords: string[],
): HarvestedItem[] {
  if (keywords.length === 0) return items;
  return items.filter(item => matchesKeywords(item.text, keywords));
}
