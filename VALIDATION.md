# Validation

Every claim in the app, with the command that reproduces it. These numbers were measured on 2026-11-02 on an M1 MacBook Air. Run all the checks with:

```bash
bash train/validate.sh
```

## Ground truth

Tabs 05–07 use the **MoneyGuide engine** itself (`~/moneyguide/src`), bundled with esbuild into `web/js/vendor/`:

- `taxlaw.js` is `engine/tax.ts` + `law.ts`: 2026 federal law (IRS Rev. Proc. 2025-32, P.L. 119-21), plus 2025 law.
- `moneyguide.js` is `engine/sim.ts` + `data.ts`: the full planning engine (Monte Carlo, taxes, RMDs, IRMAA, Social Security).

That engine's own test suite checks it against IRS, SSA and CMS publications and against PolicyEngine-US (see `~/moneyguide/verify/README.md`). Glass Brain does not change it.

## Retirement Brain (tabs 01–04)

| Claim | Measured | How |
|---|---|---|
| Matches its Monte Carlo on unseen clients | **0.94 pts** mean absolute error, 4,000 clients × 1,024 lives | `python3 train/train.py` (final line) |
| Invented a withdrawal-rate neuron | layer 2 #17: correlation **−0.85** with withdrawal rate | `python3 train/probe.py` |
| "Paths to 90%" prescriptions are real | crash-on-day-one client: brain says spend $52k → simulator **89.9%**; 21% flexibility → **89.1%**; +$262k saved → **90.4%** | spot-checked against `web/js/sim.js` |
| All six surgery challenges are solvable | par solutions found by search or input pinning | `node train/solve_challenges.mjs <id>` |

Its world is a simple model: normal returns (stocks 6.5% ± 17%, bonds 1.8% ± 6.5% real) and Gompertz mortality.

## Tax Brain and the compiled tax network (tab 05)

| Claim | Measured | How |
|---|---|---|
| The compiled network equals the engine | **max error $0.000000 on 1,000,000 random returns**, for 2025 and 2026 law. 40 neurons, 93 weights, 8 layers | `node train/compile_check.mjs` |
| The 2025 → 2026 law change is a weight diff | **11 bias edits** | same |
| The trained brain fits the engine | **$46** mean error, $150 p95, on 50,000 held-out returns (96 hinges, 3M training returns) | `python3 train/taxtrain.py 96 40 3` |
| Its hinges land on the law's kinks | e.g. 24%→32% edge **$3** off, 32%→35% **$43**, 0% capital-gains ceiling **$52**, Social Security 85% zone **$809** | `node train/taxread.mjs` |
| The audit identifies which law a brain learned | our brain → "2026 law as enacted" (score 0.45 vs 0.18 for the runner-up); vendor brain trained without the OBBBA senior deduction → **correctly flagged** (0.39 vs −0.02) | `node train/audit.mjs` |
| Patching the trained brain for a law change works | switching to 2025 law: error $876 → **$126** after moving 25 hinge biases, no retraining | Tax tab → 2025 → "Patch the trained brain's hinges" |

Scope: married filing jointly, both 65+, federal income tax, with three income types (ordinary, Social Security, long-term gains and qualified dividends). The trained brain misses some small kinks that sit right next to larger ones, and the app's table shows each miss.

## Engine Brain (tab 06, and Book → MoneyGuide engine)

| Claim | Measured | How |
|---|---|---|
| Learned the planning engine | **0.91 pts** mean error, 2.0 p90, on 3,000 held-out plans (60,000 plans × 500 trials) | `node train/mgdata.mjs 60000 500` then `python3 train/mgtrain.py` |
| Live agreement in the browser | default household: brain **70%** vs engine **70%** | Engine tab |
| Book spot-check | **0.2 pts** average gap on 24 random households run through the real engine in the browser | Book → MoneyGuide engine |
| A dollar's worth by account | IRA $0.89 vs engine $0.88, taxable $0.99 vs $1.00 (default household); IRA $0.57 vs $0.58 (Chens, legacy basis) | Engine tab |
| Gentlest path to 85% is real | "Retiring at 62": 720 candidate plans searched on the brain in ~20–60 ms, best = spend $7k/yr less → brain **86%**, real engine **85%**. Chens: spend $9k/yr less → brain 85%, engine **84%** | Engine tab (the engine runs the chosen plan live) |
| Where it disagrees | Chens, taxable dollar: brain $0.83 vs engine $1.00. Shown in the app's table as it is | Engine tab → The Chens |
| Speed | about 50–120 µs per plan, against 35–190 ms for the engine: 800–3,000× faster | Engine tab |

## Roth Lab (tab 07)

| Claim | Measured | How |
|---|---|---|
| Gradients are exact | backprop through the compiled network matches finite differences to 3 decimals (−0.559 vs −0.559) | `node train/roth_check.mjs` |
| Beats the bracket rules (total = tax + IRMAA + heirs) | $2M IRA: **$464,590** vs $534,988 for the best rule. $900k IRA: **$115,431** vs $132,551. $4M IRA, 35% heirs: **$1,333,844** vs $1,854,286 | same |

Model: deterministic real growth, 2026 law held constant, no discounting, federal tax only, RMDs from 75 (Uniform Lifetime Table), and heirs taxed at a flat rate. IRMAA is counted in every total but is a staircase, so it isn't in the gradient.

## Money Finder (tab 08)

| Claim | Measured | How |
|---|---|---|
| Roth Autopilot is near-optimal | 400 held-out households: captures **98.6%** of the exact optimizer's lifetime savings in one pass (0.18 ms each). With 25 refinement steps, **103.1%** (2.4 ms) | `node train/roth_eval.mjs` |
| …and beats the rules of thumb | finds $20.7M more than the best fill-the-bracket rule across the 400 households, and beats that rule for 345 of 400 (refined: 364) | same |
| Gradients stay exact with spending draws | −0.305 vs −0.305 (finite difference) | `node train/roth_check.mjs` |
| β (FORM) agrees with simulation | importance sampling at the design point (2,000 paths) vs plain Monte Carlo (20,000): 17.5% ± 0.5 vs 17.3% · 16.4% ± 0.4 vs 16.3% · 48.2% ± 0.9 vs 48.9% · 4.1% ± 0.1 vs 4.4%. FORM's Φ(−β) runs low (first-order), and the app shows all three | `node train/stress_check.mjs` |
| Rare-event risk | "comfortable" couple: importance sampling (4,000 paths) **1 in 17,898**. Plain Monte Carlo needs 200,000 paths to see 9 failures (4.5 × 10⁻⁵) | see `stress_check.mjs` |
| History replay | real 1928–2025 returns and CPI from MoneyGuide's `history.ts`. β's projection rule matches the exact replay in 56–72 of 65–72 windows depending on the plan | same |

Stress model: a single portfolio (stocks and bonds at the family's mix), with withdrawals grossed up for federal tax using the compiled network. The pre-tax share is held constant. No guardrails. Normal shocks are calibrated to 1928–2025 real returns (S&P 8.6% ± 19.3%, Treasuries 1.8% ± 8.9%, correlation 0.09).

## Household X-ray and Book X-ray

| Claim | Measured | How |
|---|---|---|
| Every X-ray number is the engine's | the page calls the MoneyGuide engine (bundled as `web/js/vendor/planner.js`) in a worker; no surrogate | `node train/xray_check.mjs` prints the four families' headline numbers |
| Failed historical retirements fail in the first decade | all four families: failed start years averaged −2.5% to −3.1% a year after inflation in years 1–10, and earned more than the successful years after year 10 | same |
| The Book Brain matches the engine | **1.4 pts** mean error on 3,000 held-out households (1.4–1.8 across the seven scenarios); 90% within 3.9 pts, 99% within 15.6 | `python3 train/booktrain.py` (60,000 households from `train/bookdata.mjs`) |
| …on the demo book | 4,000 households at the plan date against the engine at 1,000 markets each | the trust panel on `book.html` computes it live |
| …after a crash | at S&P −34%: 1.5 pts mean, 90% within 4.4, worst 42 pts on 150 random households | spot checks on `book.html`; the worst misses gather among the biggest drops, so the page re-checks the top 16 red flags on the engine whenever the market pauses |

The Book Brain's market model moves only the stock share of each portfolio with the S&P; bonds and cash are held flat.
