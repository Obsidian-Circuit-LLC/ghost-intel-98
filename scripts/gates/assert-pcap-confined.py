#!/usr/bin/env python3
"""INV-C1 pcap assertion: prove a netns egress jail leaked nothing.

Reads a capture produced by tcpdump inside the confinement netns and asserts:
  1. Every observed destination IP is in the allowed set:
       { host-veth proxy IP }  UNION  { every IP in each allow CIDR }
  2. ZERO UDP:53 packets (no DNS escaped to a system resolver).
  3. No packet to 8.8.8.8 (the out-of-scope probe target), as a named guard even
     if it somehow fell inside an allow CIDR.

Parser: pure Python stdlib. tshark and scapy are intentionally NOT required (they
are absent on the CI image and on this box). tcpdump writes the classic pcap
format (magic a1b2c3d4 / d4c3b2a1, or nanosecond a1b23c4d / 4dc3b2a1); we parse
that directly. Link types handled: EN10MB (1) and RAW IPv4/IPv6 (101/12/14).

Exit 0 + "INV-C1 netns gate: PASS" on a clean capture; non-zero listing offenders
otherwise. This file is the load-bearing verifier — it must FAIL on a real leak
(see the poisoned-fixture mode in osint-confinement-netns.sh).
"""
import ipaddress
import struct
import sys

# pcap classic global-header magics -> (endianness char, timestamp resolution)
_MAGICS = {
    0xA1B2C3D4: ("<", "us"),
    0xD4C3B2A1: (">", "us"),
    0xA1B23C4D: ("<", "ns"),
    0x4DC3B2A1: (">", "ns"),
}

# DLT/LINKTYPE values we know how to strip down to an IP header.
DLT_EN10MB = 1
DLT_RAW = 101
DLT_RAW_BSD1 = 12
DLT_RAW_BSD2 = 14


def _parse_global_header(data):
    if len(data) < 24:
        raise ValueError("pcap too short for global header")
    magic = struct.unpack("<I", data[:4])[0]
    if magic not in _MAGICS:
        magic_be = struct.unpack(">I", data[:4])[0]
        if magic_be in _MAGICS:
            magic = magic_be
        else:
            raise ValueError("not a classic pcap file (bad magic 0x%08x)" % magic)
    endian, _res = _MAGICS[magic]
    # global header: magic(4) ver_maj(2) ver_min(2) thiszone(4) sigfigs(4) snaplen(4) network(4)
    network = struct.unpack(endian + "I", data[20:24])[0]
    return endian, network


def _l3_offset(network, frame):
    """Return (offset_to_ip_header, ethertype_or_None) for the given link type."""
    if network == DLT_EN10MB:
        if len(frame) < 14:
            return None, None
        ethertype = struct.unpack(">H", frame[12:14])[0]
        off = 14
        # Strip one 802.1Q VLAN tag if present.
        if ethertype == 0x8100 and len(frame) >= 18:
            ethertype = struct.unpack(">H", frame[16:18])[0]
            off = 18
        return off, ethertype
    if network in (DLT_RAW, DLT_RAW_BSD1, DLT_RAW_BSD2):
        # Raw IP: infer v4/v6 from the version nibble.
        if not frame:
            return None, None
        ver = frame[0] >> 4
        if ver == 4:
            return 0, 0x0800
        if ver == 6:
            return 0, 0x86DD
        return None, None
    return None, None


def _extract(frame, network):
    """Return (dst_ip_str, l4_proto, dst_port_or_None) or None if not IP."""
    off, ethertype = _l3_offset(network, frame)
    if off is None:
        return None
    pkt = frame[off:]
    if ethertype == 0x0800:  # IPv4
        if len(pkt) < 20:
            return None
        ihl = (pkt[0] & 0x0F) * 4
        if ihl < 20 or len(pkt) < ihl:
            return None
        proto = pkt[9]
        dst = ipaddress.IPv4Address(pkt[16:20])
        dport = None
        if proto in (6, 17) and len(pkt) >= ihl + 4:
            dport = struct.unpack(">H", pkt[ihl + 2:ihl + 4])[0]
        return (str(dst), proto, dport)
    if ethertype == 0x86DD:  # IPv6 (no extension-header walking; good enough for the probe)
        if len(pkt) < 40:
            return None
        proto = pkt[6]  # next header
        dst = ipaddress.IPv6Address(pkt[24:40])
        dport = None
        if proto in (6, 17) and len(pkt) >= 44:
            dport = struct.unpack(">H", pkt[42:44])[0]
        return (str(dst), proto, dport)
    return None


def iter_packets(path):
    with open(path, "rb") as f:
        data = f.read()
    endian, network = _parse_global_header(data)
    pos = 24
    n = len(data)
    while pos + 16 <= n:
        # record header: ts_sec(4) ts_frac(4) incl_len(4) orig_len(4)
        incl_len = struct.unpack(endian + "I", data[pos + 8:pos + 12])[0]
        pos += 16
        if pos + incl_len > n:
            break
        frame = data[pos:pos + incl_len]
        pos += incl_len
        yield frame, network


def main(argv):
    if len(argv) < 3:
        sys.stderr.write(
            "usage: assert-pcap-confined.py <pcap> <proxy_ip> [allow_cidr ...]\n"
        )
        return 2
    pcap_path = argv[1]
    proxy_ip = argv[2]
    allow_cidrs = argv[3:]

    try:
        proxy_net = ipaddress.ip_network(proxy_ip + "/32", strict=False) \
            if ":" not in proxy_ip else ipaddress.ip_network(proxy_ip + "/128", strict=False)
    except ValueError as e:
        sys.stderr.write("bad proxy IP %r: %s\n" % (proxy_ip, e))
        return 2

    nets = [proxy_net]
    for c in allow_cidrs:
        try:
            nets.append(ipaddress.ip_network(c, strict=False))
        except ValueError as e:
            sys.stderr.write("bad allow CIDR %r: %s\n" % (c, e))
            return 2

    def allowed(ip_str):
        ip = ipaddress.ip_address(ip_str)
        return any(ip in net for net in nets)

    UDP = 17
    GOOGLE_DNS = ipaddress.ip_address("8.8.8.8")

    offenders = []          # (dst, proto, dport) outside the allow set
    dns_packets = []        # any UDP:53
    google_packets = []     # any 8.8.8.8
    seen_dsts = set()
    total = 0

    try:
        for frame, network in iter_packets(pcap_path):
            parsed = _extract(frame, network)
            if parsed is None:
                continue
            dst, proto, dport = parsed
            total += 1
            seen_dsts.add(dst)

            if proto == UDP and dport == 53:
                dns_packets.append(dst)
            try:
                if ipaddress.ip_address(dst) == GOOGLE_DNS:
                    google_packets.append(dst)
            except ValueError:
                pass
            if not allowed(dst):
                offenders.append((dst, proto, dport))
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
    if dns_packets:
        fail = True
        sys.stderr.write("INV-C1 FAIL: %d UDP:53 (DNS) packet(s) escaped to: %s\n"
                         % (len(dns_packets), ", ".join(sorted(set(dns_packets)))))
    if google_packets:
        fail = True
        sys.stderr.write("INV-C1 FAIL: %d packet(s) to out-of-scope 8.8.8.8\n" % len(google_packets))

    if fail:
        sys.stderr.write("INV-C1 netns gate: FAIL (observed dsts: %s)\n"
                         % ", ".join(sorted(seen_dsts)))
        return 1

    allow_desc = ", ".join([str(proxy_net)] + allow_cidrs)
    print("INV-C1 netns gate: PASS")
    print("  packets analyzed: %d; destinations: %s; allow set: %s"
          % (total, ", ".join(sorted(seen_dsts)) or "(none)", allow_desc))
    print("  UDP:53 packets: 0; 8.8.8.8 packets: 0")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
