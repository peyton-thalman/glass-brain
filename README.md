# Glass Brain

Neural networks for financial planning, with the glass taken off so you can watch them think. You can read what they learned, operate on them, audit them, and write one by hand from the tax code.

```bash
python3 serve.py        # → http://localhost:8787
```

No build step: it's plain HTML, CSS and JS modules in `web/`, deployed as a static site on Vercel (`vercel.json` serves `web/`). The front door (`web/index.html`, `js/home.js`) tells the story in plain words with live visuals: one family, an advisor's book, the whole firm. **Try it** (`try.html`, `js/try.js`) asks six short questions about a real family and runs the engine on them in the browser; "See the full X-ray" hands the answers to `household.html#mine` through sessionStorage. The tool pages are `household.html` (Family), `book.html` (Advisor), `firm.html` (Firm) and `lab.html` (How it works). The shared look lives in `ui.css` (tokens, nav, buttons), with `home.css`, `try.css`, `pages.css` and `lab-ui.css` per page.

The generated training datasets (`train/*.f32`, `*.npz`, `mg_data.json`, `roth_data.json`, `book_data*.json`) are not in git. Rebuild them with the data scripts in `train/` (`taxdata.mjs`, `sim.py`, `mgdata.mjs`, `rothdata.mjs`, `bookdata.mjs`) before retraining or running `train/validate.sh`.

## Household X-ray (`household.html`)

The front door. Pick one of four made-up households (the kind an advisor meets in a 55+ town outside Phoenix), edit anything about them, and the planning engine answers: what breaks this plan, why, and the gentlest fix.

- **Deep intake.** Ages and health for each spouse, Social Security already claimed or not, pensions with their survivor option (single-life, 50%, 75%, 100%), part-time work, every account type, the house and whether they'd downsize, everyday spending and what it drops to for a survivor, goals with end dates, gifts, legacy, all-in fees, and *what matters to them*: whether they could trim in a bad year, what they care about most, and their biggest worry.
- **What breaks it.** Every real start year since 1928 replayed, with real returns and inflation. For three of the four households (the Kowalskis, Joan, the Alvarezes) the failures share one cause: the failed retirements lost 2.5% to 3.1% a year after inflation in their first decade. The Hoffmans spend enough that a merely flat decade sinks them too: their failed start years still earned +0.3% a year in the first decade, against 6.2% when the plan worked. In all four, the failed retirements earned *more* after year ten than the ones that worked. The page says that in plain English and shows each year's path.
- **Life events.** A spouse dies at an age you choose, three years of care, a crash in years one and two, hotter inflation, the 2033 Social Security cut. Each card shows its effect alone, and toggling it re-runs the whole page. A death opens the **survivor's view**, which compares the last year together with the first year alone: which pension stops, which Social Security check goes, how much more comes out of savings, and the single filer's bracket.
- **The gentlest fix.** A greedy search over the moves this household said it could live with, weighted by their own answers, with every step checked on the engine. Guardrails come with their cost (how often a cut happens, how deep it goes).
- **Sensitivity** (one input changed at a time) and the **engine's own insights** (Roth, IRMAA, survivor bracket, Social Security timing).

Code: `web/js/household/` (`families.js` intake → Plan, `xray-core.js` analysis, `xray-worker.js` runs it off the main thread). The engine bundle is `web/js/vendor/planner.js`, rebuilt from `~/moneyguide/src` with `node train/vendor/build.mjs` (see Provenance below). `node train/xray_check.mjs` prints every headline number for the four families.

## Book X-ray (`book.html`)

The whole book, live. 4,000 households (the four named families plus 3,996 made up) sit in a grid, one cell each. Drag the S&P or replay a real episode (the 2020 crash, the 2022 bear market, the last 12 months, from FRED daily closes), and every household is re-scored every frame by the **Book Brain**.

- **The Book Brain** (`train/bookdata.mjs` → `train/booktrain.py` → `web/data/bookbrain.json`) is a 39 → 128 → 128 → 64 → 7 SiLU network. It reads a whole household: ages, health, Social Security claimed or not (a widow(er)'s survivor benefit on the late spouse's record included), pensions and their survivor share, every account, spending, goals, mix, fees, a long-term-care policy (daily benefit, years, inflation rider) and a planned downsizing. From that it gives the engine's probability of success under seven scenarios: as it is, either spouse dying, three years of care, another crash, the 2033 Social Security cut, and hotter inflation. The training labels come from the Household X-ray's own code on 75,000 made-up households at 400 markets each: 50,000 with a market move half the time (stocks, and bonds with the 10-year yield), plus 25,000 all after a move. Test error is 1.3 points (1.2–1.9 across the seven scenarios).
- **The watch list.** A smooth network can't fully learn a cliff edge: a plan with thin savings and income almost covering spending, where a small loss flips the answer from fine to failing. So `book.json` stores the engine's answer at two reference crashes, the page scores the same crashes with the brain, and the 125 households where they disagree by more than 10 points are re-run on the engine every time the market pauses. Across four other crashes that list holds 120 of the brain's 121 misses over 20 points and every one of the 43 red flags the brain alone would have hidden (`node train/watch_check.mjs`).
- A market move changes balances (the stock share of each portfolio moves with the S&P), and the brain re-scores. The market is not a separate input.
- **Red flags** list households that fell below 75%, and the life event that would hurt each one most. **Opportunities** list Roth conversion windows that open when stocks are down at least 10% (sized to fill the bracket and stay under IRMAA, from the engine's ledger), plus guardrail check-ins.
- **Every answer can be checked.** Click a household to see the brain's seven answers, what would move its plan most (realistic changes, each scored by the brain), and a button that re-runs all seven on the engine. Each pause in a replay re-checks the top 16 red flags and the whole watch list on the engine, so the list shows the engine's numbers, plus 12 random households. The trust panel shows test error, the gap on the whole book, and speed.
- **Story mode** on both pages drives a Loom-ready walkthrough: the Kowalskis' widow cliff, then the whole book through March 2020.
- **Meeting mode** (X-ray page) turns the screen toward the client: big type, "what if…" tiles they can tap, the survivor's monthly income in dollars, and what we could do about it. Esc to leave.
- **Review brief:** "Print review brief" on the X-ray prints a one-page client and pre-meeting brief.

## Firm X-ray (`firm.html`)

The executive view: 250 advisors in 10 regions, 400 made-up households each (100,000 in all), generated in the browser from a fixed seed inside the worker threads. One tile per advisor, colored by the share of their book below 75%. Replay the 2020 crash, the 2022 bear market or today, and the Book Brain re-scores the whole firm on each step. The page states how long the planning engine itself would need for the same re-score.

## What's new on the household page

- **Show the math:** the engine's year-by-year ledger, and each year's tax return line by line (taxable Social Security, deductions including the senior deduction, bracket and room left, Arizona tax, IRMAA tier), with what the engine is checked against.
- **Smart intake:** widowed households give the late spouse's details (the engine uses the larger of their own and the survivor benefit), a long-term-care section takes the policy's daily benefit, benefit years and inflation rider (netted out of a care event), and pension survivor options can be "not sure yet."
- **Ask these first:** every uncertain fact is scored on the engine at its plausible answers, and the intake lists the ones whose answer would move the plan most, with a meter for how much of what matters is confirmed.
- **Monday brief** (book page): this week's three calls with the reason and an opener, and the top Roth windows in dollars, printable.
- **Bonds and rates:** replays move bonds with the 10-year Treasury yield (FRED DGS10), and the book opens on Friday's close.

## Three brains

| Brain | Learned from | What it shows |
|---|---|---|
| **Retirement Brain** (tabs 01–04) | 102M simulated lives (a simple Monte Carlo) | Every neuron visible and named, with first-person explanations traced by activation patching, the training replay, weight-surgery challenges, and a 4,000-household book scored in about 20 ms |
| **Tax Brain** (tab 05) | 3M federal returns from the **planning engine** (2026 law, IRS Rev. Proc. 2025-32, P.L. 119-21) | The trained hinges land on the law's real bend points (24%→32% bracket: **$3–$273 off** across income mixes, 0% capital-gains ceiling: **$52 off**), plus a network **compiled from the statute by hand** that is exact |
| **Engine Brain** (tab 06) | 60k real plans run through the **planning engine** (taxes, RMDs, IRMAA, Social Security) | A full planning engine in microseconds, checked live against the real engine in the browser, and what a dollar is worth in an IRA vs. a Roth, read from its gradients |

## The flagship: Money Finder (tab 08)

An advisor's whole book (4,000 households) analyzed in about 10 seconds. Each family gets three things:

- **Roth Autopilot.** A *learned optimizer*. I solved 40,000 households exactly by gradient descent through the compiled tax code (`train/rothdata.mjs`, 294 s on 7 cores), then trained a network to output the optimal 17-year conversion schedule in one pass. On 400 held-out households it captures **98.6% of the exact optimizer's savings in 0.18 ms** (about 200× faster). With 25 refinement steps it reaches **103%**: the student beats its teacher, because the learned starting point lands in better optima than gradient descent from zero. Against the best fill-the-bracket rule it finds **$20.7M more across 400 families**.
- **Distance to ruin (β).** The Hasofer–Lind reliability index from structural engineering, applied to a retirement plan. HL-RF iteration (with the tax gross-up solved exactly by the compiled network) finds the *design point*: the most likely market, calibrated to real 1928–2025 returns, that empties the portfolio by 95. β is its length in standard deviations. **Importance sampling** at the design point measures the failure probability with 10× fewer paths than plain Monte Carlo, and can measure rare risks it can't see (1 in 17,898 from 4,000 paths).
- **Real history.** Every historical window since 1928 is replayed with actual returns and inflation, and projected onto the plan's breaking direction. The chart shows which real eras would have broken the plan, and the β line separates them. Stock-heavy plans break in the 1966 stagflation decade. Bond-heavy plans break in the 1940s inflation.

Click any family for its nightmare market, the history chart, the exact optimizer next to Autopilot, and a **call brief** ready to paste into notes.

## Eight tabs (`lab.html`, "How it works")

1. **Think:** the Retirement Brain thinking live, with first-person explanations traced by activation patching.
2. **Birth:** its whole training, replayed from random static to expert.
3. **Surgery:** six weight-editing challenges, each with a par from a real solver.
4. **Book:** 4,000 households scored at once. Its *planning engine* mode scores them with the Engine Brain, runs book-wide what-ifs (everyone delays Social Security, trims spending, takes more risk), gives each at-risk family its best single move, and spot-checks itself against the real engine (about 0.2–0.5 points average gap).
5. **Tax Code:** the trained Tax Brain, the compiled law network, Congress mode, hinge patching, and the vendor-model audit.
6. **Engine:** the Engine Brain against the live planning engine: claim-age and spending curves, what a dollar is worth by account type, and the *gentlest path to 85%*. It searches hundreds of plan variations on the brain in milliseconds, then the real engine confirms the winner.
7. **Roth Lab:** gradient descent through the compiled tax code to find a multi-year conversion schedule, compared against the fill-the-bracket rules.
8. **Money Finder:** see above.

## The headline results

- **Tax law → neural network compiler** (`web/js/compile.js`). The 2026 federal income tax for a 65+ married couple, written by hand as a **40-neuron, 8-layer ReLU network** with no training. Every neuron is one clause: the IRC §86 provisional-income tests, the Pub 915 worksheet, the OBBBA senior deduction phase-out, the brackets, capital-gains stacking and the §1411 NIIT. Verified against the planning engine on **1,000,000 random returns: max error $0.00**, for both 2025 and 2026 law (`node train/compile_check.mjs`).
- **A law change is a weight diff.** The whole 2025 → 2026 update compiles to exactly **11 bias edits**. In tab 05 you can be Congress: move a bracket, the deduction, or the never-indexed 1993 Social Security threshold, and watch the weights change. You can then **patch the trained brain** by moving its hinge biases instead of retraining it.
- **The trained Tax Brain rediscovered the law.** It's a single layer of 96 ReLU hinges trained on the tax and its slope (Sobolev training). Each hinge's bend point can be read straight from its weights in dollars, and most land on real kinks in the law. It also found the **tax torpedo**, where an extra $1 of IRA income is taxed at 22% in the 10% bracket, without being told about Social Security taxation.
- **Model audit from the weights.** A "vendor" brain trained on software that missed the OBBBA senior deduction is caught by comparing its hinges to four candidate versions of the law. The audit names the bug without running the model on any client.
- **Roth conversions by gradient descent.** Lifetime tax is differentiable once the tax code is a network: backprop through the compiled net gives each year's exact marginal rate (it matches finite differences to 3 decimals), and an adjoint carries future RMD and heir taxes back in time. For a $2M-IRA couple it beats the best fill-the-bracket rule by about $70k. For a $4M IRA with 35% heirs, the gap is about $520k (`node train/roth_check.mjs`). The model is deliberately simple: deterministic growth, 2026 law held constant, no discounting, and IRMAA counted but not in the gradient.
- **The Engine Brain** reproduces the engine's probability of success in microseconds instead of tens of milliseconds, and its gradients answer the asset-location question: what a dollar in a traditional IRA is worth next to a Roth dollar for this specific couple.

## Provenance

Every brain is only as good as the engine that labeled it, so each one records which engine it learned from. `node train/vendor/build.mjs` bundles the engine and writes `web/js/vendor/engine.json` with a fingerprint (sha256) of exactly the source files the bundles include. Every data script stamps that fingerprint into what it writes, and every training script carries it into the brain. `node train/provenance.mjs` (the first step of `train/validate.sh`) fails when:

- `~/moneyguide/src` has changed since the bundles were built (rebuild them),
- any brain or precomputed number in `web/data/` was labeled by a different build than the site runs (it prints the command that rebuilds it), or
- the Book Brain was trained on a different list of household facts than `book-model.js` encodes.

The pages run the last two checks as they load each brain and show an "Out of date" banner instead of quietly disagreeing with the engine.

## Layout

```
serve.py                    no-cache static server
train/sim.py, train.py      Retirement Brain: GPU Monte Carlo (PyTorch/MPS) → 8→24→24→12→3 MLP with 57 training snapshots
train/probe.py              reads every neuron (firing, concept correlations, vote, share of each instinct)
train/solve_challenges.mjs  greedy solver that proves the surgery challenges are solvable
train/taxdata.mjs           3M returns from the planning engine (and a buggy variant for the audit)
train/taxtrain.py           Tax Brain: 96 hinges, Sobolev-trained on tax + marginal rate
train/taxread.mjs           law kinks vs brain hinges, printed
train/audit.mjs             audit both tax brains against four candidate laws
train/compile_check.mjs     compiled network vs engine on 1M returns, plus the 2025→2026 weight diff
train/mgdata.mjs            60k plans through the planning engine on 7 worker threads
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
web/js/vendor/              planner.js, moneyguide.js, taxlaw.js: the planning engine, bundled from ~/moneyguide/src (do not edit)
                            engine.json: the fingerprint of the engine source they were built from
train/vendor/build.mjs      rebuilds all three bundles and engine.json; --check compares them with ~/moneyguide/src
train/engine.mjs            the current engine fingerprint, stamped into every dataset the engine labels
train/bookbrain_check.mjs   the Book Brain vs the engine on new widow(er)s, care-policy holders and downsizers
train/watch_check.mjs       does the Book page's watch list catch the brain's big misses?
train/provenance.mjs        is every brain still the current engine's answer? (first step of validate.sh)
web/js/provenance.js        the same check in the browser: an "Out of date" banner when a brain doesn't match
web/js/compile.js           the tax-law compiler
web/js/taxread.js           law kink finder, hinge reader, kink matcher, auditor
```

## Honest caveats

- The Retirement Brain's world (tabs 01–04) is a deliberately simple market and mortality model. Tabs 05–06 use the planning engine.
- The Tax Brain covers federal income tax for a married couple, both 65+, filing jointly, with three income types and no state tax. The compiled network is exact within that scope.
- Small law kinks that sit right next to bigger ones (the 22→24% edge beside the senior-deduction phase-out) aren't always resolved by the trained brain. The table shows those misses honestly.
- Guardrails change what "success" means: a plan that cuts spending in a bad year instead of running out counts as a success. That's why agreeing to guardrails is so often the gentlest fix (the Hoffmans go from 49% to 92% on it alone). The fix card shows the price, how often a cut comes and how deep it goes, and that price belongs in the conversation, not just the percentage.
- The Book Brain is a fast preview of the engine, not a replacement: it reads 39 facts, while the X-ray's engine run sees everything the intake collects. Its biggest misses gather after the largest market drops, which is why the engine re-checks the top red flags.
- Everything here is education and decision support, not advice.
