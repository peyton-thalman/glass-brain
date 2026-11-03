#!/usr/bin/env bash
# Re-run the fast checks behind VALIDATION.md (no retraining). About a minute.
set -e
cd "$(dirname "$0")/.."
echo "== compiled tax network vs planning engine (1M returns × 2 laws)"; node train/compile_check.mjs
echo; echo "== trained Tax Brain: law kinks vs hinges"; node train/taxread.mjs
echo; echo "== audit: which law did each brain learn?"; node train/audit.mjs
echo; echo "== Roth Lab: gradient check and schedules"; node train/roth_check.mjs
echo; echo "== reliability index: FORM vs importance sampling vs Monte Carlo vs history"; node train/stress_check.mjs
if [ -f train/roth_data.json ]; then echo; echo "== Roth Autopilot vs exact optimizer (held-out)"; node train/roth_eval.mjs; fi
