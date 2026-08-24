const crypto = require('node:crypto');

function sha256(value) {
  const data = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function canonicalPostEvidence(post) {
  return {
    id: String(post.id || ''),
    profileId: String(post.profileId || ''),
    caseId: String(post.caseId || ''),
    username: String(post.username || ''),
    sourceUsername: String(post.sourceUsername || ''),
    url: String(post.url || ''),
    text: String(post.text || ''),
    createdAt: String(post.createdAt || ''),
    kind: String(post.kind || ''),
    parentPostId: post.parentPostId || null,
    media: Array.isArray(post.media) ? post.media : [],
  };
}

function canonicalRelationshipEvidence(row) {
  return {
    profileId: String(row.profileId || ''),
    caseId: String(row.caseId || ''),
    relationship: String(row.relationship || ''),
    username: String(row.username || ''),
    displayName: String(row.displayName || ''),
    bio: String(row.bio || ''),
    url: String(row.url || ''),
  };
}

function cleanUrl(raw) {
  return String(raw || '').replace(/[),.;!?]+$/g, '');
}

function extractEntities(text) {
  const source = String(text || '');
  const values = [];
  const seen = new Set();
  const add = (type, value, normalized = value) => {
    const v = String(value || '').trim();
    const n = String(normalized || '').trim();
    if (!v || !n) return;
    const key = `${type}:${n.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    values.push({ type, value: v, normalizedValue: n.toLowerCase() });
  };

  for (const match of source.matchAll(/(^|[^\w])@([A-Za-z0-9_]{1,15})\b/g)) add('mention', `@${match[2]}`, match[2]);
  for (const match of source.matchAll(/(^|[^\w])#([\p{L}\p{N}_]{2,80})/gu)) add('hashtag', `#${match[2]}`, match[2]);
  for (const match of source.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) add('email', match[0], match[0]);
  for (const match of source.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const url = cleanUrl(match[0]);
    add('url', url, url);
    try {
      const host = new URL(url).hostname.replace(/^www\./i, '');
      if (host) add('domain', host, host);
    } catch {
      // Ignore malformed URLs captured from free text.
    }
  }
  for (const match of source.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi)) {
    const domain = match[0].replace(/^www\./i, '');
    if (!domain.includes('@')) add('domain', domain, domain);
  }
  for (const match of source.matchAll(/\b0x[a-fA-F0-9]{40}\b/g)) add('crypto_eth', match[0], match[0]);
  for (const match of source.matchAll(/\b(?:bc1[a-zA-HJ-NP-Z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g)) add('crypto_btc', match[0], match[0]);
  for (const match of source.matchAll(/(?:\+?\d[\d\s().-]{7,}\d)/g)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 15) add('phone', match[0].trim(), digits);
  }
  const orgPattern = /\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,5}\s+(?:Inc\.?|LLC|Ltd\.?|Limited|PLC|Corp\.?|Corporation|Company|Group|Holdings|Foundation|Association|University|Institute|Agency|Ministry|Department))\b/g;
  for (const match of source.matchAll(orgPattern)) add('organization', match[1], match[1]);
  return values;
}

function computeNetworkAnalysis(state, caseId) {
  const profiles = (state.profiles || []).filter((p) => !caseId || p.caseId === caseId);
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const relationships = (state.relationships || []).filter((r) => (!caseId || r.caseId === caseId) && profileById.has(r.profileId));
  const identityMap = new Map();

  for (const row of relationships) {
    const key = String(row.username || '').toLowerCase();
    if (!key) continue;
    let item = identityMap.get(key);
    if (!item) {
      item = {
        username: row.username,
        displayName: row.displayName || row.username,
        bio: row.bio || '',
        avatar: row.avatar || '',
        url: row.url || `https://x.com/${row.username}`,
        followerOfProfileIds: new Set(),
        followingFromProfileIds: new Set(),
        profileIds: new Set(),
        firstObservedAt: row.firstObservedAt || row.collectedAt || null,
        lastObservedAt: row.lastObservedAt || row.collectedAt || null,
      };
      identityMap.set(key, item);
    }
    item.profileIds.add(row.profileId);
    if (row.relationship === 'follower') item.followerOfProfileIds.add(row.profileId);
    if (row.relationship === 'following') item.followingFromProfileIds.add(row.profileId);
    if (String(row.lastObservedAt || row.collectedAt || '') > String(item.lastObservedAt || '')) item.lastObservedAt = row.lastObservedAt || row.collectedAt;
    if (!item.firstObservedAt || String(row.firstObservedAt || row.collectedAt || '') < String(item.firstObservedAt)) item.firstObservedAt = row.firstObservedAt || row.collectedAt;
  }

  const totalTargets = Math.max(1, profiles.length);
  const identities = [...identityMap.values()].map((item) => {
    const profileIds = [...item.profileIds];
    const followerOfProfileIds = [...item.followerOfProfileIds];
    const followingFromProfileIds = [...item.followingFromProfileIds];
    const connectedTargets = profileIds.length;
    const relationshipDiversity = (followerOfProfileIds.length ? 1 : 0) + (followingFromProfileIds.length ? 1 : 0);
    const overlapScore = Math.min(100, Math.round((connectedTargets / totalTargets) * 90 + (relationshipDiversity === 2 ? 10 : 0)));
    return {
      username: item.username,
      displayName: item.displayName,
      bio: item.bio,
      avatar: item.avatar,
      url: item.url,
      profileIds,
      followerOfProfileIds,
      followingFromProfileIds,
      followerOf: followerOfProfileIds.map((id) => profileById.get(id)?.username).filter(Boolean),
      followingFrom: followingFromProfileIds.map((id) => profileById.get(id)?.username).filter(Boolean),
      connectedTargets,
      overlapScore,
      firstObservedAt: item.firstObservedAt,
      lastObservedAt: item.lastObservedAt,
    };
  }).sort((a, b) => b.connectedTargets - a.connectedTargets || b.overlapScore - a.overlapScore || a.username.localeCompare(b.username));

  const setsFor = (profileId, relationship) => new Set(
    relationships
      .filter((r) => r.profileId === profileId && r.relationship === relationship)
      .map((r) => String(r.username || '').toLowerCase())
  );
  const pairs = [];
  for (let i = 0; i < profiles.length; i += 1) {
    for (let j = i + 1; j < profiles.length; j += 1) {
      const a = profiles[i];
      const b = profiles[j];
      const aFollowers = setsFor(a.id, 'follower');
      const bFollowers = setsFor(b.id, 'follower');
      const aFollowing = setsFor(a.id, 'following');
      const bFollowing = setsFor(b.id, 'following');
      const commonFollowers = [...aFollowers].filter((u) => bFollowers.has(u));
      const commonFollowing = [...aFollowing].filter((u) => bFollowing.has(u));
      const anyA = new Set([...aFollowers, ...aFollowing]);
      const anyB = new Set([...bFollowers, ...bFollowing]);
      const commonAny = [...anyA].filter((u) => anyB.has(u));
      pairs.push({
        profileAId: a.id,
        profileA: a.username,
        profileBId: b.id,
        profileB: b.username,
        commonFollowers,
        commonFollowing,
        commonAny,
        commonFollowerCount: commonFollowers.length,
        commonFollowingCount: commonFollowing.length,
        commonAnyCount: commonAny.length,
      });
    }
  }
  pairs.sort((a, b) => b.commonAnyCount - a.commonAnyCount || b.commonFollowerCount - a.commonFollowerCount);

  const top = identities.filter((x) => x.connectedTargets >= 2).slice(0, 100);
  const nodes = [
    ...profiles.map((p) => ({ id: `target:${p.id}`, type: 'target', label: `@${p.username}`, profileId: p.id, username: p.username, avatar: p.avatar || '', score: 100 })),
    ...top.map((x) => ({ id: `identity:${x.username.toLowerCase()}`, type: 'identity', label: `@${x.username}`, username: x.username, avatar: x.avatar || '', score: x.overlapScore, connectedTargets: x.connectedTargets })),
  ];
  const graphIdentityNames = new Set(top.map((x) => x.username.toLowerCase()));
  const edges = relationships
    .filter((r) => graphIdentityNames.has(String(r.username || '').toLowerCase()))
    .map((r) => ({
      id: `${r.profileId}:${r.relationship}:${String(r.username).toLowerCase()}`,
      source: `target:${r.profileId}`,
      target: `identity:${String(r.username).toLowerCase()}`,
      relationship: r.relationship,
    }));

  return {
    generatedAt: new Date().toISOString(),
    targetCount: profiles.length,
    relationshipCount: relationships.length,
    uniqueIdentityCount: identities.length,
    commonIdentityCount: identities.filter((x) => x.connectedTargets >= 2).length,
    highOverlapCount: identities.filter((x) => x.connectedTargets >= Math.max(2, Math.ceil(profiles.length * 0.5))).length,
    pairs,
    identities,
    graph: { nodes, edges },
  };
}

function deriveCollectionHealth(state, caseId) {
  const profiles = (state.profiles || []).filter((p) => !caseId || p.caseId === caseId);
  const runs = (state.collectionRuns || []).filter((r) => !caseId || r.caseId === caseId);
  return profiles.map((profile) => {
    const profileRuns = runs.filter((r) => r.profileId === profile.id).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    const last = (operation) => profileRuns.find((r) => r.operation === operation) || null;
    const posts = (state.posts || []).filter((p) => p.profileId === profile.id && (!caseId || p.caseId === caseId));
    const followers = (state.relationships || []).filter((r) => r.profileId === profile.id && r.relationship === 'follower' && (!caseId || r.caseId === caseId));
    const following = (state.relationships || []).filter((r) => r.profileId === profile.id && r.relationship === 'following' && (!caseId || r.caseId === caseId));
    const oldestPostAt = posts.map((p) => p.createdAt).filter(Boolean).sort()[0] || null;
    const lastAny = profileRuns[0] || null;
    let status = profile.lastError ? 'ERROR' : lastAny ? 'HEALTHY' : 'IDLE';
    if (lastAny?.added === 0 && lastAny?.observed > 0 && ['followers', 'following', 'archive_followers', 'archive_following'].includes(lastAny.operation)) status = 'PLATEAU';
    return {
      profileId: profile.id,
      username: profile.username,
      status,
      lastError: profile.lastError || null,
      postCount: posts.length,
      followerCount: followers.length,
      followingCount: following.length,
      oldestPostAt,
      lastPostRun: last('posts') || last('archive_posts'),
      lastFollowerRun: last('followers') || last('archive_followers'),
      lastFollowingRun: last('following') || last('archive_following'),
      lastRun: lastAny,
    };
  });
}

module.exports = {
  sha256,
  canonicalPostEvidence,
  canonicalRelationshipEvidence,
  extractEntities,
  computeNetworkAnalysis,
  deriveCollectionHealth,
};
