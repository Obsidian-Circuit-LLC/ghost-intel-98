# Market-data sources — verification pack

> **STATUS: UNVERIFIED CANDIDATES.** I cannot reach the network from the build environment, so
> nothing below is confirmed. Every endpoint, field name, rate limit, and licensing note is from
> prior knowledge and **must be confirmed by running the curl commands** on a networked machine
> before any of it is wired into code. Paste the real responses back and I'll build adapters
> against the actual shapes. Do not treat this file as authoritative until the ✅ boxes are checked.

The app fetches from the **Electron main process** (Node), not a browser — so CORS is irrelevant,
but some hosts block non-browser User-Agents, so each command sends a normal UA. All market egress
will sit behind a **`markets.networkEnabled` gate, off by default**, exactly like GeoINT.

Goal: cover **crypto, FX, stock indices + equities, commodities** with **free / unpaid** sources
(keyless preferred; free-tier-with-key acceptable if the quota is generous).

---

## RECOMMENDED FREE STACK (to verify first)

| Market class | First choice (verify) | Why |
|---|---|---|
| Crypto | **CoinGecko** `/api/v3/simple/price` | keyless, broad coverage, stable JSON |
| FX | **Frankfurter** (`frankfurter.app`, ECB data) | keyless, clean JSON, reputable source |
| Indices + equities | **Stooq** CSV (`stooq.com/q/l/`) | keyless, indices + tickers + futures in one |
| Commodities | **Stooq** futures symbols (gold `gc.f`, oil `cl.f`) | same source as equities → one adapter |
| All-in-one (fallback) | **Yahoo Finance** unofficial `query1` quote endpoint | one endpoint spans every class — but unofficial/unstable, verify ToS |

Rationale for the split: Stooq gives equities + indices + commodities through one CSV adapter, so
two verified adapters (CoinGecko + Frankfurter + Stooq) cover all four classes. Yahoo is the
single-endpoint fallback but is an undocumented/unofficial API — only lean on it if the others fail.

---

## Verification commands

Run each, then paste back: (a) the HTTP status, (b) the first ~15 lines of the body. If a command
hangs or 4xx/5xx/403s, note that — a 403 usually means the host wants a browser UA or blocks the IP.

### 1. Crypto — CoinGecko (keyless)
```sh
curl -s -w '\n[HTTP %{http_code}]\n' \
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,monero&vs_currencies=usd&include_24hr_change=true'
```
Expect JSON like `{"bitcoin":{"usd":NNNNN,"usd_24h_change":N.NN}, ...}`. ✅ verified? ☐

### 2. FX — Frankfurter (keyless, ECB)
```sh
curl -s -w '\n[HTTP %{http_code}]\n' 'https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,CHF'
```
Expect `{"amount":1.0,"base":"USD","date":"YYYY-MM-DD","rates":{"EUR":...}}`. ✅ verified? ☐
Alt to also test (in case Frankfurter is down):
```sh
curl -s -w '\n[HTTP %{http_code}]\n' 'https://open.er-api.com/v6/latest/USD'
```

### 3. Indices + equities — Stooq (keyless CSV)
S&P 500 index (`^spx`), a few tickers; `f=` selects fields, `h` adds a header row:
```sh
curl -s -w '\n[HTTP %{http_code}]\n' 'https://stooq.com/q/l/?s=^spx,aapl.us,msft.us&f=sd2t2ohlcv&h&e=csv'
```
Expect CSV: `Symbol,Date,Time,Open,High,Low,Close,Volume` then a row per symbol. ✅ verified? ☐

### 4. Commodities — Stooq futures (keyless CSV)
Gold (`gc.f`), WTI crude (`cl.f`), silver (`si.f`):
```sh
curl -s -w '\n[HTTP %{http_code}]\n' 'https://stooq.com/q/l/?s=gc.f,cl.f,si.f&f=sd2t2ohlcv&h&e=csv'
```
Expect the same CSV shape as #3. ✅ verified? ☐

### 5. All-in-one fallback — Yahoo Finance unofficial (verify ToS before relying on it)
```sh
curl -s -A 'Mozilla/5.0' -w '\n[HTTP %{http_code}]\n' \
  'https://query1.finance.yahoo.com/v7/finance/quote?symbols=%5EGSPC,EURUSD=X,GC=F,BTC-USD'
```
Expect `{"quoteResponse":{"result":[{"symbol":"^GSPC","regularMarketPrice":...,"regularMarketChangePercent":...}]}}`.
Note if it requires a crumb/cookie (it sometimes does) — if so, this one's out. ✅ verified? ☐

---

## What I'll build once a stack is verified

- A new **Markets** module (4 registration points), egress-gated by `settings.markets.networkEnabled`
  (default off), with a refresh interval like GeoINT's.
- A normalized `MarketQuote { symbol, label, price, change, changePct, asOf, klass }` and one
  **adapter per verified provider** mapping its response → `MarketQuote[]`.
- Main-process fetch through the same SSRF-revalidating `safeFetch` pattern; a configurable
  watchlist (symbols per class) so the operator picks what to track.

## COULD NOT VERIFY / AVOID (here)
- Everything above is unverified from this environment (no network). Do not ship against any of it
  until the curl output confirms the endpoint, fields, and a non-403 status.
- Anything requiring login/cookies for the data itself, or whose ToS forbids non-commercial reuse,
  is out — flag it when you see the response/headers.
