#!/usr/bin/env bash
#
# INV-C1 acceptance gate: stand up the Linux netns egress jail, capture all egress
# with tcpdump, run a probe inside the ns that deliberately attempts in-scope /
# out-of-scope / DNS dials, then assert the capture is confined.
#
# This shell replicates the linux-netns.ts mechanism MINIMALLY and self-containedly
# (no Electron/Node needed to run the gate) using the SAME rules buildNetnsNftRuleset
# emits: output policy drop; accept lo / established-related / proxy-path / allow-CIDR.
# If the two ever drift, the differential is a finding — keep them in lockstep.
#
# Requires root / CAP_NET_ADMIN and: ip, nft, tcpdump, socat, python3.
#
# Modes:
#   (normal)        build a correct jail; the gate MUST pass.
#   C1_POISON=1     set the ns output policy to ACCEPT (simulate a leak); the gate
#                   MUST fail — proving it detects a real leak, not vacuously passes.
#
# Usage: osint-confinement-netns.sh [proxyPort] [allowCidr]
set -u

PROXY_PORT="${1:-18443}"
ALLOW_CIDR="${2:-203.0.113.0/24}"
POISON="${C1_POISON:-0}"

HOST_VETH_IP="10.255.255.0"
NS_VETH_IP="10.255.255.1"
VETH_PREFIX="31"
BLACKHOLE_RESOLVER="127.0.0.2"

SUFFIX="$$"
NS="dcs98-scan-gate-${SUFFIX}"
HVETH="dgh-${SUFFIX}"
NVETH="dgn-${SUFFIX}"
RESOLV_DIR="/etc/netns/${NS}"
WORK="$(mktemp -d /tmp/dcs98-c1-XXXXXX)"
PCAP="${WORK}/egress.pcap"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSERT="${SCRIPT_DIR}/assert-pcap-confined.py"

# First host of the allow CIDR = the in-scope probe target.
IN_SCOPE_IP="$(python3 - "$ALLOW_CIDR" <<'PY'
import ipaddress, sys
net = ipaddress.ip_network(sys.argv[1], strict=False)
print(next(iter(net.hosts())) if net.num_addresses > 1 else net.network_address)
PY
)"

TCPDUMP_PID=""
SOCAT_PID=""

log() { printf '[c1-gate] %s\n' "$*" >&2; }

cleanup() {
  [ -n "$TCPDUMP_PID" ] && kill "$TCPDUMP_PID" 2>/dev/null
  [ -n "$SOCAT_PID" ] && kill "$SOCAT_PID" 2>/dev/null
  ip link del "$HVETH" 2>/dev/null
  ip netns del "$NS" 2>/dev/null
  rm -rf "$RESOLV_DIR" 2>/dev/null
  rm -rf "$WORK" 2>/dev/null
}
trap cleanup EXIT INT TERM

require_tools() {
  local missing=0 t
  for t in ip nft tcpdump socat python3; do
    command -v "$t" >/dev/null 2>&1 || { log "MISSING required tool: $t"; missing=1; }
  done
  [ "$missing" -eq 0 ] || { log "environment cannot run the gate (missing tools above)"; exit 3; }
  if [ "$(id -u)" -ne 0 ]; then
    log "must run as root / CAP_NET_ADMIN"; exit 3
  fi
  # Prove netns is actually permitted (containers often forbid it).
  if ! ip netns add "c1probe${SUFFIX}" 2>/dev/null; then
    log "netns creation is not permitted in this environment (no CAP_NET_ADMIN / blocked)"; exit 3
  fi
  ip netns del "c1probe${SUFFIX}" 2>/dev/null
}

build_jail() {
  log "building netns ${NS} (proxyPort=${PROXY_PORT}, allow=${ALLOW_CIDR}, poison=${POISON})"
  ip netns add "$NS" || { log "netns add failed"; exit 3; }
  ip netns exec "$NS" ip link set lo up || exit 3

  ip link add "$HVETH" type veth peer name "$NVETH" || exit 3
  ip link set "$NVETH" netns "$NS" || exit 3
  ip addr add "${HOST_VETH_IP}/${VETH_PREFIX}" dev "$HVETH" || exit 3
  ip link set "$HVETH" up || exit 3
  ip netns exec "$NS" ip addr add "${NS_VETH_IP}/${VETH_PREFIX}" dev "$NVETH" || exit 3
  ip netns exec "$NS" ip link set "$NVETH" up || exit 3
  ip netns exec "$NS" ip route add default via "$HOST_VETH_IP" || exit 3

  # Resolver black-hole for the ns.
  mkdir -p "$RESOLV_DIR"
  printf 'nameserver %s\n' "$BLACKHOLE_RESOLVER" > "${RESOLV_DIR}/resolv.conf"

  # Host-side proxy forward (host veth IP -> real loopback proxy).
  socat "TCP-LISTEN:${PROXY_PORT},bind=${HOST_VETH_IP},fork,reuseaddr" \
        "TCP:127.0.0.1:${PROXY_PORT}" >/dev/null 2>&1 &
  SOCAT_PID="$!"

  # nft ruleset inside the ns. NORMAL: policy drop + enumerated accepts (mirrors
  # buildNetnsNftRuleset). POISON: policy accept (simulated leak).
  if [ "$POISON" = "1" ]; then
    log "POISONED FIXTURE: ns output policy = ACCEPT (gate MUST detect this leak)"
    ip netns exec "$NS" nft -f - <<NFT || exit 3
flush ruleset
table inet dcs98_jail {
  chain output {
    type filter hook output priority 0; policy accept;
  }
}
NFT
  else
    ip netns exec "$NS" nft -f - <<NFT || exit 3
flush ruleset
table inet dcs98_jail {
  chain output {
    type filter hook output priority 0; policy drop;
    oif "lo" accept
    ct state established,related accept
    ip daddr ${HOST_VETH_IP} tcp dport ${PROXY_PORT} accept
    ip daddr { ${ALLOW_CIDR} } accept
  }
}
NFT
  fi
}

# Probe run INSIDE the namespace. Deliberately attempts the honest engine's leak
# classes: an in-scope dial, an out-of-scope dial (8.8.8.8:443), and a DNS
# resolution via getaddrinfo. Each attempt is best-effort — we want the PACKETS on
# the wire (captured by tcpdump), not success; the jail is expected to drop most.
run_probe() {
  ip netns exec "$NS" python3 - "$IN_SCOPE_IP" "$PROXY_PORT" "$HOST_VETH_IP" <<'PY'
import socket, sys
in_scope_ip, proxy_port, proxy_ip = sys.argv[1], int(sys.argv[2]), sys.argv[3]

def attempt(desc, fn):
    try:
        fn()
        print("[probe] %s: connected/resolved" % desc)
    except Exception as e:
        print("[probe] %s: blocked/failed (%s)" % (desc, type(e).__name__))

# (a) in-scope dial — emits SYN packets to the allow CIDR (allowed by the jail).
attempt("in-scope %s:443" % in_scope_ip,
        lambda: socket.create_connection((in_scope_ip, 443), timeout=2))
# (b) proxy path — TCP to the host veth IP on the proxy port (allowed).
attempt("proxy %s:%d" % (proxy_ip, proxy_port),
        lambda: socket.create_connection((proxy_ip, proxy_port), timeout=2))
# (c) out-of-scope dial — 8.8.8.8:443 (MUST be dropped; no packet should leave).
attempt("out-of-scope 8.8.8.8:443",
        lambda: socket.create_connection(("8.8.8.8", 443), timeout=2))
# (d) DNS resolution via getaddrinfo — MUST NOT produce a UDP:53 packet to a real
#     resolver (black-holed to 127.0.0.2 AND dropped by nft).
attempt("dns getaddrinfo(example.com)",
        lambda: socket.getaddrinfo("example.com", 443, proto=socket.IPPROTO_TCP))
PY
}

require_tools
build_jail

log "starting tcpdump (egress-only) on ${NVETH} inside ${NS}"
# Capture OUTBOUND ONLY (-Q out) on the ns side of the veth. Rationale:
#  - The nft `output` hook drops a denied packet BEFORE it reaches the interface, so
#    a dropped probe never appears on the wire. That is the property we PROVE: the
#    normal jail's capture shows only allowed dsts; the poisoned jail lets the dropped
#    probes escape and they appear.
#  - Without -Q out, tcpdump also records REPLY packets (whose dst is the ns's own IP)
#    and link-local multicast (IGMP 224.0.0.22 / mDNS 224.0.0.251) the kernel emits on
#    link-up — neither is a child egress decision, but both would muddy a dst-set
#    assertion. -Q out scopes the capture to exactly "packets this host chose to send."
ip netns exec "$NS" tcpdump -n -i "$NVETH" -Q out -w "$PCAP" -U >/dev/null 2>&1 &
TCPDUMP_PID="$!"
sleep 1   # let tcpdump open the capture

run_probe

sleep 1   # flush
kill "$TCPDUMP_PID" 2>/dev/null; wait "$TCPDUMP_PID" 2>/dev/null
TCPDUMP_PID=""

log "asserting capture ${PCAP}"
python3 "$ASSERT" "$PCAP" "$HOST_VETH_IP" "$ALLOW_CIDR"
ASSERT_RC=$?

if [ "$POISON" = "1" ]; then
  # Poisoned fixture: the gate MUST have FAILED (non-zero). If it passed, the gate
  # is vacuous and that itself is the finding.
  if [ "$ASSERT_RC" -eq 0 ]; then
    log "POISON CHECK FAILED: gate PASSED on a leaking jail — the gate is vacuous!"
    exit 1
  fi
  log "POISON CHECK OK: gate correctly FAILED on the leaking jail"
  echo "INV-C1 poison check: PASS (gate detects real leaks)"
  exit 0
fi

exit "$ASSERT_RC"
