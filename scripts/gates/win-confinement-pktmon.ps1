# Windows INV-C1 acceptance gate — the load-bearing Windows verification for the WFP-on-SID egress jail.
# The exact analog of the Linux netns gate (scripts/gates/osint-confinement-netns.sh): it OBSERVES what
# actually leaves the box for the engine user, catching the C-extension / getaddrinfo / raw-socket leak
# classes a source review can't. THIS GATE IS THE GO/NO-GO for any 05c offensive code on Windows.
#
# Prereq: `dcs98-confine.exe install` has run (engine user + SYSTEM service + persistent base-deny WFP).
# Run elevated (pktmon needs admin). Run once per release that touches confinement.
#
# WINDOWS HOST ONLY — cannot run in Linux CI.

param(
  [int]$ProxyPort = 54321,
  [string]$AllowCidr = '203.0.113.0/24',
  [switch]$Poisoned   # diagnostic: run with the engine base-deny removed; the gate MUST then FAIL.
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe  = Join-Path $here '..\..\native\dcs98-confine\target\x86_64-pc-windows-msvc\release\dcs98-confine.exe'
$etl  = Join-Path $env:TEMP 'dcs98c1.etl'
$pcap = Join-Path $env:TEMP 'dcs98c1.pcap'

if (-not (Test-Path $exe)) { throw "helper not built: $exe (cargo build --release --target x86_64-pc-windows-msvc)" }

pktmon start --capture --pkt-size 0 --file $etl | Out-Null
try {
  # The probe applies a scope then attempts, AS the engine user:
  #   (a) connect 127.0.0.1:$ProxyPort  (expect SUCCESS)
  #   (b) connect first host in $AllowCidr (expect reachable)
  #   (c) connect 8.8.8.8:443           (expect BLOCKED)
  #   (d) getaddrinfo("example.com")    (expect FAIL — no resolver reachable)
  & $exe probe --proxy-port $ProxyPort --allow-cidr $AllowCidr | Out-Null
} finally {
  pktmon stop | Out-Null
  # HOST-CONFIRM the exact subcommand on your build: `pktmon etl2pcap` (classic pcap, what the asserter
  # parses) vs `pktmon pcapng` (pcapng). The asserter currently expects classic pcap.
  pktmon etl2pcap $etl --out $pcap | Out-Null
}

python "$here\assert-pktmon-confined.py" $pcap $ProxyPort $AllowCidr
if ($Poisoned) {
  Write-Error 'POISONED-FIXTURE EXPECTATION: the gate should have FAILED above (base-deny removed). If it printed PASS, the gate is vacuous.'
  exit 1
}
Write-Host 'INV-C1 WFP gate: PASS'
