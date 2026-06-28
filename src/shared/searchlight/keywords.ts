/**
 * Keyword and hint constants used by the structural signal extractor.
 * Reconciled verbatim to Aliens_eye (© 2021 Aaron Thomas, MIT licence)
 * config.py as of Task 9 — see THIRD_PARTY_LICENSES at the repo root.
 */

/** Indicates a real user profile page — used in body and meta text. */
export const POSITIVE_KEYWORDS: string[] = [
  'follow',
  'subscribe',
  'like',
  'share',
  'following',
  'followers',
  'profile',
  'user',
  'posts',
  'photos',
  'bio',
  'status',
  'tweets',
  'joined',
  'member since',
  'online',
  'verified',
  'active',
  'comments',
  'uploads',
  'reviews',
  'friends',
  'connections',
  'activity',
  'timeline',
];

/** Indicates a "user not found" / error page — used in body and meta text. */
export const ERROR_KEYWORDS: string[] = [
  'not found',
  "doesn't exist",
  "didn't find",
  'does not exist',
  'something went wrong',
  'no such user',
  'user not found',
  'cannot find',
  "can't find",
  'not exist',
  'profile not found',
  'account does not exist',
  'username not found',
  'no user found',
  'no results found',
  'no such username',
  "isn't available",
  'that content is unavailable',
  'page not found',
  '404',
  '404 error',
  '404 not found',
  'error',
  'sorry',
  'oops',
  'unavailable',
  'account suspended',
  'invalid username',
  'account not found',
  'account terminated',
  'account disabled',
  "user doesn't have an account",
  "this account doesn't exist",
  'page was not found',
];

/**
 * Additional profile-specific keywords checked in meta tag text only.
 * Combined with POSITIVE_KEYWORDS for meta_positive_keyword_count.
 */
export const META_KEYWORDS: string[] = [
  'profile picture',
  'profile image',
  'avatar',
  'user page',
  'username',
  'user profile',
  'account info',
  'account information',
  'user information',
];

/**
 * URL path patterns indicating a login/auth redirect (rather than a profile).
 * Matched as substrings of the URL path.
 */
export const AUTH_PATH_PATTERNS: string[] = [
  '/login',
  '/signin',
  '/register',
  '/join',
  'auth',
  'oauth',
  'authenticate',
  'account/login',
  'session/new',
  'user/login',
  'members/login',
];

/**
 * CSS class attribute hints indicating a profile/user section.
 * Checked against `class="..."` attribute values only.
 */
export const PROFILE_CLASS_HINTS: string[] = ['profile', 'user', 'account'];

/**
 * CSS class attribute hints indicating an error / not-found section.
 * Checked against `class="..."` attribute values only.
 */
export const ERROR_CLASS_HINTS: string[] = ['error', 'not-found', 'missing', 'unavailable'];
