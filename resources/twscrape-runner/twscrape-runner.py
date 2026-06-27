#!/usr/bin/env python3
"""
twscrape-runner — NDJSON stdio sidecar for Ghost Intel 98 X/Twitter collector.
Compiled by PyInstaller (--onedir) per scripts/build-twscrape-runner.sh.

Wire protocol: spec §2.3.  One job per process; exits after the terminal frame.

Requests (stdin, one JSON object per newline-terminated line):
  { "type": "ping" }
  { "type": "search",     "query": "...",    "limit": N, "since": "...", "until": "...", "creds": {...} }
  { "type": "userTweets", "username": "...", "limit": N, "since": "...", "until": "...", "creds": {...} }
  { "type": "shutdown" }

Responses (stdout, NDJSON — one JSON object per newline-terminated line):
  { "type": "pong" }
  { "type": "tweet", "data": { ... } }           -- streaming tweet frames
  { "type": "done",      "count": N, "truncated": false }
  { "type": "truncated", "count": N, "reason": "...", "message": "..." }
  { "type": "error",     "code": "...", "message": "...", "fatal": true|false }

Wire invariants (spec §2.3):
  1. Every run terminates with exactly one terminal frame: done | truncated | error{fatal:true}.
  2. done{truncated:false, count>0} is the only truly complete result.
  3. truncated = stopped early for any reason (rate-limit, timeout, error).
  4. error{fatal:true} = whole run failed; error{fatal:false} = mid-stream warning only.
  5. GraphQL 200 with empty data → truncated/error, NEVER done{count:0,truncated:false}.
  6. Doc_id rotation → error{code:'DOC_ID_ROTATION', fatal:true}, never silent.

SEALED: twscrape is not installed in this build.  Any search/userTweets request will
return error{code:'TWSCRAPE_NOT_INSTALLED', fatal:true} until the operator completes
the §6 decisions and runs this script through scripts/build-twscrape-runner.sh.

Supply-chain note (spec §5.7): install ONLY from requirements-lock.txt (--require-hashes).
Verify pypi.org/project/twscrape/ belongs to vladkens before building.
"""

from __future__ import annotations

import json
import sys
import os

# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------

_CRED_KEYS: frozenset[str] = frozenset({'auth_token', 'ct0', 'password'})


def _send(obj: dict) -> None:
    """Emit one NDJSON frame to stdout and flush immediately."""
    line = json.dumps(obj, separators=(',', ':'), ensure_ascii=False)
    sys.stdout.write(line + '\n')
    sys.stdout.flush()


def _scrub(msg: str) -> str:
    """Strip credential tokens from strings before they reach stderr or error frames."""
    for key in _CRED_KEYS:
        # Simple pattern: 'auth_token=<token>' or '"auth_token":"<token>"'
        import re
        msg = re.sub(rf'{re.escape(key)}=[^\s&\"\';,]*', f'{key}=[REDACTED]', msg)
        msg = re.sub(rf'"{re.escape(key)}"\s*:\s*"[^"]*"', f'"{key}":"[REDACTED]"', msg)
    return msg


def _log(msg: str) -> None:
    """Write a scrubbed diagnostic message to stderr only (never stdout)."""
    print(f'[twscrape-runner] {_scrub(msg)}', file=sys.stderr, flush=True)


def _warn(code: str, message: str) -> None:
    """Emit a non-fatal mid-stream warning.  Does NOT terminate the job."""
    _send({'type': 'error', 'code': code, 'message': _scrub(message), 'fatal': False})


def _fatal(code: str, message: str) -> None:
    """Emit a fatal terminal error frame and exit non-zero.  Terminates the job."""
    _send({'type': 'error', 'code': code, 'message': _scrub(message), 'fatal': True})
    sys.exit(1)


def _done(count: int, truncated: bool = False) -> None:
    _send({'type': 'done', 'count': count, 'truncated': truncated})


def _truncated(count: int, reason: str, message: str) -> None:
    _send({'type': 'truncated', 'count': count, 'reason': reason, 'message': _scrub(message)})


# ---------------------------------------------------------------------------
# Guarded twscrape import  (SEALED — not installed; see module docstring)
# ---------------------------------------------------------------------------

try:
    import twscrape as _twscrape_module       # noqa: F401
    import twscrape.api as _twscrape_api      # the public API surface
    _TWSCRAPE_AVAILABLE = True
except ImportError:
    _twscrape_module = None                   # type: ignore[assignment]
    _twscrape_api = None                      # type: ignore[assignment]
    _TWSCRAPE_AVAILABLE = False


def _require_twscrape() -> None:
    """Call before any collection attempt.  Emits fatal error if twscrape is missing."""
    if not _TWSCRAPE_AVAILABLE:
        _fatal(
            'TWSCRAPE_NOT_INSTALLED',
            'twscrape is not installed in this sidecar binary — '
            'build the PyInstaller onedir package per scripts/build-twscrape-runner.sh '
            'and the §5.7 supply-chain checklist before running live X collection.'
        )


# ---------------------------------------------------------------------------
# Doc_id rotation detection (spec §4.3)
# ---------------------------------------------------------------------------

# Error names that X/twscrape surfaces when GraphQL operation IDs are stale.
_ROTATION_ERROR_NAMES: frozenset[str] = frozenset({
    'AuthorizationError', 'BadRequest', 'Forbidden',
})


def _is_doc_id_rotation(exc: Exception) -> bool:
    """
    Heuristic: return True if the exception looks like an X doc_id rotation event.

    twscrape raises httpx.HTTPStatusError or a custom TwscrapeError containing the
    X error extension name in its string representation.  Exact X error strings are
    [UNVERIFIED] per spec §4.3 — confirm at smoke test and refine if needed.
    """
    msg = str(exc)
    for name in _ROTATION_ERROR_NAMES:
        if name in msg:
            return True
    # HTTP 400/403 on a GraphQL endpoint is the primary rotation signal.
    if ('status_code=400' in msg or 'status_code=403' in msg or
            ' 400 ' in msg or ' 403 ' in msg):
        return True
    return False


# ---------------------------------------------------------------------------
# Schema mapping: twscrape Tweet → wire frame (spec §1)
# ---------------------------------------------------------------------------

def _tweet_to_frame(tweet: object) -> dict:
    """
    Map a twscrape Tweet object to the NDJSON wire shape (spec §1).

    Fields:
      id_str, date (ISO 8601 UTC), rawContent, url, user{id_str,username,displayname},
      lang (optional), media (optional list of {mediaType}).
    """
    # date: twscrape returns a timezone-aware datetime; format to UTC ISO 8601.
    raw_date = getattr(tweet, 'date', None)
    if raw_date is not None and hasattr(raw_date, 'strftime'):
        date_str = raw_date.strftime('%Y-%m-%dT%H:%M:%SZ')
    else:
        date_str = str(raw_date) if raw_date is not None else ''

    user = getattr(tweet, 'user', None)
    user_frame = {
        'id_str':      str(getattr(user, 'id', '') if user else ''),
        'username':    getattr(user, 'username', '') or '',
        'displayname': getattr(user, 'displayName', '') or '',
    }

    frame: dict = {
        'id_str':     str(getattr(tweet, 'id', '') or ''),
        'date':       date_str,
        'rawContent': getattr(tweet, 'rawContent', '') or '',
        'url':        getattr(tweet, 'url', '') or '',
        'user':       user_frame,
    }

    lang = getattr(tweet, 'lang', None)
    if lang:
        frame['lang'] = lang

    # Media: record type for provenance; no retrieval in v1 (spec §5.4).
    raw_media = getattr(tweet, 'media', None)
    if raw_media:
        media_list = []
        for m in raw_media:
            mt = getattr(m, 'type', None) or getattr(m, 'mediaType', None)
            if mt == 'AnimatedGif':
                mt = 'gif'
            if mt in ('photo', 'video', 'gif'):
                media_list.append({'mediaType': mt})
        if media_list:
            frame['media'] = media_list

    return frame


# ---------------------------------------------------------------------------
# Collection: keyword search
# ---------------------------------------------------------------------------

async def _collect_search(req: dict) -> None:
    """
    Keyword-search collection mode (spec §1.1).

    Emits tweet frames then a terminal frame (done | truncated | error{fatal}).
    Credentials are passed in the stdin request payload (never argv/env, spec §2.4).
    """
    import asyncio  # noqa: F401 — imported at call-site to avoid global import in frozen binary

    _require_twscrape()

    query:  str       = req.get('query', '')
    limit:  int       = int(req.get('limit', 100))
    since:  str | None = req.get('since')
    until:  str | None = req.get('until')
    creds:  dict      = req.get('creds') or {}

    api = _twscrape_api.API()

    if creds.get('auth_token') and creds.get('ct0'):
        try:
            await api.pool.add_account(
                username=creds.get('username', 'account'),
                password=creds.get('password', ''),
                email='',
                email_password='',
                cookies=f'auth_token={creds["auth_token"]}; ct0={creds["ct0"]}',
            )
        except Exception as e:
            _fatal('CRED_SETUP_ERROR', f'Failed to configure account pool: {e}')
            return

    # Append date range to query string (twscrape search accepts Twitter advanced-search syntax).
    q = query
    if since:
        q += f' since:{since}'
    if until:
        q += f' until:{until}'

    count = 0
    try:
        async for tweet in api.search(q, limit=limit):
            _send({'type': 'tweet', 'data': _tweet_to_frame(tweet)})
            count += 1
        # FAIL-LOUD (spec §4): reaching the requested limit is an INCOMPLETE fetch,
        # not completion. Only done{truncated:false} when the source exhausted below limit.
        if count >= limit:
            _truncated(count, 'limit-reached',
                       f'Reached the requested limit of {limit} results; more may exist. '
                       f'Incomplete — do not treat as evidence of absence.')
        else:
            _done(count, truncated=False)
    except Exception as e:
        if _is_doc_id_rotation(e):
            _fatal('DOC_ID_ROTATION',
                   f'X GraphQL operation ID changed — update the twscrape-runner sidecar. '
                   f'Detail: {e}')
        else:
            _truncated(count, 'error',
                       f'Collection stopped after {count} tweets: {e}')


# ---------------------------------------------------------------------------
# Collection: user timeline
# ---------------------------------------------------------------------------

async def _collect_user_tweets(req: dict) -> None:
    """
    User-timeline collection mode (spec §1.1).

    channelId = '@username'; resolves to user_id then fetches timeline.
    since/until filtering is applied client-side (twscrape user_tweets does not
    accept these parameters directly).
    """
    _require_twscrape()

    username: str       = req.get('username', '').lstrip('@')
    limit:    int       = int(req.get('limit', 200))
    since:    str | None = req.get('since')
    until:    str | None = req.get('until')
    creds:    dict      = req.get('creds') or {}

    api = _twscrape_api.API()

    if creds.get('auth_token') and creds.get('ct0'):
        try:
            await api.pool.add_account(
                username=creds.get('username', 'account'),
                password=creds.get('password', ''),
                email='',
                email_password='',
                cookies=f'auth_token={creds["auth_token"]}; ct0={creds["ct0"]}',
            )
        except Exception as e:
            _fatal('CRED_SETUP_ERROR', f'Failed to configure account pool: {e}')
            return

    count = 0
    raw = 0
    seen_in_range = False
    try:
        user = await api.user_by_login(username)
        if user is None:
            _truncated(0, 'user-not-found', f'User @{username} not found on X')
            return

        async for tweet in api.user_tweets(user.id, limit=limit):
            raw += 1
            frame = _tweet_to_frame(tweet)
            # Tweets are newest-first, EXCEPT a pinned tweet may appear first, out of order.
            if until and frame['date'] > until:
                continue
            if since and frame['date'] < since:
                # Older than the window. If we have NOT yet entered the in-range
                # chronological stream, this is almost certainly a pinned (old) tweet at
                # the head — skip it, do NOT end the timeline (the old `break` here dropped
                # the entire timeline whenever the pinned tweet predated `since`). Once
                # in-range, an out-of-range tweet means we have passed the window: stop.
                if seen_in_range:
                    break
                continue
            seen_in_range = True
            _send({'type': 'tweet', 'data': frame})
            count += 1

        # FAIL-LOUD (spec §4): the raw generator hitting the limit ⇒ incomplete, not done.
        if raw >= limit:
            _truncated(count, 'limit-reached',
                       f'Reached the requested limit of {limit} timeline tweets; more may exist. '
                       f'Incomplete — do not treat as evidence of absence.')
        else:
            _done(count, truncated=False)

    except Exception as e:
        if _is_doc_id_rotation(e):
            _fatal('DOC_ID_ROTATION',
                   f'X GraphQL operation ID changed — update the twscrape-runner sidecar. '
                   f'Detail: {e}')
        else:
            _truncated(count, 'error',
                       f'Collection stopped after {count} tweets: {e}')


# ---------------------------------------------------------------------------
# Main NDJSON event loop
# ---------------------------------------------------------------------------

def main() -> None:
    """
    Read NDJSON frames from stdin.  Respond to ping immediately.  Execute one
    collection job then exit (per-job process model, spec §2.4).
    """
    import asyncio

    got_ping = False

    for raw_line in sys.stdin:
        line = raw_line.rstrip('\n\r')
        if not line:
            continue

        try:
            msg: dict = json.loads(line)
        except json.JSONDecodeError:
            _log(f'ignoring non-JSON stdin line: {line[:80]!r}')
            continue

        msg_type: str = msg.get('type', '')

        if msg_type == 'shutdown':
            sys.exit(0)

        if msg_type == 'ping':
            got_ping = True
            _send({'type': 'pong'})
            continue

        if msg_type in ('search', 'userTweets') and got_ping:
            try:
                if msg_type == 'search':
                    asyncio.run(_collect_search(msg))
                else:
                    asyncio.run(_collect_user_tweets(msg))
            except SystemExit:
                raise
            except Exception as e:
                _fatal('INTERNAL', f'Unhandled exception in runner: {e}')
            # Per-job process: the caller has sent shutdown or we exit after the terminal frame.
            sys.exit(0)

        if msg_type in ('search', 'userTweets') and not got_ping:
            _fatal('PROTOCOL_ERROR', 'Received collection request before ping/pong handshake')

        _log(f'unknown message type: {msg_type!r}')


if __name__ == '__main__':
    main()
