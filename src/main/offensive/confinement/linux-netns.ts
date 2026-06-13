/**
 * Linux network-namespace egress jail (Task 3, INV-C1).
 *
 * A child launched here can reach ONLY:
 *   - the loopback authorized-egress proxy (127.0.0.1:proxyPort on the HOST), reached
 *     via a host-side TCP forward that bridges the namespace into host loopback, and
 *   - the engagement's scope CIDRs.
 * Everything else — crucially system-resolver DNS (UDP:53) — hits the namespace's nft
 * `output` drop policy and never leaves the kernel. This is the load-bearing INV-C1
 * confinement; the netns gate (Task 4) proves it with a packet capture.
 *
 * Mechanism (the shape worked out in the spike):
 *   1. A uniquely-named netns `dcs98-scan-<rand>`; `lo` brought up inside.
 *   2. A veth pair host<->ns. Host side `10.255.255.0/31`, ns side `10.255.255.1/31`.
 *      Default route in the ns points at the host veth IP.
 *   3. HOST-side forward: the proxy listens on host loopback (`127.0.0.1:proxyPort`),
 *      which is unreachable from inside a netns (separate loopback). We run a `socat`
 *      on the host that LISTENs on the host veth IP:proxyPort and forwards each
 *      connection to `127.0.0.1:proxyPort`. The child therefore dials
 *      `10.255.255.0:proxyPort` and is bridged into the real loopback proxy. socat is
 *      chosen over an iptables/nft DNAT because it needs no host-side NAT table
 *      mutation (nothing to leak or fail to clean up in the host's global netfilter
 *      state) — teardown is just "kill the pid".
 *   4. nft ruleset INSIDE the ns (see buildNetnsNftRuleset): output policy `drop`,
 *      ACCEPT only lo / established-related / the proxy path / the allow CIDRs.
 *   5. Resolver black-hole: `/etc/netns/<ns>/resolv.conf` = `nameserver 127.0.0.2`, so
 *      getaddrinfo inside the ns cannot reach any real resolver even before nft drops
 *      the UDP:53 packet. (Belt and suspenders: the file blocks resolution, nft blocks
 *      the packet.)
 *   6. `ip netns exec <ns> <cmd> <args>` with the piper-tts stdio template; a SIGKILL
 *      timeout backstop and a synchronous `will-quit` teardown so a crash never leaves
 *      a dangling netns / veth / host socat.
 *
 * SCOPE / non-root: this spike assumes root or CAP_NET_ADMIN (CI runs elevated; the
 * Windows WFP impl needs elevation too — symmetric). The shipped-Linux non-root path
 * (rootless `unshare -Urn` + slirp4netns, vs a one-time setuid / CAP_NET_ADMIN helper)
 * is an operator-flagged sub-decision and is intentionally NOT solved here.
 * TODO(operator): decide rootless slirp4netns vs setuid helper for the shipped Linux
 * non-root egress jail. Tracked separately from this spike.
 */
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import type { ConfinedHandle, ConfinedIO, PlatformImpl } from './index';
import type { ConfinementPlan } from './plan';
import { __registerLinuxImpl } from './index';

/** Host side of the veth /31. The proxy-forward socat LISTENs here. */
const HOST_VETH_IP = '10.255.255.0';
/** Namespace side of the veth /31. The child's source address. */
const NS_VETH_IP = '10.255.255.1';
const VETH_PREFIX = 31;
/** Black-hole resolver: a loopback address nothing listens on. */
const BLACKHOLE_RESOLVER = '127.0.0.2';
/** SIGKILL backstop if the child outlives a stop() grace window. */
const STOP_GRACE_MS = 4000;

/**
 * Names derived from the netns id. veth names must fit IFNAMSIZ (15 chars), so we
 * use a short random suffix and short fixed prefixes.
 */
interface NetnsNames {
  ns: string;
  hostVeth: string;
  nsVeth: string;
  resolvDir: string;
}

function deriveNames(rand: string): NetnsNames {
  // `dcs98-scan-<rand>` for the ns (no length limit); veth names use a 8-char rand to
  // stay within the 15-char interface-name limit ("dh-"/"dn-" + 8 = 11 chars).
  const short = rand.slice(0, 8);
  return {
    ns: `dcs98-scan-${rand}`,
    hostVeth: `dh-${short}`,
    nsVeth: `dn-${short}`,
    resolvDir: `/etc/netns/dcs98-scan-${rand}`,
  };
}

/** Partition allow CIDRs by family for the nft `ip`/`ip6` daddr sets. */
function partitionCidrs(allowCidrs: string[]): { v4: string[]; v6: string[] } {
  const v4: string[] = [];
  const v6: string[] = [];
  for (const cidr of allowCidrs) {
    const base = cidr.slice(0, cidr.lastIndexOf('/'));
    const fam = isIP(base);
    if (fam === 4) v4.push(cidr);
    else if (fam === 6) v6.push(cidr);
    // fam === 0 cannot occur: buildConfinementPlan already rejected malformed CIDRs.
  }
  return { v4, v6 };
}

/**
 * Build the nftables ruleset string applied INSIDE the namespace. Pure and
 * deterministic given (proxyPort, allowCidrs, hostVethIp) — this is the groundable,
 * unit-testable core of the jail. The output chain defaults to DROP; only the
 * enumerated ACCEPTs let traffic out.
 *
 * Exported for the gate and for unit tests. Not part of the PlatformImpl surface.
 */
export function buildNetnsNftRuleset(
  proxyPort: number,
  allowCidrs: string[],
  hostVethIp: string = HOST_VETH_IP,
): string {
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
    throw new Error(`netns nft: invalid proxyPort ${proxyPort}`);
  }
  const { v4, v6 } = partitionCidrs(allowCidrs);
  const lines: string[] = [];
  lines.push('flush ruleset');
  lines.push('table inet dcs98_jail {');
  lines.push('  chain output {');
  lines.push('    type filter hook output priority 0; policy drop;');
  // (a) loopback inside the ns is always fine.
  lines.push('    oif "lo" accept');
  // (b) return traffic for connections we already permitted.
  lines.push('    ct state established,related accept');
  // (c) the proxy path: TCP to the host veth IP on proxyPort (socat bridges to the
  //     real 127.0.0.1:proxyPort on the host).
  lines.push(`    ip daddr ${hostVethIp} tcp dport ${proxyPort} accept`);
  // (d) the engagement's scope CIDRs, by family. Empty sets are omitted (nft rejects
  //     an empty anonymous set).
  if (v4.length > 0) {
    lines.push(`    ip daddr { ${v4.join(', ')} } accept`);
  }
  if (v6.length > 0) {
    lines.push(`    ip6 daddr { ${v6.join(', ')} } accept`);
  }
  // Everything else — including udp dport 53 to any system resolver — falls through
  // to the drop policy. The drop is explicit-by-policy; no further rule needed.
  lines.push('  }');
  lines.push('}');
  return lines.join('\n') + '\n';
}

/** Run a command synchronously; throw with stderr on non-zero exit. Used for the
 *  one-shot namespace-construction steps where we want a hard failure if any step
 *  fails (a half-built jail is worse than no jail). */
function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${(r.stderr || '').trim()}`);
  }
}

/** Best-effort synchronous command; never throws. Used in teardown where each step
 *  must run regardless of whether earlier steps (or the resource itself) existed. */
function runQuiet(cmd: string, args: string[]): void {
  try {
    spawnSync(cmd, args, { encoding: 'utf8', stdio: 'ignore' });
  } catch {
    /* teardown is best-effort */
  }
}

/** Apply the nft ruleset inside the ns by piping it to `nft -f -`. */
function applyNftInNs(ns: string, ruleset: string): void {
  const r = spawnSync('ip', ['netns', 'exec', ns, 'nft', '-f', '-'], {
    input: ruleset,
    encoding: 'utf8',
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`nft -f - in ns ${ns} failed (${r.status}): ${(r.stderr || '').trim()}`);
  }
}

/**
 * Build the namespace, veth pair, routes, resolver black-hole, and nft rules. On ANY
 * failure, tear down whatever was created and rethrow — never leave a partial jail.
 */
function buildJail(names: NetnsNames, plan: ConfinementPlan): ChildProcess {
  const { ns, hostVeth, nsVeth, resolvDir } = names;
  let socat: ChildProcess | null = null;
  try {
    // 1. netns + lo up.
    run('ip', ['netns', 'add', ns]);
    run('ip', ['netns', 'exec', ns, 'ip', 'link', 'set', 'lo', 'up']);

    // 2. veth pair; move the ns end into the namespace; address both ends.
    run('ip', ['link', 'add', hostVeth, 'type', 'veth', 'peer', 'name', nsVeth]);
    run('ip', ['link', 'set', nsVeth, 'netns', ns]);
    run('ip', ['addr', 'add', `${HOST_VETH_IP}/${VETH_PREFIX}`, 'dev', hostVeth]);
    run('ip', ['link', 'set', hostVeth, 'up']);
    run('ip', ['netns', 'exec', ns, 'ip', 'addr', 'add', `${NS_VETH_IP}/${VETH_PREFIX}`, 'dev', nsVeth]);
    run('ip', ['netns', 'exec', ns, 'ip', 'link', 'set', nsVeth, 'up']);
    // Default route in the ns via the host veth IP, so allow-CIDR traffic has a path.
    run('ip', ['netns', 'exec', ns, 'ip', 'route', 'add', 'default', 'via', HOST_VETH_IP]);

    // 3. Resolver black-hole BEFORE launching anything: /etc/netns/<ns>/resolv.conf is
    //    bind-mounted over /etc/resolv.conf for processes in this ns by `ip netns exec`.
    mkdirSync(resolvDir, { recursive: true });
    writeFileSync(`${resolvDir}/resolv.conf`, `nameserver ${BLACKHOLE_RESOLVER}\n`, { mode: 0o644 });

    // 4. Host-side proxy forward: socat on the host veth IP -> real loopback proxy.
    //    Kept on the HOST (not in the ns) so the bridge into host loopback is outside
    //    the jail's drop policy; the child reaches it as an in-ns destination IP.
    socat = spawn(
      'socat',
      [
        `TCP-LISTEN:${plan.proxyPort},bind=${HOST_VETH_IP},fork,reuseaddr`,
        `TCP:127.0.0.1:${plan.proxyPort}`,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
    socat.on('error', () => { /* surfaced as a connect failure inside the ns */ });

    // 5. nft drop-by-default ruleset inside the ns.
    applyNftInNs(ns, buildNetnsNftRuleset(plan.proxyPort, plan.allowCidrs));

    return socat;
  } catch (err) {
    if (socat && !socat.killed) { try { socat.kill('SIGKILL'); } catch { /* */ } }
    teardownJail(names);
    throw err;
  }
}

/** Unconditionally remove the netns, veth, and resolver dir. Idempotent; safe to call
 *  on a partially-built or already-torn-down jail. The host socat is killed by the
 *  caller (it owns the ChildProcess handle). Deleting the netns also deletes the
 *  ns-side veth automatically; the host-side veth is deleted explicitly in case the
 *  pair was created but not yet moved. */
function teardownJail(names: NetnsNames): void {
  const { ns, hostVeth, resolvDir } = names;
  runQuiet('ip', ['link', 'del', hostVeth]);
  runQuiet('ip', ['netns', 'del', ns]);
  try { rmSync(resolvDir, { recursive: true, force: true }); } catch { /* */ }
}

/** Module-global set of live jails, for the synchronous will-quit backstop. Mirrors
 *  the `active` Set in piper-tts and the killNow() pattern in tor.ts. */
interface LiveJail {
  names: NetnsNames;
  child: ChildProcess | null;
  socat: ChildProcess | null;
}
const liveJails = new Set<LiveJail>();
let willQuitWired = false;

/** Synchronous crash-safety backstop: kill children and tear down every jail. Wired
 *  into Electron's `app.on('will-quit')` exactly once, lazily, so importing this
 *  module outside Electron (e.g. the gate, unit tests) does not require electron. */
function ensureWillQuitBackstop(): void {
  if (willQuitWired) return;
  willQuitWired = true;
  let app: { on?: (e: string, cb: () => void) => void } | undefined;
  try {
    // Lazy require so non-Electron importers (gate/tests) don't pull in electron.
    app = (require('electron') as { app?: typeof app }).app;
  } catch {
    app = undefined;
  }
  app?.on?.('will-quit', () => {
    for (const jail of liveJails) {
      if (jail.child && !jail.child.killed) { try { jail.child.kill('SIGKILL'); } catch { /* */ } }
      if (jail.socat && !jail.socat.killed) { try { jail.socat.kill('SIGKILL'); } catch { /* */ } }
      teardownJail(jail.names);
    }
    liveJails.clear();
  });
}

/**
 * Spawn `cmd args` inside a fresh netns egress jail derived from `plan`. Returns a
 * ConfinedHandle whose stop() kills the child, the host socat, and the namespace.
 */
export const spawnLinuxNetns: PlatformImpl = async (
  cmd: string,
  args: string[],
  plan: ConfinementPlan,
  io: ConfinedIO,
): Promise<ConfinedHandle> => {
  ensureWillQuitBackstop();

  const rand = randomBytes(6).toString('hex'); // 12 hex chars
  const names = deriveNames(rand);

  // Build the jail synchronously (each step throws on failure, teardown on rethrow).
  const socat = buildJail(names, plan);

  const jail: LiveJail = { names, child: null, socat };
  liveJails.add(jail);

  let child: ChildProcess;
  try {
    child = spawn('ip', ['netns', 'exec', names.ns, cmd, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (socat && !socat.killed) { try { socat.kill('SIGKILL'); } catch { /* */ } }
    liveJails.delete(jail);
    teardownJail(names);
    throw err;
  }
  jail.child = child;

  child.stdout?.on('data', (b: Buffer) => io.onStdout?.(b));
  child.stderr?.on('data', (b: Buffer) => io.onStderr?.(b));

  let torn = false;
  /** Idempotent teardown: kill child + socat, remove the namespace. Safe after exit. */
  const teardown = async (): Promise<void> => {
    if (torn) return;
    torn = true;
    liveJails.delete(jail);
    // Graceful child kill with a SIGKILL backstop, mirroring tor.ts:stop().
    if (child.exitCode === null && child.signalCode === null && !child.killed) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } resolve(); }, STOP_GRACE_MS);
        child.once('exit', () => { clearTimeout(t); resolve(); });
        try { child.kill('SIGTERM'); } catch { clearTimeout(t); resolve(); }
      });
    }
    if (socat && !socat.killed) { try { socat.kill('SIGKILL'); } catch { /* */ } }
    teardownJail(names);
  };

  child.on('exit', (code) => {
    io.onExit?.(code);
    // Tear the jail down when the child exits on its own (do not await; fire-and-forget
    // is fine — teardown is idempotent and stop() may also run).
    void teardown();
  });
  child.on('error', () => { void teardown(); });

  return {
    pid: child.pid ?? -1,
    stop: teardown,
  };
};

// Self-register at module load, guarded by platform per index.ts's contract.
if (process.platform === 'linux') {
  __registerLinuxImpl(spawnLinuxNetns);
}
