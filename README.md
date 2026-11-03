# Glass Brain

Neural networks for financial planning, with the glass taken off so you can watch them think. You can read what they learned, operate on them, audit them, and write one by hand from the tax code.

```bash
python3 serve.py        # → http://localhost:8787
```

No build step: it's plain HTML, CSS and JS modules in `web/`, deployed as a static site on Vercel (`vercel.json` serves `web/`). Press **▶ Tour** for a 60-second self-driving walkthrough.

The generated training datasets (`train/*.f32`, `*.npz`, `mg_data.json`, `roth_data.json`) are not in git. Rebuild them with the data scripts in `train/` (`taxdata.mjs`, `sim.py`, `mgdata.mjs`, `rothdata.mjs`) before retraining or running `train/validate.sh`.

## Three brains

| Brain | Learned from | What it shows |
|---|---|---|
| **Retirement Brain** (tabs 01–04) | 102M simulated lives (a simple Monte Carlo) | Every neuron visible and named, with first-person explanations traced by activation patching, the training replay, weight-surgery challenges, and a 4,000-household book scored in about 20 ms |
| **Tax Brain** (tab 05) | 3M federal returns from the **MoneyGuide engine** (2026 law, IRS Rev. Proc. 2025-32, P.L. 119-21) | The trained hinges land on the law's real bend points (24%→32% bracket: **$3 off**, 0% capital-gains ceiling: **$52 off**), plus a network **compiled from the statute by hand** that is exact |
| **Engine Brain** (tab 06) | 60k real plans run through the **MoneyGuide planning engine** (taxes, RMDs, IRMAA, Social Security) | A full planning engine in microseconds, checked live against the real engine in the browser, and what a dollar is worth in an IRA vs. a Roth, read from its gradients |

## The flagship: Money Finder (tab 08)

An advisor's whole book (4,000 households) analyzed in about 10 seconds. Each family gets three things:

- **Roth Autopilot.** A *learned optimizer*. I solved 40,000 households exactly by gradient descent through the compiled tax code (`train/rothdata.mjs`, 294 s on 7 cores), then trained a network to output the optimal 17-year conversion schedule in one pass. On 400 held-out households it captures **98.6% of the exact optimizer's savings in 0.18 ms** (about 200× faster). With 25 refinement steps it reaches **103%**: the student beats its teacher, because the learned starting point lands in better optima than gradient descent from zero. Against the best fill-the-bracket rule it finds **$20.7M more across 400 families**.
- **Distance to ruin (β).** The Hasofer–Lind reliability index from structural engineering, applied to a retirement plan. HL-RF iteration (with the tax gross-up solved exactly by the compiled network) finds the *design point*: the most likely market, calibrated to real 1928–2025 returns, that empties the portfolio by 95. β is its length in standard deviations. **Importance sampling** at the design point measures the failure probability with 10× fewer paths than plain Monte Carlo, and can measure rare risks it can't see (1 in 17,898 from 4,000 paths).
- **Real history.** Every historical window since 1928 is replayed with actual returns and inflation, and projected onto the plan's breaking direction. The chart shows which real eras would have broken the plan, and the β line separates them. Stock-heavy plans break in the 1966 stagflation decade. Bond-heavy plans break in the 1940s inflation.

Click any family for its nightmare market, the history chart, the exact optimizer next to Autopilot, and a **call brief** ready to paste into notes.

## Eight tabs

1. **Think:** the Retirement Brain thinking live, with first-person explanations traced by activation patching.
2. **Birth:** its whole training, replayed from random static to expert.
3. **Surgery:** six weight-editing challenges, each with a par from a real solver.
4. **Book:** 4,000 households scored at once. Its *MoneyGuide engine* mode scores them with the Engine Brain, runs book-wide what-ifs (everyone delays Social Security, trims spending, takes more risk), gives each at-risk family its best single move, and spot-checks itself against the real engine (about 0.2–0.5 points average gap).
5. **Tax Code:** the trained Tax Brain, the compiled law network, Congress mode, hinge patching, and the vendor-model audit.
6. **Engine:** the Engine Brain against the live MoneyGuide engine: claim-age and spending curves, what a dollar is worth by account type, and the *gentlest path to 85%*. It searches hundreds of plan variations on the brain in milliseconds, then the real engine confirms the winner.
7. **Roth Lab:** gradient descent through the compiled tax code to find a multi-year conversion schedule, compared against the fill-the-bracket rules.
8. **Money Finder:** see above.

## The headline results

- **Tax law → neural network compiler** (`web/js/compile.js`). The 2026 federal income tax for a 65+ married couple, written by hand as a **40-neuron, 8-layer ReLU network** with no training. Every neuron is one clause: the IRC §86 provisional-income tests, the Pub 915 worksheet, the OBBBA senior deduction phase-out, the brackets, capital-gains stacking and the §1411 NIIT. Verified against the MoneyGuide engine on **1,000,000 random returns: max error $0.00**, for both 2025 and 2026 law (`node train/compile_check.mjs`).
- **A law change is a weight diff.** The whole 2025 → 2026 update compiles to exactly **11 bias edits**. In tab 05 you can be Congress: move a bracket, the deduction, or the never-indexed 1993 Social Security threshold, and watch the weights change. You can then **patch the trained brain** by moving its hinge biases instead of retraining it.
- **The trained Tax Brain rediscovered the law.** It's a single layer of 96 ReLU hinges trained on the tax and its slope (Sobolev training). Each hinge's bend point can be read straight from its weights in dollars, and most land on real kinks in the law. It also found the **tax torpedo**, where an extra $1 of IRA income is taxed at 22% in the 10% bracket, without being told about Social Security taxation.
- **Model audit from the weights.** A "vendor" brain trained on software that missed the OBBBA senior deduction is caught by comparing its hinges to four candidate versions of the law. The audit names the bug without running the model on any client.
- **Roth conversions by gradient descent.** Lifetime tax is differentiable once the tax code is a network: backprop through the compiled net gives each year's exact marginal rate (it matches finite differences to 3 decimals), and an adjoint carries future RMD and heir taxes back in time. For a $2M-IRA couple it beats the best fill-the-bracket rule by about $70k. For a $4M IRA with 35% heirs, the gap is about $520k (`node train/roth_check.mjs`). The model is deliberately simple: deterministic growth, 2026 law held constant, no discounting, and IRMAA counted but not in the gradient.
- **The Engine Brain** reproduces MoneyGuide's probability of success in microseconds instead of tens of milliseconds, and its gradients answer the asset-location question: what a dollar in a traditional IRA is worth next to a Roth dollar for this specific couple.

## Layout

```
serve.py                    no-cache static server
train/sim.py, train.py      Retirement Brain: GPU Monte Carlo (PyTorch/MPS) → 8→24→24→12→3 MLP with 57 training snapshots
train/probe.py              reads every neuron (firing, concept correlations, vote, share of each instinct)
train/solve_challenges.mjs  greedy solver that proves the surgery challenges are solvable
train/taxdata.mjs           3M returns from the MoneyGuide tax engine (and a buggy variant for the audit)
train/taxtrain.py           Tax Brain: 96 hinges, Sobolev-trained on tax + marginal rate
train/taxread.mjs           law kinks vs brain hinges, printed
train/audit.mjs             audit both tax brains against four candidate laws
train/compile_check.mjs     compiled network vs engine on 1M returns, plus the 2025→2026 weight diff
train/mgdata.mjs            60k plans through the real MoneyGuide engine on 7 worker threads
train/mgtrain.py            Engine Brain: 10→64→64→32→2 SiLU network (0.9 pts test error)
train/roth_check.mjs        gradient check + gradient-descent Roth schedules vs the bracket rules
web/js/roth.js              unrolled retirement, backprop through the tax network, adjoint, optimizer
train/rothdata.mjs          40,000 exact Roth optima (gradient descent through the tax network) on worker threads
train/rothtrain.py          Roth Autopilot: 7→160→160→96→17 network that outputs the schedule
train/roth_eval.mjs         Autopilot judged in exact lifetime dollars on held-out households
train/stress_check.mjs      β (FORM) vs importance sampling vs Monte Carlo vs real history
web/js/stress.js            HL-RF design point, FORM, importance sampling, historical replay and projection
web/js/finder.js            the Money Finder tab
web/data/history.json       1928–2025 real returns (Damodaran S&P 500 and 10-yr Treasury, deflated by CPI-U), from ~/moneyguide
web/js/vendor/              taxlaw.js and moneyguide.js, bundled with esbuild from ~/moneyguide/src (do not edit)
web/js/compile.js           the tax-law compiler
web/js/taxread.js           law kink finder, hinge reader, kink matcher, auditor
```

## Honest caveats

- The Retirement Brain's world (tabs 01–04) is a deliberately simple market and mortality model. Tabs 05–06 use the real MoneyGuide engine.
- The Tax Brain covers federal income tax for a married couple, both 65+, filing jointly, with three income types and no state tax. The compiled network is exact within that scope.
- Small law kinks that sit right next to bigger ones (the 22→24% edge beside the senior-deduction phase-out) aren't always resolved by the trained brain. The table shows those misses honestly.
- Everything here is education and decision support, not advice.
