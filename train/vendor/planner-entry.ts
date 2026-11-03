// Entry for web/js/vendor/planner.js: the MoneyGuide engine plus its analysis layer.
// Built by train/vendor/build.sh from ~/moneyguide/src. The Household X-ray runs on this.
export { simulate, probability, people, fullRetirementAge, START_YEAR } from '../../../../moneyguide/src/engine/sim';
export { normalizePlan, sampleHouseholds, PORTFOLIOS } from '../../../../moneyguide/src/data';
export { STRESS_TESTS, sensitivity, suggestScenario, describeChanges, maxSpending, ssStrategies, rothStrategies, insuranceGaps, clone } from '../../../../moneyguide/src/engine/analysis';
export { buildInsights, applyAction } from '../../../../moneyguide/src/engine/insights';
export { HISTORY } from '../../../../moneyguide/src/engine/history';
export { historicalReturn, MODEL_PORTFOLIOS, PORTFOLIO_STATS } from '../../../../moneyguide/src/engine/cma';
