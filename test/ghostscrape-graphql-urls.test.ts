/**
 * GhostScrape Task 1: GraphQL URL matcher tests (pure).
 *
 * isTimelineGraphqlUrl matches the X GraphQL timeline endpoints (UserTweets /
 * UserTweetsAndReplies). isProfileGraphqlUrl matches the profile endpoint
 * (UserByScreenName). Both are literal substring checks — never a RegExp built
 * from runtime input.
 */

import { describe, it, expect } from 'vitest';
import { isTimelineGraphqlUrl, isProfileGraphqlUrl } from '../src/main/x/ghostscrape/graphql-urls';

describe('isTimelineGraphqlUrl', () => {
  it('matches a UserTweets GraphQL url', () => {
    expect(isTimelineGraphqlUrl('https://x.com/i/api/graphql/abc/UserTweets?variables=...')).toBe(true);
  });

  it('matches a UserTweetsAndReplies GraphQL url', () => {
    expect(
      isTimelineGraphqlUrl('https://x.com/i/api/graphql/def/UserTweetsAndReplies?variables=...')
    ).toBe(true);
  });

  it('does not match a UserByScreenName GraphQL url', () => {
    expect(isTimelineGraphqlUrl('https://x.com/i/api/graphql/ghi/UserByScreenName?variables=...')).toBe(
      false
    );
  });

  it('does not match a non-graphql url', () => {
    expect(isTimelineGraphqlUrl('https://x.com/home')).toBe(false);
  });
});

describe('isProfileGraphqlUrl', () => {
  it('matches a UserByScreenName GraphQL url', () => {
    expect(isProfileGraphqlUrl('https://x.com/i/api/graphql/ghi/UserByScreenName?variables=...')).toBe(
      true
    );
  });

  it('does not match a UserTweets GraphQL url', () => {
    expect(isProfileGraphqlUrl('https://x.com/i/api/graphql/abc/UserTweets?variables=...')).toBe(false);
  });

  it('does not match a non-graphql url', () => {
    expect(isProfileGraphqlUrl('https://x.com/home')).toBe(false);
  });
});
