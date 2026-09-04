# Calibration report

Generated 2026-09-04 · engine `v2` · scorer `v1`

Window: **2023-01-01 → present** · 17 equities · 3474 events across 2547 active instrument-days

## The number being tuned

**1.49 surfaced instrument-days per name per month** (target 1–2) — within budget

For the reference user (17 names, ~8.7 visits/month) that is **2.9 items in a typical brief**, against an attention budget of 5.

The unit is an instrument-DAY, not an event: a day on which three
detectors fire on one name is a single interruption, not three.
"Surfaced" means the day reached CRITICAL, IMPORTANT or WATCH. INFO and
NOISE days are stored but never shown, so they spend no attention.

The target is an attention budget rather than an accuracy figure. A
watchlist that interrupts someone twenty times a month is one they stop
opening, regardless of how correct each alert was.

## Severity distribution

| Severity | Instrument-days | Share |
|---|---:|---:|
| CRITICAL | 28 | 1.1% |
| IMPORTANT | 173 | 6.8% |
| WATCH | 914 | 35.9% |
| INFO | 639 | 25.1% |
| NOISE | 793 | 31.1% |

## By detector

| Detector | Fired | On a surfaced day | Share |
|---|---:|---:|---:|
| `range_break` | 888 | 292 | 32.9% |
| `sector_divergence` | 765 | 530 | 69.3% |
| `quiet_regime` | 647 | 300 | 46.4% |
| `volume_spike` | 438 | 430 | 98.2% |
| `move_since_last_seen` | 370 | 343 | 92.7% |
| `correlation_break` | 236 | 42 | 17.8% |
| `vol_regime_shift` | 130 | 33 | 25.4% |

## Follow-through (precision proxy)

Share of surfaced events followed by a ≥1.5σ move within 3 sessions:

- **surfaced events: 21.0%** (234/1114)
- every session, as a baseline: 15.3% (2385/15606)

Lift over "look every day": **1.37×**

This is a proxy, not ground truth — nobody labelled these events, and
"did the user care?" cannot be measured before the product has users.
What it does test is whether an alert carried information about the
near future rather than restating noise that had already passed. A lift
at or below 1.0 would mean the engine is no better than looking daily.

## Per symbol

| Symbol | Events | Active days | Surfaced days | Per month |
|---|---:|---:|---:|---:|
| AAPL | 234 | 166 | 80 | 1.82 |
| AVGO | 207 | 147 | 78 | 1.77 |
| QCOM | 201 | 148 | 76 | 1.73 |
| NFLX | 209 | 154 | 73 | 1.66 |
| ADBE | 230 | 165 | 72 | 1.64 |
| PLTR | 224 | 165 | 70 | 1.59 |
| MU | 194 | 144 | 67 | 1.52 |
| ORCL | 249 | 174 | 67 | 1.52 |
| CRM | 228 | 162 | 67 | 1.52 |
| INTC | 199 | 137 | 64 | 1.45 |
| META | 200 | 151 | 62 | 1.41 |
| GOOGL | 191 | 145 | 60 | 1.36 |
| AMD | 214 | 151 | 59 | 1.34 |
| AMZN | 179 | 128 | 58 | 1.32 |
| MSFT | 188 | 146 | 56 | 1.27 |
| NVDA | 167 | 138 | 55 | 1.25 |
| TSLA | 160 | 126 | 51 | 1.16 |

## Parameters in force

```
detector thresholds
  moveSigmas                       2.5
  rvol                             2.5
  sectorDivergenceZ                2
  sectorDivergenceMinVolFraction   0.5
  rangeBreakAtr                    0.5
  volRegimeRatio                   2
  earningsHours                    48
  corrBreakBaseline                0.6
  corrBreakDrop                    0.45
  quietPercentile                  0.05
  quietContraction                 0.6

scorer family weights
  event                            0.28
  relative                         0.24
  price                            0.22
  volume                           0.14
  volatility                       0.12
```

## Known limitation

The `earnings_upcoming` detector is absent from these numbers. The free
Finnhub tier serves forward-looking earnings dates only — historical
windows return zero rows — so there is no historical calendar to
calibrate against. That detector is live-only, and its contribution to
the attention budget is therefore not measured here.
