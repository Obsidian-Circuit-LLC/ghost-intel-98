/**
 * Keyword constants used by the structural signal extractor.
 * These are English-first placeholders; Task 9 reconciles them verbatim to
 * the upstream Aliens_eye features.py keyword lists.
 */

export const POSITIVE_KEYWORDS: string[] = [
  'followers', 'following', 'joined', 'posts', 'profile', 'member since', 'avatar', 'bio',
];

export const ERROR_KEYWORDS: string[] = [
  "doesn't exist", 'not found', 'no user', 'page not found',
  'account suspended', 'removed', '404', 'does not exist',
];

export const AUTH_PATH_PATTERNS: string[] = [
  '/login', '/signin', '/sign_in', '/auth',
];

export const PROFILE_SECTION_HINTS: string[] = [
  'profile', 'avatar', 'followers', 'user-info',
];

export const ERROR_SECTION_HINTS: string[] = [
  'error', 'notfound', 'not-found', '404', 'empty',
];
