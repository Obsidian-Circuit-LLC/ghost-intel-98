#!/usr/bin/env python3
"""INV-C1 pcap assertion for the WINDOWS WFP-on-SID egress jail.

The Windows analog of assert-pcap-confined.py (the Linux netns gate). To stay DRY, this REUSES that
file's pure-stdlib pcap parser (iter_packets / _extract) by importing it directly — no fork of the parser.
On top of the shared "every dst IP in {proxy} ∪ allow-CIDRs, zero DNS, no 8.8.8.8" check, the Windows jail
adds two assertions the spec (Plan 05a T5.6 step 2) calls for:

  * zero TCP:853 (DNS-over-TLS) packets — the engine must not reach a DoT resolver either, and
  * zero packets to the IMDS link-local 169.254.169.254 (the top-weight WFP IMDS deny must hold).

Capture source: pktmon (`pktmon etl2pcap` → classic pcap). HOST-CONFIRM the pktmon subcommand emits classic
pcap (this parser's format); if your pktmon emits pcapng, convert it or extend the parser.

Exit 0 + "INV-C1 WFP gate: PASS" on a clean capture; non-zero listing offenders otherwise. Like the Linux
gate, it MUST FAIL on a real leak (run win-confinement-pktmon.ps1 -Poisoned to confirm it isn't vacuous).
"""
import importlib.util
import ipaddress
import os
import sys

# Reuse the Linux asserter's parser verbatim (it has a hyphen in the filename → load by path).
_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "assert_pcap_confined", os.path.join(_HERE, "assert-pcap-confined.py")
)
_pcap = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_pcap)
iter_packets = _pcap.iter_packets
_extract = _pcap._extract

TCP = 6
UDP = 17
IMDS_V4 = ipaddress.ip_address("169.254.169.254")
GOOGLE_DNS = ipaddress.ip_address("8.8.8.8")


def main(argv):
    if len(argv) < 3:
        sys.stderr.write("usage: assert-pktmon-confined.py <pcap> <proxy_port> [allow_cidr ...]\n")
        return 2
    pcap_path = argv[1]
    try:
        proxy_port = int(argv[2])
    except ValueError:
        sys.stderr.write("proxy_port must be an integer\n")
        return 2
    allow_cidrs = argv[3:]

    # Allow set: loopback (the proxy lives at 127.0.0.1:proxy_port) ∪ every scope CIDR.
    nets = [ipaddress.ip_network("127.0.0.1/32")]
    for c in allow_cidrs:
        try:
            nets.append(ipaddress.ip_network(c, strict=False))
        except ValueError as e:
            sys.stderr.write("bad allow CIDR %r: %s\n" % (c, e))
            return 2

    def allowed(ip):
        return any(ip in net for net in nets)

    offenders, dns_pkts, dot_pkts, imds_pkts = [], [], [], []
    proxy_hits = 0
    total = 0

    try:
        for frame, network in iter_packets(pcap_path):
            parsed = _extract(frame, network)
            if parsed is None:
                continue
            dst_s, proto, dport = parsed
            total += 1
            try:
                dst = ipaddress.ip_address(dst_s)
            except ValueError:
                continue

            if proto == UDP and dport == 53:
                dns_pkts.append(dst_s)
            if proto == TCP and dport == 853:
                dot_pkts.append(dst_s)
            if dst == IMDS_V4:
                imds_pkts.append(dst_s)
            if dst == ipaddress.ip_address("127.0.0.1") and dport == proxy_port:
                proxy_hits += 1
            if not allowed(dst):
                offenders.append((dst_s, proto, dport))
    except (OSError, ValueError) as e:
        sys.stderr.write("pcap parse error: %s\n" % e)
        return 2

    fail = False
    if offenders:
        fail = True
        sys.stderr.write("INV-C1 FAIL: %d packet(s) to out-of-scope destinations:\n" % len(offenders))
        for dst, proto, dport in sorted(set(offenders)):
            pname = {6: "tcp", 17: "udp"}.get(proto, "ip-proto-%d" % proto)
            sys.stderr.write("  -> %s %s dport=%s\n" % (dst, pname, dport))
    if dns_pkts:
        fail = True
        sys.stderr.write("INV-C1 FAIL: %d UDP:53 DNS packet(s) escaped to: %s\n"
                         % (len(dns_pkts), ", ".join(sorted(set(dns_pkts)))))
    if dot_pkts:
        fail = True
        sys.stderr.write("INV-C1 FAIL: %d TCP:853 DoT packet(s) escaped to: %s\n"
                         % (len(dot_pkts), ", ".join(sorted(set(dot_pkts)))))
    if imds_pkts:
        fail = True
        sys.stderr.write("INV-C1 FAIL: %d packet(s) to IMDS 169.254.169.254\n" % len(imds_pkts))

    if fail:
        return 1
    sys.stderr.write("observed %d egress packet(s); %d to the loopback proxy; allow-set respected\n"
                     % (total, proxy_hits))
    print("INV-C1 WFP gate: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
