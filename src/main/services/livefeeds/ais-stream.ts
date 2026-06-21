/** AISStream.io WebSocket client (main-only). Opens ONLY when networkEnabled + a stored key; host
 *  hard-pinned. Parses PositionReports into a vessel map, prunes >10 min, emits batched snapshots on
 *  a ~2 s throttle via the supplied callback. The renderer never opens a socket. */
import WebSocket from 'ws';
import { settingsStore } from '../../storage/json-fs';
import { secretStore } from '../../secrets';
import { parseAisMessage, pruneVessels } from '@shared/livefeeds/aisParse';
import { boundsToAisSubscription } from '@shared/livefeeds/bbox';
import type { Bounds, ShipPos } from '@shared/livefeeds/types';

const AIS_URL = 'wss://stream.aisstream.io/v0/stream';
const THROTTLE_MS = 2000;
let ws: WebSocket | null = null;
let vessels = new Map<string, ShipPos>();
let bbox: Bounds | null = null;
let apiKey = '';
let emit: ((s: ShipPos[]) => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(): void {
  if (ws && ws.readyState === WebSocket.OPEN && bbox) {
    ws.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: boundsToAisSubscription(bbox), FilterMessageTypes: ['PositionReport'] }));
  }
}

export async function startAis(bounds: Bounds, onPositions: (s: ShipPos[]) => void): Promise<'started' | 'no-key' | 'gate-off'> {
  if (!(await settingsStore.read()).geoint?.networkEnabled) return 'gate-off';
  const key = await secretStore.get('geoint.ais.key');
  if (!key) return 'no-key';
  stopAis();
  apiKey = key; bbox = bounds; emit = onPositions; vessels = new Map();
  ws = new WebSocket(AIS_URL);
  ws.on('open', () => subscribe());
  ws.on('message', (data: WebSocket.RawData) => {
    try {
      const pos = parseAisMessage(JSON.parse(data.toString()), Date.now());
      if (pos) vessels.set(pos.id, pos);
    } catch { /* malformed frame — ignore */ }
  });
  ws.on('error', () => { /* surfaced via close/reconnect; do not throw */ });
  timer = setInterval(() => {
    pruneVessels(vessels, Date.now());
    emit?.([...vessels.values()]);
  }, THROTTLE_MS);
  return 'started';
}

export function setAisBbox(bounds: Bounds): void { bbox = bounds; subscribe(); }

export function stopAis(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (ws) { try { ws.close(); } catch { /* ignore */ } ws = null; }
  vessels = new Map(); emit = null;
}
