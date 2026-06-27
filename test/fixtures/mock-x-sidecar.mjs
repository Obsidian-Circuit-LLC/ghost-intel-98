#!/usr/bin/env node
/**
 * Mock twscrape-runner for X-3 sidecar-client tests.
 *
 * Usage: node mock-x-sidecar.mjs <scenario>
 *
 * Scenarios:
 *   happy-3tweets      — 3 tweet frames then done{count:3, truncated:false}
 *   truncated          — 1 tweet frame then truncated{count:1, reason:'rate-limit', ...}
 *   done-zero          — done{count:0, truncated:false} (zero-result guard)
 *   doc-id-rotation    — error{code:'DOC_ID_ROTATION', fatal:true}
 *   protocol-error     — 1 MB+ garbage line (triggers the per-line cap)
 *   crash-no-frame     — reads ping then exits without any frame
 *   nonfatal-then-done — non-fatal warning then done{count:2, truncated:false}
 *
 * Wire protocol: NDJSON over stdin/stdout (spec §2.3).
 * Sends pong on ping, then executes the scenario on the next frame (search/userTweets).
 * Exits cleanly on shutdown.
 */

import { createInterface } from 'node:readline';

const scenario = process.argv[2] ?? 'happy-3tweets';

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function makeTweet(id) {
  return {
    id_str: String(id),
    date: '2026-06-27T10:00:00Z',
    rawContent: `Test tweet ${id} from the mock sidecar`,
    lang: 'en',
    url: `https://x.com/testuser/status/${id}`,
    user: {
      id_str: '9900',
      username: 'testuser',
      displayname: 'Test User',
    },
  };
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let gotPing = false;

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore malformed input
  }

  if (msg.type === 'shutdown') {
    process.exit(0);
  }

  if (msg.type === 'ping') {
    gotPing = true;
    send({ type: 'pong' });
    return;
  }

  // Respond to search / userTweets with the scenario
  if ((msg.type === 'search' || msg.type === 'userTweets') && gotPing) {
    runScenario();
    return;
  }
});

function runScenario() {
  switch (scenario) {
    case 'happy-3tweets':
      send({ type: 'tweet', data: makeTweet(1) });
      send({ type: 'tweet', data: makeTweet(2) });
      send({ type: 'tweet', data: makeTweet(3) });
      send({ type: 'done', count: 3, truncated: false });
      break;

    case 'truncated':
      send({ type: 'tweet', data: makeTweet(1) });
      send({ type: 'truncated', count: 1, reason: 'rate-limit', message: 'Rate limited after 1 tweet' });
      break;

    case 'done-zero':
      send({ type: 'done', count: 0, truncated: false });
      break;

    case 'doc-id-rotation':
      send({
        type: 'error',
        code: 'DOC_ID_ROTATION',
        message: 'GraphQL operation ID changed — update twscrape-runner sidecar',
        fatal: true,
      });
      break;

    case 'protocol-error': {
      // Output a line that exceeds the 1 MB per-line cap
      const oversize = 'X'.repeat(1_024 * 1_024 + 1);
      process.stdout.write(oversize + '\n');
      break;
    }

    case 'crash-no-frame':
      // Exit without sending any terminal frame — simulates a crash
      process.exit(1);
      break;

    case 'nonfatal-then-done':
      send({ type: 'tweet', data: makeTweet(1) });
      send({ type: 'tweet', data: makeTweet(2) });
      // Non-fatal warning: fatal:false, does NOT replace terminal frame
      send({ type: 'error', code: 'WARN_PARTIAL_MEDIA', message: 'Media metadata unavailable', fatal: false });
      send({ type: 'done', count: 2, truncated: false });
      break;

    default:
      send({ type: 'error', code: 'UNKNOWN_SCENARIO', message: `Unknown scenario: ${scenario}`, fatal: true });
  }
}
