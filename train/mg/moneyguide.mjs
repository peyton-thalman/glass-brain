// src/engine/cma.ts
var ASSETS = ["cash", "bonds", "usLarge", "usSmall", "intl", "emerging", "reits"];
var ASSET_INFO = {
  cash: { name: "Cash", ret: 0.032, sd: 0.01, color: "#94a3b8", yield: 0.032 },
  bonds: { name: "U.S. Bonds", ret: 0.048, sd: 0.055, color: "#60a5fa", yield: 0.042 },
  usLarge: { name: "U.S. Large Cap", ret: 0.08, sd: 0.165, color: "#1e3a8a", yield: 0.013 },
  usSmall: { name: "U.S. Small Cap", ret: 0.088, sd: 0.21, color: "#3b5bdb", yield: 0.012 },
  intl: { name: "Int\u2019l Developed", ret: 0.086, sd: 0.18, color: "#0d9488", yield: 0.029 },
  emerging: { name: "Emerging Markets", ret: 0.094, sd: 0.23, color: "#14b8a6", yield: 0.026 },
  reits: { name: "Real Estate (REITs)", ret: 0.08, sd: 0.2, color: "#a78bfa", yield: 0.035 }
};
var CORR = [
  [1, 0.1, 0, 0, 0, 0, 0],
  [0.1, 1, 0.15, 0.05, 0.15, 0.1, 0.25],
  [0, 0.15, 1, 0.85, 0.8, 0.7, 0.7],
  [0, 0.05, 0.85, 1, 0.7, 0.65, 0.7],
  [0, 0.15, 0.8, 0.7, 1, 0.8, 0.6],
  [0, 0.1, 0.7, 0.65, 0.8, 1, 0.55],
  [0, 0.25, 0.7, 0.7, 0.6, 0.55, 1]
];
var w = (cash, bonds, usLarge, usSmall, intl, emerging, reits) => ({
  cash: cash / 100,
  bonds: bonds / 100,
  usLarge: usLarge / 100,
  usSmall: usSmall / 100,
  intl: intl / 100,
  emerging: emerging / 100,
  reits: reits / 100
});
var MODEL_PORTFOLIOS = [
  { name: "Cash", short: "Cash", weights: w(100, 0, 0, 0, 0, 0, 0) },
  { name: "Conservative", short: "Cons", weights: w(10, 65, 13, 2, 7, 2, 1) },
  { name: "Moderately Conservative", short: "Mod Cons", weights: w(5, 52, 22, 3, 11, 4, 3) },
  { name: "Moderate", short: "Mod", weights: w(3, 37, 30, 5, 15, 5, 5) },
  { name: "Moderately Aggressive", short: "Mod Agg", weights: w(2, 23, 38, 6, 19, 6, 6) },
  { name: "Aggressive", short: "Agg", weights: w(1, 11, 46, 7, 23, 7, 5) },
  { name: "All Equity", short: "Equity", weights: w(0, 0, 52, 8, 27, 8, 5) }
];
function portfolioStats(weights) {
  let ret = 0, variance = 0, yld = 0;
  ASSETS.forEach((a, i) => {
    ret += weights[a] * ASSET_INFO[a].ret;
    yld += weights[a] * ASSET_INFO[a].yield;
    ASSETS.forEach((b, j) => {
      variance += weights[a] * weights[b] * ASSET_INFO[a].sd * ASSET_INFO[b].sd * CORR[i][j];
    });
  });
  const equity = weights.usLarge + weights.usSmall + weights.intl + weights.emerging + weights.reits;
  return { ret, sd: Math.sqrt(variance), yield: yld, equity };
}
var PORTFOLIO_STATS = MODEL_PORTFOLIOS.map((p) => portfolioStats(p.weights));
function historicalReturn(row, weights) {
  const [, sp, small, bill, bond, baa] = row;
  return weights.cash * bill + weights.bonds * (0.7 * bond + 0.3 * baa) + weights.usLarge * sp + weights.usSmall * (0.5 * sp + 0.5 * small) + (weights.intl + weights.emerging + weights.reits) * sp;
}

// src/engine/history.ts
var HISTORY = [
  [1928, 0.4381, 0.6215, 0.0308, 84e-4, 0.0322, -0.01156],
  [1929, -0.083, -0.4608, 0.0316, 0.042, 0.0302, 585e-5],
  [1930, -0.2512, -0.4835, 0.0455, 0.0454, 54e-4, -0.06395],
  [1931, -0.4384, -0.4362, 0.0231, -0.0256, -0.1568, -0.09317],
  [1932, -0.0864, 0.2865, 0.0107, 0.0879, 0.2359, -0.10274],
  [1933, 0.4998, 1.466, 96e-4, 0.0186, 0.1297, 763e-5],
  [1934, -0.0119, 0.2307, 28e-4, 0.0796, 0.1882, 0.01515],
  [1935, 0.4674, 0.549, 17e-4, 0.0447, 0.1331, 0.02985],
  [1936, 0.3194, 0.9641, 17e-4, 0.0502, 0.1138, 0.01449],
  [1937, -0.3534, -0.5394, 28e-4, 0.0138, -0.0442, 0.02857],
  [1938, 0.2928, 0.0516, 7e-4, 0.0421, 0.0924, -0.02778],
  [1939, -0.011, -0.0486, 5e-4, 0.0441, 0.0798, 0],
  [1940, -0.1067, -0.3288, 4e-4, 0.054, 0.0865, 714e-5],
  [1941, -0.1277, -0.0675, 13e-4, -0.0202, 0.0501, 0.09929],
  [1942, 0.1917, 0.6301, 34e-4, 0.0229, 0.0518, 0.09032],
  [1943, 0.2506, 1.4302, 38e-4, 0.0249, 0.0804, 0.02959],
  [1944, 0.1903, 0.7115, 38e-4, 0.0258, 0.0657, 0.02299],
  [1945, 0.3582, 0.9441, 38e-4, 0.038, 0.068, 0.02247],
  [1946, -0.0843, -0.1373, 38e-4, 0.0313, 0.0251, 0.18132],
  [1947, 0.052, -0.0174, 6e-3, 92e-4, 26e-4, 0.08837],
  [1948, 0.057, -1e-4, 0.0105, 0.0195, 0.0344, 0.02991],
  [1949, 0.183, 0.276, 0.0112, 0.0466, 0.0538, -0.02075],
  [1950, 0.3081, 0.5281, 0.012, 43e-4, 0.0424, 0.05932],
  [1951, 0.2368, 0.0387, 0.0152, -3e-3, -19e-4, 0.06],
  [1952, 0.1815, 0.0102, 0.0172, 0.0227, 0.0444, 755e-5],
  [1953, -0.0121, -0.0597, 0.0189, 0.0414, 0.0162, 749e-5],
  [1954, 0.5256, 0.6497, 94e-4, 0.0329, 0.0616, -743e-5],
  [1955, 0.326, 0.2672, 0.0172, -0.0134, 0.0204, 375e-5],
  [1956, 0.0744, -89e-4, 0.0262, -0.0226, -0.0235, 0.02985],
  [1957, -0.1046, -0.1519, 0.0322, 0.068, -72e-4, 0.02899],
  [1958, 0.4372, 0.688, 0.0177, -0.021, 0.0643, 0.01761],
  [1959, 0.1206, 0.127, 0.0339, -0.0265, 0.0157, 0.0173],
  [1960, 34e-4, -0.0357, 0.0287, 0.1164, 0.0666, 0.01361],
  [1961, 0.2664, 0.2945, 0.0235, 0.0206, 0.051, 671e-5],
  [1962, -0.0881, -0.0978, 0.0277, 0.0569, 0.065, 0.01333],
  [1963, 0.2261, 0.1965, 0.0316, 0.0168, 0.0546, 0.01645],
  [1964, 0.1642, 0.2325, 0.0355, 0.0373, 0.0516, 971e-5],
  [1965, 0.124, 0.4524, 0.0395, 72e-4, 0.0319, 0.01923],
  [1966, -0.0997, -0.0947, 0.0486, 0.0291, -0.0345, 0.03459],
  [1967, 0.238, 1.1587, 0.0429, -0.0158, 9e-3, 0.0304],
  [1968, 0.1081, 0.6069, 0.0534, 0.0327, 0.0485, 0.0472],
  [1969, -0.0824, -0.3295, 0.0667, -0.0501, -0.0203, 0.06197],
  [1970, 0.0356, -0.1878, 0.0639, 0.1675, 0.0565, 0.0557],
  [1971, 0.1422, 0.1596, 0.0433, 0.0979, 0.14, 0.03266],
  [1972, 0.1876, 16e-4, 0.0406, 0.0282, 0.1141, 0.03406],
  [1973, -0.1431, -0.388, 0.0704, 0.0366, 0.0432, 0.08706],
  [1974, -0.259, -0.269, 0.0785, 0.0199, -0.0438, 0.12338],
  [1975, 0.37, 0.5968, 0.0579, 0.0361, 0.1105, 0.06936],
  [1976, 0.2383, 0.4862, 0.0498, 0.1598, 0.1975, 0.04865],
  [1977, -0.0698, 0.3029, 0.0526, 0.0129, 0.0995, 0.06701],
  [1978, 0.0651, 0.2889, 0.0718, -78e-4, 0.0314, 0.09018],
  [1979, 0.1852, 0.4169, 0.1005, 67e-4, -0.0201, 0.13294],
  [1980, 0.3174, 0.4192, 0.1139, -0.0299, -0.0332, 0.12516],
  [1981, -0.047, -0.0429, 0.1404, 0.082, 0.0846, 0.08922],
  [1982, 0.2042, 0.2685, 0.1109, 0.3281, 0.2905, 0.0383],
  [1983, 0.2234, 0.3486, 0.0895, 0.032, 0.1619, 0.03791],
  [1984, 0.0615, -0.145, 0.0992, 0.1373, 0.1562, 0.03949],
  [1985, 0.3124, 0.2451, 0.0772, 0.2571, 0.2386, 0.03799],
  [1986, 0.1849, 0.0209, 0.0615, 0.2428, 0.2215, 0.01098],
  [1987, 0.0581, -0.14, 0.0596, -0.0496, 0.0112, 0.04434],
  [1988, 0.1654, 0.1715, 0.0689, 0.0822, 0.1568, 0.04419],
  [1989, 0.3148, 0.0696, 0.0839, 0.1769, 0.1631, 0.04647],
  [1990, -0.0306, -0.2777, 0.0775, 0.0624, 0.0565, 0.06106],
  [1991, 0.3023, 0.4607, 0.0554, 0.15, 0.164, 0.03064],
  [1992, 0.0749, 0.2534, 0.0351, 0.0936, 0.1368, 0.02901],
  [1993, 0.0997, 0.2556, 0.0307, 0.1421, 0.1644, 0.02748],
  [1994, 0.0133, -0.0476, 0.0437, -0.0804, -0.0123, 0.02675],
  [1995, 0.372, 0.3212, 0.0566, 0.2348, 0.2009, 0.02538],
  [1996, 0.2268, 0.1479, 0.0515, 0.0143, 0.0528, 0.03322],
  [1997, 0.331, 0.2206, 0.052, 0.0994, 0.113, 0.01702],
  [1998, 0.2834, -0.1347, 0.0491, 0.1492, 0.081, 0.01612],
  [1999, 0.2089, 0.3771, 0.0478, -0.0825, 97e-4, 0.02685],
  [2e3, -0.0903, -0.0913, 0.06, 0.1666, 0.0938, 0.03387],
  [2001, -0.1185, 0.3214, 0.0348, 0.0557, 0.086, 0.01552],
  [2002, -0.2197, -0.0361, 0.0164, 0.1512, 0.1206, 0.02377],
  [2003, 0.2836, 0.9123, 0.0103, 38e-4, 0.1238, 0.01879],
  [2004, 0.1074, 0.173, 0.014, 0.0449, 0.1033, 0.03256],
  [2005, 0.0483, 0.0378, 0.0322, 0.0287, 0.0513, 0.03416],
  [2006, 0.1561, 0.184, 0.0485, 0.0196, 0.0527, 0.02541],
  [2007, 0.0548, -0.0911, 0.0448, 0.1021, 0.049, 0.04081],
  [2008, -0.3655, -0.4468, 0.014, 0.201, -0.0344, 91e-5],
  [2009, 0.2594, 0.4694, 15e-4, -0.1112, 0.1996, 0.02721],
  [2010, 0.1482, 0.2773, 14e-4, 0.0846, 0.094, 0.01496],
  [2011, 0.021, -0.1404, 5e-4, 0.1604, 0.1226, 0.02962],
  [2012, 0.1589, 0.1896, 9e-4, 0.0297, 0.094, 0.01741],
  [2013, 0.3215, 0.503, 6e-4, -0.091, -0.0113, 0.01502],
  [2014, 0.1352, 0.0153, 3e-4, 0.1075, 0.1075, 756e-5],
  [2015, 0.0138, -0.0912, 5e-4, 0.0128, -0.015, 73e-4],
  [2016, 0.1177, 0.1702, 32e-4, 69e-4, 0.1152, 0.02075],
  [2017, 0.2161, 0.1513, 95e-4, 0.028, 0.0915, 0.02109],
  [2018, -0.0423, -0.1621, 0.0197, -2e-4, -0.0318, 0.0191],
  [2019, 0.3121, 0.1192, 0.0211, 0.0964, 0.1525, 0.02285],
  [2020, 0.1802, 0.3416, 36e-4, 0.1133, 0.106, 0.01362],
  [2021, 0.2847, 0.2241, 4e-4, -0.0442, 0.0102, 0.07036],
  [2022, -0.1804, -0.229, 0.0209, -0.1783, -0.1523, 0.06454],
  [2023, 0.2606, 0.0519, 0.0528, 0.0388, 0.0874, 0.03352],
  [2024, 0.2488, 0.087, 0.0518, -0.0164, 0.0174, 0.02888],
  [2025, 0.1778, 0.1653, 0.0421, 0.078, 0.0696, 0.02677]
];

// src/engine/mortality.ts
var Q_MALE = [6015e-6, 479e-6, 32e-5, 249e-6, 194e-6, 159e-6, 137e-6, 125e-6, 12e-5, 12e-5, 125e-6, 14e-5, 173e-6, 233e-6, 327e-6, 463e-6, 634e-6, 819e-6, 999e-6, 1138e-6, 1235e-6, 1315e-6, 1378e-6, 1439e-6, 1509e-6, 1595e-6, 1685e-6, 1783e-6, 1876e-6, 197e-5, 2085e-6, 2202e-6, 2308e-6, 2407e-6, 249e-5, 2577e-6, 2665e-6, 2764e-6, 2864e-6, 2987e-6, 3115e-6, 3253e-6, 3419e-6, 36e-4, 3777e-6, 3931e-6, 4073e-6, 4245e-6, 4477e-6, 4795e-6, 5126e-6, 5496e-6, 5917e-6, 6404e-6, 6923e-6, 7491e-6, 8173e-6, 8938e-6, 9714e-6, 0.010494, 0.011337, 0.012232, 0.013196, 0.014229, 0.015316, 0.016455, 0.017574, 0.018735, 0.019981, 0.021366, 0.022903, 0.024615, 0.026504, 0.028648, 0.031071, 0.033802, 0.03701, 0.041158, 0.045461, 0.050346, 0.055633, 0.061757, 0.068358, 0.07542, 0.083364, 0.09268, 0.103459, 0.115502, 0.129018, 0.14381, 0.159458, 0.176551, 0.19536, 0.216286, 0.238799, 0.262268, 0.286291, 0.310944, 0.332325, 0.349036, 0.366568, 0.38496, 0.404252, 0.424488, 0.445712, 0.467998, 0.491398, 0.515968, 0.541766, 0.568854, 0.597297, 0.627162, 0.65852, 0.691446, 0.726018, 0.762319, 0.800435, 0.840457, 0.88248, 0.926604];
var Q_FEMALE = [5125e-6, 392e-6, 229e-6, 188e-6, 155e-6, 133e-6, 115e-6, 105e-6, 1e-4, 98e-6, 101e-6, 111e-6, 126e-6, 152e-6, 188e-6, 229e-6, 273e-6, 323e-6, 372e-6, 41e-5, 441e-6, 476e-6, 513e-6, 546e-6, 582e-6, 609e-6, 641e-6, 683e-6, 74e-5, 808e-6, 878e-6, 947e-6, 1018e-6, 1089e-6, 1154e-6, 1209e-6, 1263e-6, 1347e-6, 1438e-6, 1533e-6, 1643e-6, 1742e-6, 1845e-6, 1954e-6, 2075e-6, 2187e-6, 2306e-6, 2438e-6, 2595e-6, 2791e-6, 303e-5, 3288e-6, 3554e-6, 3847e-6, 4172e-6, 4532e-6, 4923e-6, 5365e-6, 5815e-6, 6333e-6, 6923e-6, 7555e-6, 822e-5, 8881e-6, 9514e-6, 0.010188, 0.01088, 0.011659, 0.012543, 0.013581, 0.014769, 0.016153, 0.017705, 0.019495, 0.021533, 0.023846, 0.026458, 0.0297, 0.033135, 0.036982, 0.041183, 0.045959, 0.051282, 0.057262, 0.064107, 0.071752, 0.08049, 0.090566, 0.102204, 0.115178, 0.129176, 0.144229, 0.160353, 0.177635, 0.196502, 0.216846, 0.23875, 0.261359, 0.283899, 0.306491, 0.32968, 0.353333, 0.3773, 0.401416, 0.425501, 0.451031, 0.478092, 0.506778, 0.537185, 0.568854, 0.597297, 0.627162, 0.65852, 0.691446, 0.726018, 0.762319, 0.800435, 0.840457, 0.88248, 0.926604];
var HEALTH_MULT = { excellent: 0.65, good: 0.85, average: 1, poor: 1.6 };
var IMPROVEMENT = 0.01;
function qx(age, sex, health, yearsAhead) {
  const a = Math.min(119, Math.max(0, Math.floor(age)));
  const base = (sex === "M" ? Q_MALE : Q_FEMALE)[a];
  return Math.min(1, base * HEALTH_MULT[health] * Math.pow(1 - IMPROVEMENT, Math.max(0, yearsAhead)));
}

// src/engine/law.ts
var LAW_2025 = {
  year: 2025,
  ordinary: {
    mfj: [[23850, 0.1], [96950, 0.12], [206700, 0.22], [394600, 0.24], [501050, 0.32], [751600, 0.35], [Infinity, 0.37]],
    single: [[11925, 0.1], [48475, 0.12], [103350, 0.22], [197300, 0.24], [250525, 0.32], [626350, 0.35], [Infinity, 0.37]]
  },
  ltcg: {
    mfj: [[96700, 0], [600050, 0.15], [Infinity, 0.2]],
    single: [[48350, 0], [533400, 0.15], [Infinity, 0.2]]
  },
  standardDeduction: { mfj: 31500, single: 15750 },
  std65: { mfj: 1600, single: 2e3 },
  senior: { amount: 6e3, threshold: { mfj: 15e4, single: 75e3 }, rate: 0.06, lastYear: 2028 },
  ssBase: { mfj: [32e3, 44e3], single: [25e3, 34e3] },
  niit: { rate: 0.038, threshold: { mfj: 25e4, single: 2e5 } },
  irmaa: {
    partB: 185,
    tiers: {
      mfj: [212e3, 266e3, 334e3, 4e5, 75e4],
      single: [106e3, 133e3, 167e3, 2e5, 5e5]
    },
    partBTotal: [185, 259, 370, 480.9, 591.9, 628.9],
    partDAdd: [0, 13.7, 35.3, 57, 78.6, 85.8]
  },
  estate: { exemption: 1399e4, rate: 0.4 },
  sources: {
    ordinary: "IRS Rev. Proc. 2024-40 \xA72.01",
    ltcg: "IRS Rev. Proc. 2024-40 \xA72.03",
    standardDeduction: "P.L. 119-21 (OBBBA) \xA770102, replacing Rev. Proc. 2024-40 \xA72.15 ($15,000 / $30,000); confirmed by Rev. Proc. 2025-32 \xA73.01",
    std65: "IRS Rev. Proc. 2024-40 \xA72.15",
    senior: "IRC \xA7151(d)(5)(C), added by P.L. 119-21 (OBBBA) \xA770103; Form 1040 Schedule 1-A Part V, lines 35-36b",
    ssBase: "IRC \xA786(c)",
    niit: "IRC \xA71411",
    irmaa: "CMS 2025 Medicare Parts B & D premiums fact sheet",
    estate: "IRS Rev. Proc. 2024-40 \xA72.41"
  }
};
var LAW_2026 = {
  year: 2026,
  ordinary: {
    mfj: [[24800, 0.1], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [Infinity, 0.37]],
    single: [[12400, 0.1], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [Infinity, 0.37]]
  },
  ltcg: {
    mfj: [[98900, 0], [613700, 0.15], [Infinity, 0.2]],
    single: [[49450, 0], [545500, 0.15], [Infinity, 0.2]]
  },
  standardDeduction: { mfj: 32200, single: 16100 },
  std65: { mfj: 1650, single: 2050 },
  senior: { amount: 6e3, threshold: { mfj: 15e4, single: 75e3 }, rate: 0.06, lastYear: 2028 },
  ssBase: { mfj: [32e3, 44e3], single: [25e3, 34e3] },
  niit: { rate: 0.038, threshold: { mfj: 25e4, single: 2e5 } },
  irmaa: {
    partB: 202.9,
    tiers: {
      mfj: [218e3, 274e3, 342e3, 41e4, 75e4],
      single: [109e3, 137e3, 171e3, 205e3, 5e5]
    },
    partBTotal: [202.9, 284.1, 405.8, 527.5, 649.2, 689.9],
    partDAdd: [0, 14.5, 37.5, 60.4, 83.3, 91]
  },
  estate: { exemption: 15e6, rate: 0.4 },
  sources: {
    ordinary: "IRS Rev. Proc. 2025-32 \xA74.01; rates made permanent by P.L. 119-21 (OBBBA)",
    ltcg: "IRS Rev. Proc. 2025-32 \xA74.03",
    standardDeduction: "IRS Rev. Proc. 2025-32 \xA74.14, as set by P.L. 119-21",
    std65: "IRS Rev. Proc. 2025-32 \xA74.14",
    senior: "IRC \xA7151(d)(5)(C), added by P.L. 119-21 (OBBBA) \xA770103; Form 1040 Schedule 1-A Part V, lines 35-36b",
    ssBase: "IRC \xA786(c)",
    niit: "IRC \xA71411",
    irmaa: "CMS 2026 Medicare Parts B & D premiums fact sheet",
    estate: "P.L. 119-21 (OBBBA)"
  }
};
var LAW = { 2025: LAW_2025, 2026: LAW_2026 };
var LAW_YEAR = 2026;

// src/engine/tax.ts
var L26 = LAW[LAW_YEAR];
var ORDINARY = L26.ordinary;
var LTCG = L26.ltcg;
var STD_DEDUCTION = L26.standardDeduction;
var STD_65 = L26.std65;
var SENIOR = L26.senior;
var SS_BASE = L26.ssBase;
var NIIT = L26.niit;
var IRMAA = L26.irmaa;
var ESTATE = L26.estate;
var flat = (br) => ({ hi: br.map((x) => x[0]), r: br.map((x) => x[1]) });
var FLATS = /* @__PURE__ */ new Map();
function flats(law) {
  let f = FLATS.get(law);
  if (!f) {
    f = { ord: { mfj: flat(law.ordinary.mfj), single: flat(law.ordinary.single) }, ltcg: { mfj: flat(law.ltcg.mfj), single: flat(law.ltcg.single) } };
    FLATS.set(law, f);
  }
  return f;
}
function bracketTax(income, f, k) {
  let tax = 0, lo = 0;
  const hi = f.hi, r = f.r;
  for (let i = 0; i < hi.length; i++) {
    if (income <= lo) break;
    const h = hi[i] * k;
    tax += ((income < h ? income : h) - lo) * r[i];
    lo = h;
  }
  return tax;
}
function taxableSocialSecurity(ss, otherIncome, filing, law = L26) {
  if (ss <= 0) return 0;
  const [b1, b2] = law.ssBase[filing];
  const prov = otherIncome + ss / 2;
  if (prov <= b1) return 0;
  if (prov <= b2) return Math.min(ss / 2, (prov - b1) / 2);
  return Math.min(0.85 * ss, 0.85 * (prov - b2) + Math.min(ss / 2, (b2 - b1) / 2));
}
function seniorDeductionPerPerson(magi, filing, year, law = L26) {
  const s = law.senior;
  if (year > s.lastYear) return 0;
  return Math.max(0, s.amount - Math.max(0, magi - s.threshold[filing]) * s.rate);
}
function computeTax(i) {
  const k = i.index;
  const law = i.law ?? L26;
  const f = flats(law);
  const otherIncome = i.wages + i.ordinary + i.ltcg;
  const taxableSS = taxableSocialSecurity(i.ssBenefits, otherIncome, i.filing, law);
  const agi = otherIncome + taxableSS;
  const magi = agi;
  const standardDeduction = (law.standardDeduction[i.filing] + law.std65[i.filing] * i.over65) * k;
  const seniorDeduction = i.over65 * seniorDeductionPerPerson(magi, i.filing, i.year, law);
  const deduction = standardDeduction + seniorDeduction;
  const taxableIncome = Math.max(0, agi - deduction);
  const ordTaxable = Math.max(0, taxableIncome - i.ltcg);
  const ordinaryTax = bracketTax(ordTaxable, f.ord[i.filing], k);
  const gains = taxableIncome - ordTaxable;
  const ltcgTax = gains > 0 ? bracketTax(ordTaxable + gains, f.ltcg[i.filing], k) - bracketTax(ordTaxable, f.ltcg[i.filing], k) : 0;
  const niit = law.niit.rate * Math.max(0, Math.min(i.ltcg + (i.investmentInterest ?? 0), magi - law.niit.threshold[i.filing]));
  const federal = ordinaryTax + ltcgTax + niit;
  const stateBase = Math.max(0, agi - (i.stateTaxesSS ? 0 : taxableSS) - law.standardDeduction[i.filing] * k * 0.5);
  const state = stateBase * i.stateRate;
  let bracketRate = 0.37, bracketRoom = Infinity;
  const of = f.ord[i.filing];
  for (let j = 0; j < of.hi.length; j++) {
    const h = of.hi[j] * k;
    if (ordTaxable < h) {
      bracketRate = of.r[j];
      bracketRoom = h - ordTaxable;
      break;
    }
  }
  return { agi, magi, taxableSS, standardDeduction, seniorDeduction, deduction, taxableIncome, ordinaryTax, ltcgTax, niit, federal, state, total: federal + state, bracketRate, bracketRoom };
}
function bracketTop(rate, filing, index, law = L26) {
  const b = law.ordinary[filing].find(([, r]) => r === rate);
  return b ? b[0] * index : 0;
}
function irmaaTier(magi, filing, index, law = L26) {
  const t = law.irmaa.tiers[filing];
  let tier = 0;
  for (let j = 0; j < t.length; j++) {
    const top = j === t.length - 1;
    if (top ? magi >= t[j] : magi > t[j] * index) tier = j + 1;
  }
  return tier;
}
function medicareAnnual(tier, law = L26) {
  return (law.irmaa.partBTotal[tier] + law.irmaa.partDAdd[tier]) * 12;
}
var ULT = [27.4, 26.5, 25.5, 24.6, 23.7, 22.9, 22, 21.1, 20.2, 19.4, 18.5, 17.7, 16.8, 16, 15.2, 14.4, 13.7, 12.9, 12.2, 11.5, 10.8, 10.1, 9.5, 8.9, 8.4, 7.8, 7.3, 6.8, 6.4, 6, 5.6, 5.2, 4.9, 4.6, 4.3, 4.1, 3.9, 3.7, 3.5, 3.4, 3.3, 3.1, 3, 2.9, 2.8, 2.7, 2.5, 2.3, 2];
var rmdDivisor = (age) => ULT[Math.min(ULT.length - 1, Math.max(0, Math.floor(age) - 72))];
var rmdStartAge = (birthYear) => birthYear >= 1960 ? 75 : birthYear >= 1951 ? 73 : 72;

// src/engine/sim.ts
var START_YEAR = (/* @__PURE__ */ new Date()).getFullYear();
function fullRetirementAge(birthYear) {
  if (birthYear >= 1960) return 67;
  if (birthYear <= 1954) return 66;
  return 66 + (birthYear - 1954) * 2 / 12;
}
function claimFactor(claimAge, birthYear) {
  const fra = fullRetirementAge(birthYear);
  const months = Math.round((Math.min(claimAge, 70) - fra) * 12);
  if (months >= 0) return 1 + months * 2 / 300;
  const m = -months;
  return 1 - Math.min(m, 36) * 5 / 900 - Math.max(0, m - 36) * 5 / 1200;
}
function spousalExcessFactor(startAge, birthYear) {
  const fra = fullRetirementAge(birthYear);
  const m = Math.max(0, Math.round((fra - startAge) * 12));
  return 1 - Math.min(m, 36) * 25 / 3600 - Math.max(0, m - 36) * 5 / 1200;
}
function survivorFactor(age, birthYear) {
  const fra = fullRetirementAge(birthYear);
  if (age >= fra) return 1;
  if (age < 60) return 0;
  return 0.715 + 0.285 * (age - 60) / (fra - 60);
}
var EARNINGS_TEST_LIMIT = 24480;
var INCOME_REPLACEMENT = 0.6;
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = seed + 1831565813 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var caches = {};
function randoms(kind, n) {
  const key = kind;
  if (caches[key] && caches[key].length >= n) return caches[key];
  const a = new Float64Array(Math.max(n, 1e3 * 120));
  const rnd = mulberry32(kind === "z" ? 20240917 : 977);
  if (kind === "u") for (let i = 0; i < a.length; i++) a[i] = rnd();
  else
    for (let i = 0; i < a.length; i += 2) {
      const r = Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-12)));
      const th = 2 * Math.PI * rnd();
      a[i] = r * Math.cos(th);
      if (i + 1 < a.length) a[i + 1] = r * Math.sin(th);
    }
  caches[key] = a;
  return a;
}
function people(plan) {
  return plan.spouse ? [plan.client, plan.spouse] : [plan.client];
}
function retirementYear(plan) {
  return Math.max(...people(plan).map((p) => p.birthYear + p.retirementAge));
}
function goalStart(g, plan) {
  return g.atRetirement ? retirementYear(plan) : g.startYear;
}
function goalOccursIn(g, plan, year, endYear) {
  const start = goalStart(g, plan);
  if (year < start) return false;
  const last = g.years > 0 ? start + g.years - 1 : endYear;
  if (year > last) return false;
  if (g.repeatEvery > 0) return (year - start) % g.repeatEvery === 0;
  return true;
}
var CASH = 0;
var TAX = 1;
var DEF_C = 2;
var DEF_S = 3;
var ROTH_C = 4;
var ROTH_S = 5;
function prepare(plan, opts) {
  const stress = opts.stress ?? {};
  const ppl = people(plan);
  const married = ppl.length === 2;
  const births = ppl.map((p) => p.birthYear);
  const retireYears = ppl.map((p) => p.birthYear + p.retirementAge);
  const planDeaths = ppl.map((p, i) => {
    let d = p.birthYear + p.planningAge;
    if (stress.earlyDeath === (i === 0 ? "client" : "spouse")) d = stress.earlyDeathTiming === "now" ? START_YEAR : Math.max(START_YEAR, Math.min(d, p.birthYear + p.retirementAge));
    return d;
  });
  const stochastic = (opts.longevity ?? plan.assumptions.longevity) === "stochastic";
  const endYear = stochastic ? Math.max(...ppl.map((p) => p.birthYear + 110)) : Math.max(...planDeaths);
  const N = Math.max(1, endYear - START_YEAR + 1);
  const retYear = Math.max(...retireYears);
  const goals = plan.goals.filter((g) => g.enabled && g.priority >= (opts.minPriority ?? 0) && (opts.goalFilter ? opts.goalFilter(g) : true));
  const retGoal = goals.find((g) => g.type === "retirement");
  const flexTargetIds = new Set(retGoal ? [retGoal.id] : []);
  const floorMult = retGoal && retGoal.amount > 0 ? Math.min(1, retGoal.acceptable / retGoal.amount) : 1;
  const S = 3;
  const mk = () => new Float64Array(S * N);
  const ss = mk(), penReal = mk(), penNom = mk(), expFixed = mk(), expFlex = mk(), medCount = mk(), over65 = mk(), wages = mk();
  const retired = new Uint8Array(S * N);
  const contrib = new Float64Array(S * N * 6);
  const breakdown = [[], [], []];
  const ssCut = new Float64Array(N).map((_, y) => (stress.ssCut || plan.assumptions.ssReduction) && START_YEAR + y >= 2033 ? 0.77 : 1);
  const adjClaim = ppl.map((p, i) => {
    const fra = fullRetirementAge(p.birthYear);
    if (p.ssClaimAge >= fra || p.salary <= EARNINGS_TEST_LIMIT) return p.ssClaimAge;
    const annual = p.ssPia * 12 * claimFactor(p.ssClaimAge, p.birthYear);
    if (annual <= 0) return p.ssClaimAge;
    let months = 0;
    for (let age = p.ssClaimAge; age < Math.floor(fra); age++) {
      if (p.birthYear + age >= retireYears[i]) break;
      months += 12 * Math.min(1, (p.salary - EARNINGS_TEST_LIMIT) / 2 / annual);
    }
    return Math.min(fra, p.ssClaimAge + months / 12);
  });
  const ownBenefit = (i, age) => {
    const p = ppl[i];
    if (age < p.ssClaimAge) return 0;
    const f = age >= fullRetirementAge(p.birthYear) ? claimFactor(adjClaim[i], p.birthYear) : claimFactor(p.ssClaimAge, p.birthYear);
    return p.ssPia * 12 * f;
  };
  const survivor = (deadIdx, deathYear) => {
    const d = ppl[deadIdx], sv = ppl[1 - deadIdx];
    const deathAge = deathYear - d.birthYear;
    const fraD = fullRetirementAge(d.birthYear);
    const pia = d.ssPia * 12;
    let full, limit = Infinity;
    if (deathAge >= d.ssClaimAge) {
      const ben = pia * claimFactor(d.ssClaimAge, d.birthYear);
      if (d.ssClaimAge >= fraD) full = ben;
      else {
        full = pia;
        limit = Math.max(ben, 0.825 * pia);
      }
    } else {
      full = deathAge < fraD ? pia : pia * claimFactor(Math.min(70, deathAge), d.birthYear);
    }
    const firstAge = deathYear + 1 - sv.birthYear;
    const startAge = Math.max(60, firstAge, Math.min(sv.ssClaimAge, Math.ceil(fullRetirementAge(sv.birthYear))));
    return { amount: Math.min(limit, full * survivorFactor(startAge, sv.birthYear)), startYear: sv.birthYear + startAge };
  };
  for (let s = 0; s < S; s++) {
    if (!married && s !== 1) continue;
    const alive = married ? [s !== 2, s !== 1] : [true];
    for (let y = 0; y < N; y++) {
      const year = START_YEAR + y;
      const ages = births.map((b) => year - b);
      const allRetired = ppl.every((_, i) => !alive[i] || year >= retireYears[i]);
      retired[s * N + y] = allRetired ? 1 : 0;
      for (const a of plan.accounts) {
        const oi = a.owner === "spouse" && married ? 1 : 0;
        if (!alive[oi] || year >= retireYears[oi]) continue;
        const amt = a.annualSavings * Math.pow(1 + a.savingsIncrease, y);
        const b = a.type === "cash" ? CASH : a.type === "taxable" ? TAX : a.type === "deferred" ? DEF_C + oi : ROTH_C + oi;
        contrib[(s * N + y) * 6 + b] += amt;
      }
      let w2 = 0;
      ppl.forEach((p, i) => {
        if (alive[i] && year < retireYears[i]) w2 += p.salary;
      });
      wages[s * N + y] = w2;
      let benefit = 0;
      ppl.forEach((p, i) => {
        if (!alive[i]) return;
        const age = ages[i];
        let b = ownBenefit(i, age);
        const other = ppl[1 - i];
        if (other && married && alive[1 - i] && age >= p.ssClaimAge && ages[1 - i] >= other.ssClaimAge) {
          const excess = Math.max(0, 0.5 * other.ssPia - p.ssPia) * 12;
          if (excess > 0) {
            const startAge = Math.max(p.ssClaimAge, other.birthYear + other.ssClaimAge - p.birthYear);
            b += excess * spousalExcessFactor(startAge, p.birthYear);
          }
        }
        if (b > 0 && year < retireYears[i] && age < fullRetirementAge(p.birthYear) && p.salary > EARNINGS_TEST_LIMIT) {
          b = Math.max(0, b - (p.salary - EARNINGS_TEST_LIMIT) / 2);
        }
        benefit += b;
      });
      ss[s * N + y] = benefit;
      for (const inc of plan.income) {
        const oi = inc.owner === "spouse" && married ? 1 : 0;
        const age = ages[oi];
        if (age < inc.startAge || inc.endAge > 0 && age > inc.endAge) continue;
        const factor = alive[oi] ? 1 : married && alive[1 - oi] ? inc.survivorPct / 100 : 0;
        if (!factor) continue;
        if (inc.cola) {
          penReal[s * N + y] += inc.annualAmount * factor;
        } else {
          penNom[s * N + y] += inc.annualAmount * factor;
        }
      }
      const bd = {};
      for (const g of goals) {
        if (g.type === "legacy") continue;
        if (g.type === "retirement") {
          if (!allRetired) continue;
          const amt = g.amount * (s === 0 || !married ? 1 : g.survivorPct / 100);
          bd[g.id] = amt;
          expFlex[s * N + y] += amt;
        } else if (goalOccursIn(g, plan, year, endYear)) {
          bd[g.id] = g.amount;
          expFixed[s * N + y] += g.amount;
        }
      }
      if (married && s !== 0) {
        const dead = s === 1 ? 1 : 0;
        if (year < retireYears[dead] && ppl[dead].salary > 0 && year <= Math.max(...planDeaths)) {
          const amt = ppl[dead].salary * INCOME_REPLACEMENT;
          bd["income"] = amt;
          expFixed[s * N + y] += amt;
        }
      }
      breakdown[s][y] = bd;
      ppl.forEach((_, i) => {
        if (!alive[i]) return;
        if (ages[i] >= 65) {
          over65[s * N + y] += 1;
          if (year >= retireYears[i]) medCount[s * N + y] += 1;
        }
      });
    }
  }
  const debt = new Float64Array(N);
  for (const l of plan.liabilities) {
    let bal = l.balance;
    const pay = l.monthlyPayment * 12;
    for (let y = 0; y < N && bal > 0 && pay > 0; y++) {
      const interest = bal * l.rate;
      const p = Math.min(pay, bal + interest);
      bal = bal + interest - p;
      if (START_YEAR + y >= retYear) debt[y] += p;
    }
  }
  const inflowReal = new Float64Array(N);
  const inflowGain = new Float64Array(N);
  for (const f of plan.inflows ?? []) {
    const y = f.year - START_YEAR;
    if (y >= 0 && y < N) {
      inflowReal[y] += f.amount;
      inflowGain[y] += f.amount * f.gainPct;
    }
  }
  const ltc = new Float64Array(N);
  if (stress.ltc) {
    for (let y = 0; y < N; y++) {
      const age = START_YEAR + y - plan.client.birthYear;
      if (age >= stress.ltc.age && age < stress.ltc.age + stress.ltc.years) ltc[y] = stress.ltc.amount;
    }
  }
  const start = [0, 0, 0, 0, 0, 0];
  let basis = 0;
  for (const a of plan.accounts) {
    const oi = a.owner === "spouse" && married ? 1 : 0;
    if (a.type === "cash") start[CASH] += a.balance;
    else if (a.type === "taxable") {
      start[TAX] += a.balance;
      basis += Math.min(a.balance, a.basis ?? a.balance);
    } else if (a.type === "deferred") start[DEF_C + oi] += a.balance;
    else start[ROTH_C + oi] += a.balance;
  }
  return {
    N,
    married,
    births,
    retireYears,
    planDeaths,
    retYear,
    ss,
    ssCut,
    survivor,
    penReal,
    penNom,
    expFixed,
    expFlex,
    medCount,
    over65,
    wages,
    retired,
    contrib,
    breakdown,
    debt,
    inflowReal,
    inflowGain,
    ltc,
    legacyReal: goals.filter((g) => g.type === "legacy").reduce((s, g) => s + g.amount, 0),
    otherAssetsReal: plan.otherAssets.reduce((s, a) => s + a.value, 0),
    start,
    basis,
    flexTargetIds,
    floorMult
  };
}
function runTrial(env) {
  const { plan, pr, deaths } = env;
  const A = plan.assumptions;
  const St = plan.strategy;
  const N = pr.N;
  const b = pr.start.slice();
  let basis = pr.basis;
  let P = 1;
  let M = 1;
  const medExcess = A.medicalInflation - A.inflation;
  const port = (y) => START_YEAR + y >= pr.retYear ? A.postRetPortfolio : A.preRetPortfolio;
  const magiHist = new Float64Array(N);
  let mult = 1, wr0 = 0, minMult = 1, multSum = 0, multN = 0, cut = false;
  let taxReal = 0, medReal = 0;
  let lastY = -1;
  let prevState = pr.married ? 0 : 1;
  const insurancePaid = [false, false];
  let surv = null;
  for (let y = 0; y < N; y++) {
    const year = START_YEAR + y;
    const aliveC = year <= deaths[0];
    const aliveS = pr.married && year <= deaths[1];
    if (!aliveC && !aliveS) break;
    lastY = y;
    const s = pr.married ? aliveC && aliveS ? 0 : aliveC ? 1 : 2 : 1;
    const ix = s * N + y;
    if (s !== prevState) {
      const deadIdx = s === 1 ? 1 : 0;
      const alive = 1 - deadIdx;
      b[DEF_C + alive] += b[DEF_C + deadIdx];
      b[DEF_C + deadIdx] = 0;
      b[ROTH_C + alive] += b[ROTH_C + deadIdx];
      b[ROTH_C + deadIdx] = 0;
      surv = pr.survivor(deadIdx, deaths[deadIdx]);
      const person = deadIdx === 0 ? plan.client : plan.spouse;
      if (!insurancePaid[deadIdx] && person.lifeInsurance > 0) {
        b[TAX] += person.lifeInsurance;
        basis += person.lifeInsurance;
        insurancePaid[deadIdx] = true;
      }
      prevState = s;
    }
    const begin = b[0] + b[1] + b[2] + b[3] + b[4] + b[5];
    let rmd = 0;
    for (let i = 0; i < (pr.married ? 2 : 1); i++) {
      const alive = i === 0 ? aliveC : aliveS;
      const age = year - pr.births[i];
      if (alive && age >= rmdStartAge(pr.births[i]) && b[DEF_C + i] > 0) {
        const r2 = b[DEF_C + i] / rmdDivisor(age);
        b[DEF_C + i] -= r2;
        rmd += r2;
      }
    }
    let contribution = 0;
    for (let k = 0; k < 6; k++) {
      const c = pr.contrib[ix * 6 + k];
      if (c) {
        b[k] += c;
        contribution += c;
        if (k === TAX) basis += c;
      }
    }
    const filing = s === 0 ? "mfj" : "single";
    const ssReal = surv && s !== 0 && year >= surv.startYear ? Math.max(pr.ss[ix], surv.amount) : pr.ss[ix];
    const ssN = ssReal * pr.ssCut[y] * P;
    const penN = pr.penReal[ix] * P + pr.penNom[ix];
    const inflowN = pr.inflowReal[y] * P;
    const inflowGainN = pr.inflowGain[y] * P;
    if (inflowN) {
      b[TAX] += inflowN;
      basis += inflowN;
    }
    const wagesN = pr.wages[ix] * P;
    const retired = pr.retired[ix] === 1;
    const flexN = pr.expFlex[ix] * P * mult;
    const goalN = pr.expFixed[ix] * P + flexN;
    const ltcN = aliveC ? pr.ltc[y] * M : 0;
    const debtN = pr.debt[y];
    const tier = pr.medCount[ix] > 0 ? irmaaTier(y >= 2 ? magiHist[y - 2] : magiHist[0] || 0, filing, P) : 0;
    const medicareN = pr.medCount[ix] * medicareAnnual(tier) * M;
    const spend = goalN + ltcN + debtN + medicareN;
    const ps = PORTFOLIO_STATS[port(y)];
    const w2 = MODEL_PORTFOLIOS[port(y)].weights;
    const qualYield = w2.usLarge * ASSET_INFO.usLarge.yield + w2.usSmall * ASSET_INFO.usSmall.yield + w2.intl * ASSET_INFO.intl.yield + w2.emerging * ASSET_INFO.emerging.yield;
    const ordYield = Math.max(0, ps.yield - qualYield);
    const dividends = b[TAX] * qualYield;
    const taxableInterest = b[TAX] * ordYield;
    const interest = taxableInterest + b[CASH] * env.cashRet(y);
    const baseTax = (extraOrd, gains2) => computeTax({
      filing,
      year,
      index: P,
      wages: wagesN,
      ordinary: penN + rmd + interest + extraOrd,
      investmentInterest: interest,
      ltcg: dividends + inflowGainN + gains2,
      ssBenefits: ssN,
      over65: pr.over65[ix],
      stateRate: A.stateRate,
      stateTaxesSS: A.stateTaxesSS
    });
    const wageOnlyTax = wagesN > 0 ? computeTax({ filing, year, index: P, wages: wagesN, ordinary: 0, ltcg: 0, ssBenefits: 0, over65: pr.over65[ix], stateRate: A.stateRate, stateTaxesSS: A.stateTaxesSS }).total : 0;
    const convAllowed = St.roth.enabled && year >= St.roth.startYear && year <= St.roth.endYear;
    let conv = 0;
    let fromCash = 0, fromTax = 0, gains = 0, fromDef = 0, fromRoth = 0;
    let tax = baseTax(0, 0);
    let shortfall = 0;
    let prevDef = 0, prevGains = 0, prevDraw = 0;
    for (let it = 0; it < 8; it++) {
      if (convAllowed) {
        const top = bracketTop(St.roth.bracket, filing, P);
        const ordTaxable = Math.max(0, tax.taxableIncome - (dividends + inflowGainN + gains));
        let room = top - ordTaxable;
        if (St.roth.respectIrmaa) room = Math.min(room, IRMAA.tiers[filing][0] * P - 2e3 - tax.magi);
        const avail = b[DEF_C] + b[DEF_S] - fromDef;
        conv = Math.max(0, Math.min(avail, conv + room));
      }
      const incomeTax2 = Math.max(0, tax.total - wageOnlyTax);
      let need = spend + incomeTax2 - ssN - penN - rmd;
      fromCash = fromTax = gains = fromDef = fromRoth = 0;
      shortfall = 0;
      if (need > 0) {
        const pool = { cash: b[CASH], tax: b[TAX], def: b[DEF_C] + b[DEF_S] - conv, roth: b[ROTH_C] + b[ROTH_S] };
        const gainFrac = b[TAX] > 0 ? Math.max(0, 1 - basis / b[TAX]) : 0;
        const take = (k, amt) => {
          const x = Math.max(0, Math.min(pool[k], amt));
          pool[k] -= x;
          if (k === "cash") fromCash += x;
          else if (k === "tax") {
            fromTax += x;
            gains += x * gainFrac;
          } else if (k === "def") fromDef += x;
          else fromRoth += x;
          return x;
        };
        if (St.withdrawalOrder === "proportional") {
          const tot = pool.cash + pool.tax + pool.def + pool.roth;
          if (tot > 0) {
            const f = Math.min(1, need / tot);
            need -= take("cash", pool.cash * f) + take("tax", pool.tax * f) + take("def", pool.def * f) + take("roth", pool.roth * f);
          }
        } else {
          if (St.withdrawalOrder === "bracket") {
            const top = bracketTop(St.fillBracket, filing, P);
            const ordTaxable = Math.max(0, tax.taxableIncome - (dividends + inflowGainN + prevGains));
            const room = Math.max(0, top - ordTaxable + prevDraw);
            need -= take("def", Math.min(room, need));
          }
          need -= take("cash", need);
          need -= take("tax", need);
          need -= take("def", need);
          need -= take("roth", need);
        }
        if (need > 1) shortfall = need;
      }
      if (fromDef === 0 && gains === 0 && conv === 0 && prevDef === 0 && prevGains === 0) break;
      const next = baseTax(fromDef + conv, gains);
      const done = Math.abs(next.total - tax.total) < 5;
      tax = next;
      prevDef = fromDef + conv;
      prevDraw = fromDef;
      prevGains = gains;
      if (done) break;
    }
    const incomeTax = Math.max(0, tax.total - wageOnlyTax);
    magiHist[y] = tax.magi;
    if (y === 0) magiHist[0] = tax.magi;
    b[CASH] -= fromCash;
    if (fromTax > 0 && b[TAX] > 0) basis -= basis * (fromTax / b[TAX]);
    b[TAX] -= fromTax;
    const defTotal = b[DEF_C] + b[DEF_S];
    if (defTotal > 0) {
      const outD = fromDef + conv;
      const fc = b[DEF_C] / defTotal;
      b[DEF_C] -= outD * fc;
      b[DEF_S] -= outD * (1 - fc);
      if (conv > 0) {
        b[ROTH_C] += conv * fc;
        b[ROTH_S] += conv * (1 - fc);
      }
    }
    const rothTotal = b[ROTH_C] + b[ROTH_S];
    if (rothTotal > 0 && fromRoth > 0) {
      const fc = b[ROTH_C] / rothTotal;
      b[ROTH_C] -= fromRoth * fc;
      b[ROTH_S] -= fromRoth * (1 - fc);
    }
    const cashIn = ssN + penN + rmd + fromCash + fromTax + fromDef + fromRoth;
    const surplus = Math.max(0, cashIn - spend - incomeTax);
    if (surplus > 0) {
      b[TAX] += surplus;
      basis += surplus;
    }
    basis += dividends + taxableInterest;
    const portfolioStart = b[CASH] + b[TAX] + b[DEF_C] + b[DEF_S] + b[ROTH_C] + b[ROTH_S];
    if (St.spending.policy === "guardrails" && retired && pr.expFlex[ix] > 0) {
      const wr = portfolioStart > 0 ? pr.expFlex[ix] * P * mult / portfolioStart : 1;
      if (!wr0) wr0 = wr;
      else if (wr > wr0 * (1 + St.spending.band) && Math.max(...pr.planDeaths) - year > 15) {
        const nm = Math.max(pr.floorMult, mult * (1 - St.spending.adjust));
        if (nm < mult) cut = true;
        mult = nm;
      } else if (wr < wr0 * (1 - St.spending.band)) mult = Math.min(1.25, mult * (1 + St.spending.adjust));
      minMult = Math.min(minMult, mult);
      multSum += mult;
      multN++;
    }
    let r = env.ret(y) - A.fees;
    const rc = env.cashRet(y);
    const pre = b[0] + b[1] + b[2] + b[3] + b[4] + b[5];
    b[CASH] *= 1 + rc;
    for (let k = 1; k < 6; k++) b[k] *= 1 + r;
    if (b[TAX] < 0) b[TAX] = 0;
    const end = b[0] + b[1] + b[2] + b[3] + b[4] + b[5];
    if (env.totals) env.totals[y] = end / P;
    taxReal += incomeTax / P;
    medReal += medicareN / P;
    if (env.rows) {
      env.rows.push({
        year,
        clientAge: year - pr.births[0],
        spouseAge: pr.married ? year - pr.births[1] : null,
        alive: [aliveC, !!aliveS],
        retired,
        begin,
        contributions: contribution,
        wages: wagesN,
        socialSecurity: ssN,
        pensions: penN,
        inflows: inflowN,
        goalSpending: goalN + ltcN,
        goalBreakdown: Object.fromEntries(Object.entries(pr.breakdown[s][y] ?? {}).map(([k, v]) => [k, v * P * (pr.flexTargetIds.has(k) ? mult : 1)]).concat(ltcN ? [["ltc", ltcN]] : [])),
        debtPayments: debtN,
        medicare: medicareN,
        irmaaTier: tier,
        taxes: incomeTax,
        federalTax: Math.max(0, tax.federal - (wageOnlyTax ? wageOnlyTax * (tax.federal / Math.max(1, tax.total)) : 0)),
        stateTax: Math.max(0, tax.state - (wageOnlyTax ? wageOnlyTax * (tax.state / Math.max(1, tax.total)) : 0)),
        tax,
        rmd,
        rothConversion: conv,
        fromCash,
        fromTaxable: fromTax,
        fromDeferred: fromDef,
        fromRoth,
        realizedGains: gains,
        ordinaryIncome: penN + rmd + interest + fromDef + conv,
        capitalGains: dividends + inflowGainN + gains,
        surplus,
        growth: end - pre,
        end,
        balances: { cash: b[CASH], taxable: b[TAX], deferred: b[DEF_C] + b[DEF_S], roth: b[ROTH_C] + b[ROTH_S] },
        spendingMultiplier: mult,
        shortfall
      });
    }
    if (shortfall > 0) {
      const lastAlive = Math.max(...deaths) - START_YEAR;
      if (env.totals) for (let k = y; k < N; k++) env.totals[k] = k <= lastAlive ? 0 : NaN;
      return { ok: false, failYear: y, endReal: 0, heirsReal: 0, estateTaxReal: 0, taxReal, medicareReal: medReal, minMult, avgMult: multN ? multSum / multN : 1, cut, lastYear: y };
    }
    P *= 1 + env.infl(y);
    M *= 1 + env.infl(y) + medExcess;
  }
  if (env.totals) for (let k = lastY + 1; k < N; k++) env.totals[k] = NaN;
  const invest = b[0] + b[1] + b[2] + b[3] + b[4] + b[5];
  const deferred = b[DEF_C] + b[DEF_S];
  const other = pr.otherAssetsReal * P;
  const estate = invest + other;
  const exemption = ESTATE.exemption * P * (pr.married ? 2 : 1);
  const estateTax = Math.max(0, estate - exemption) * ESTATE.rate;
  const heirs = invest - deferred * A.heirTaxRate + other - estateTax;
  const endReal = invest / P;
  return {
    ok: endReal >= pr.legacyReal,
    failYear: endReal >= pr.legacyReal ? -1 : lastY,
    endReal,
    heirsReal: heirs / P,
    estateTaxReal: estateTax / P,
    taxReal,
    medicareReal: medReal,
    minMult,
    avgMult: multN ? multSum / multN : 1,
    cut,
    lastYear: lastY
  };
}
function sampleDeaths(plan, trial) {
  const u = randoms("u", 1e3 * 240);
  return people(plan).map((p, i) => {
    let age = START_YEAR - p.birthYear;
    let t = 0;
    let k = (trial * 2 + i) * 120;
    while (age < 119 && u[k % u.length] >= qx(age, p.sex, p.health, t)) {
      age++;
      t++;
      k++;
    }
    return p.birthYear + age;
  });
}
function simulate(plan, opts = {}) {
  const pr = prepare(plan, opts);
  const A = plan.assumptions;
  const stress = opts.stress ?? {};
  const mode = opts.returns ?? A.returns;
  const stochastic = (opts.longevity ?? A.longevity) === "stochastic";
  const N = pr.N;
  const infl = A.inflation + (stress.extraInflation ?? 0);
  const drag = stress.returnDrag ?? 0;
  const retIdx = Math.max(0, pr.retYear - START_YEAR);
  const portIdx = (y) => START_YEAR + y >= pr.retYear ? A.postRetPortfolio : A.preRetPortfolio;
  const isBad = (y) => !!stress.badTiming && (y === retIdx || y === retIdx + 1);
  const badRet = (y) => {
    const s = PORTFOLIO_STATS[portIdx(y)];
    return y === retIdx ? s.ret - 2 * s.sd : s.ret - s.sd;
  };
  const geo = (y) => {
    const s = PORTFOLIO_STATS[portIdx(y)];
    return Math.exp(Math.log(1 + s.ret) - Math.log(1 + s.sd * s.sd / ((1 + s.ret) * (1 + s.ret))) / 2) - 1;
  };
  const cashMC = ASSET_INFO.cash.ret;
  const rows = [];
  const avgTotals = new Float64Array(N);
  const avgRun = runTrial({
    plan,
    pr,
    deaths: pr.planDeaths,
    rows,
    totals: avgTotals,
    ret: (y) => (isBad(y) ? badRet(y) : geo(y)) - drag,
    cashRet: () => cashMC,
    infl: () => infl
  });
  let trials;
  let outs = [];
  const all = [];
  let history = null;
  if (mode === "historical") {
    const H = HISTORY.length;
    trials = H;
    history = [];
    for (let s0 = 0; s0 < H; s0++) {
      const totals = new Float64Array(N);
      const row = (y) => HISTORY[(s0 + y) % H];
      const o = runTrial({
        plan,
        pr,
        totals,
        deaths: stochastic ? sampleDeaths(plan, s0) : pr.planDeaths,
        ret: (y) => historicalReturn(row(y), MODEL_PORTFOLIOS[portIdx(y)].weights) - drag,
        cashRet: (y) => row(y)[3],
        infl: (y) => row(y)[6] + (stress.extraInflation ?? 0)
      });
      outs.push(o);
      all.push(totals);
      history.push({ startYear: HISTORY[s0][0], ok: o.ok, endReal: o.endReal, path: Array.from(totals) });
    }
  } else {
    trials = opts.trials ?? 1e3;
    const z = randoms("z", trials * 120);
    const params = [];
    for (let y = 0; y < N; y++) {
      const s = PORTFOLIO_STATS[portIdx(y)];
      const s2 = Math.log(1 + s.sd * s.sd / ((1 + s.ret) * (1 + s.ret)));
      params.push(Math.log(1 + s.ret) - s2 / 2, Math.sqrt(s2));
    }
    for (let k = 0; k < trials; k++) {
      const off = k * 120;
      const totals = opts.lite ? void 0 : new Float64Array(N);
      const o = runTrial({
        plan,
        pr,
        totals,
        deaths: stochastic ? sampleDeaths(plan, k) : pr.planDeaths,
        ret: (y) => (isBad(y) ? badRet(y) : Math.exp(params[y * 2] + params[y * 2 + 1] * z[off + y % 120]) - 1) - drag,
        cashRet: () => cashMC,
        infl: () => infl
      });
      outs.push(o);
      if (totals) all.push(totals);
    }
  }
  const ok = outs.filter((o) => o.ok).length;
  const pct = (arr, q) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] : 0;
  const p10 = [], p25 = [], p50 = [], p75 = [], p90 = [], avg = [];
  for (let y = 0; y < N; y++) {
    avg.push(Number.isNaN(avgTotals[y]) ? 0 : avgTotals[y]);
    if (!all.length) continue;
    const col = [];
    for (const t of all) if (!Number.isNaN(t[y])) col.push(t[y]);
    col.sort((a, b) => a - b);
    p10.push(pct(col, 0.1));
    p25.push(pct(col, 0.25));
    p50.push(pct(col, 0.5));
    p75.push(pct(col, 0.75));
    p90.push(pct(col, 0.9));
  }
  const lastUsed = Math.max(rows.length, ...stochastic ? [] : [N]);
  const cut = (a) => stochastic ? a.slice(0, Math.max(lastUsed, 1)) : a;
  const fails = outs.filter((o) => !o.ok).map((o) => o.failYear).sort((a, b) => a - b);
  const ends = outs.map((o) => o.endReal).sort((a, b) => a - b);
  const guard = plan.strategy.spending.policy === "guardrails";
  const mins = outs.map((o) => o.minMult).sort((a, b) => a - b);
  const avgs = outs.map((o) => o.avgMult).sort((a, b) => a - b);
  const years = Array.from({ length: N }, (_, y) => START_YEAR + y);
  return {
    probability: Math.round(ok / outs.length * 100),
    trials,
    years: cut(years),
    clientAges: cut(years.map((y) => y - plan.client.birthYear)),
    spouseAges: cut(years.map((y) => plan.spouse ? y - plan.spouse.birthYear : null)),
    p10: cut(p10),
    p25: cut(p25),
    p50: cut(p50),
    p75: cut(p75),
    p90: cut(p90),
    avg: cut(avg),
    endAvg: avgRun.endReal,
    endMedian: pct(ends, 0.5),
    afterTaxLegacy: avgRun.heirsReal,
    estateTax: avgRun.estateTaxReal,
    lifetimeTax: avgRun.taxReal,
    lifetimeMedicare: avgRun.medicareReal,
    rows,
    retireYear: pr.retYear,
    medianDepletionYear: fails.length ? START_YEAR + fails[Math.floor(fails.length / 2)] : null,
    spending: guard ? { cutProbability: Math.round(outs.filter((o) => o.cut).length / outs.length * 100), floor10: pct(mins, 0.1), medianLevel: pct(avgs, 0.5) } : null,
    history
  };
}
function probability(plan, opts = {}) {
  return simulate(plan, { ...opts, lite: true }).probability;
}

// src/data.ts
var THIS_YEAR = (/* @__PURE__ */ new Date()).getFullYear();
var PORTFOLIOS = MODEL_PORTFOLIOS.map((p, i) => ({
  name: p.name,
  short: p.short,
  weights: p.weights,
  ret: PORTFOLIO_STATS[i].ret,
  sd: PORTFOLIO_STATS[i].sd,
  equity: PORTFOLIO_STATS[i].equity
}));
var GOAL_META = {
  retirement: { label: "Retirement", icon: "\u2600", color: "#2563eb", defaultPriority: 10 },
  healthcare: { label: "Health Care", icon: "\u271A", color: "#0d9488", defaultPriority: 10 },
  college: { label: "College", icon: "\u{1F393}", color: "#7c3aed", defaultPriority: 8 },
  travel: { label: "Travel", icon: "\u2708", color: "#0891b2", defaultPriority: 5 },
  car: { label: "Car", icon: "\u{1F697}", color: "#ea580c", defaultPriority: 6 },
  purchase: { label: "Major Purchase", icon: "\u{1F3E1}", color: "#16a34a", defaultPriority: 5 },
  legacy: { label: "Legacy", icon: "\u2665", color: "#db2777", defaultPriority: 3 },
  other: { label: "Other Goal", icon: "\u2605", color: "#64748b", defaultPriority: 5 }
};
var uid = () => Math.random().toString(36).slice(2, 10);
function newGoal(type, plan) {
  const m = GOAL_META[type];
  const base = {
    id: uid(),
    type,
    name: m.label,
    priority: m.defaultPriority,
    amount: 1e4,
    acceptable: 8e3,
    atRetirement: false,
    startYear: THIS_YEAR + 2,
    years: 1,
    repeatEvery: 0,
    survivorPct: 100,
    enabled: true
  };
  const retYear = plan.client.birthYear + plan.client.retirementAge;
  switch (type) {
    case "retirement":
      return { ...base, name: "Retirement Living Expense", amount: 9e4, acceptable: 8e4, atRetirement: true, years: 0, survivorPct: 80 };
    case "travel":
      return { ...base, name: "Travel", amount: 12e3, acceptable: 8e3, atRetirement: true, years: 10 };
    case "college":
      return { ...base, name: "College", amount: 3e4, acceptable: 22e3, startYear: THIS_YEAR + 5, years: 4 };
    case "car":
      return { ...base, name: "New Car", amount: 4e4, acceptable: 32e3, startYear: THIS_YEAR + 3, years: 0, repeatEvery: 7 };
    case "purchase":
      return { ...base, name: "Vacation Home", amount: 15e4, acceptable: 1e5, startYear: retYear };
    case "healthcare":
      return { ...base, name: "Health Care Before Medicare", amount: 18e3, acceptable: 15e3, atRetirement: true, years: 3 };
    case "legacy":
      return { ...base, name: "Leave to Heirs", amount: 25e4, acceptable: 1e5, years: 1 };
    default:
      return base;
  }
}
var DEFAULT_ASSUMPTIONS = {
  inflation: 0.025,
  medicalInflation: 0.05,
  fees: 6e-3,
  stateRate: 0.045,
  stateTaxesSS: false,
  heirTaxRate: 0.24,
  preRetPortfolio: 3,
  postRetPortfolio: 3,
  ssReduction: false,
  returns: "montecarlo",
  longevity: "planning"
};
function normalizePerson(p, sex) {
  return {
    lastName: "",
    sex,
    health: "good",
    retirementAge: 65,
    acceptableRetirementAge: 67,
    planningAge: 95,
    salary: 0,
    ssPia: 2e3,
    ssClaimAge: 67,
    lifeInsurance: 0,
    ...p
  };
}
function defaultStrategy(plan) {
  const ppl = [plan.client, plan.spouse].filter(Boolean);
  const ret = Math.max(...ppl.map((x) => x.birthYear + x.retirementAge));
  const rmd = Math.min(...ppl.map((x) => x.birthYear + rmdStartAge(x.birthYear)));
  return {
    withdrawalOrder: "conventional",
    fillBracket: 0.12,
    roth: { enabled: false, bracket: 0.22, startYear: Math.max(THIS_YEAR, ret), endYear: Math.max(THIS_YEAR, rmd - 1), respectIrmaa: true },
    spending: { policy: "fixed", band: 0.2, adjust: 0.1 }
  };
}
function normalizePlan(raw) {
  const client = normalizePerson(raw.client, raw.client.sex ?? "M");
  const spouse = raw.spouse ? normalizePerson(raw.spouse, raw.spouse.sex ?? (client.sex === "M" ? "F" : "M")) : null;
  const base = { client, spouse };
  const strategy = raw.strategy ?? defaultStrategy(base);
  return {
    ...raw,
    client,
    spouse,
    accounts: raw.accounts.map((a) => ({ ...a, basis: a.basis ?? (a.type === "taxable" ? Math.round(a.balance * 0.7) : a.balance) })),
    income: raw.income ?? [],
    inflows: raw.inflows ?? [],
    otherAssets: raw.otherAssets ?? [],
    liabilities: raw.liabilities ?? [],
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...raw.assumptions },
    strategy: { ...defaultStrategy(base), ...strategy, roth: { ...defaultStrategy(base).roth, ...strategy.roth }, spending: { ...defaultStrategy(base).spending, ...strategy.spending } },
    riskAnswers: raw.riskAnswers ?? [2, 2, 2, 2, 2]
  };
}
function samplePlanThompson() {
  const client = {
    firstName: "Michael",
    lastName: "Thompson",
    birthYear: THIS_YEAR - 56,
    retirementAge: 65,
    acceptableRetirementAge: 67,
    planningAge: 92,
    salary: 185e3,
    ssPia: 3450,
    ssClaimAge: 67
  };
  const spouse = {
    firstName: "Sarah",
    lastName: "Thompson",
    birthYear: THIS_YEAR - 54,
    retirementAge: 63,
    acceptableRetirementAge: 65,
    planningAge: 95,
    salary: 95e3,
    ssPia: 2280,
    ssClaimAge: 67
  };
  const plan = normalizePlan({
    client,
    spouse,
    accounts: [
      { id: uid(), name: "Michael's 401(k)", owner: "client", type: "deferred", balance: 845e3, annualSavings: 31e3, savingsIncrease: 0.02 },
      { id: uid(), name: "Sarah's 403(b)", owner: "spouse", type: "deferred", balance: 312e3, annualSavings: 18e3, savingsIncrease: 0.02 },
      { id: uid(), name: "Michael's Roth IRA", owner: "client", type: "roth", balance: 96e3, annualSavings: 0, savingsIncrease: 0 },
      { id: uid(), name: "Joint Brokerage", owner: "joint", type: "taxable", balance: 228e3, annualSavings: 12e3, savingsIncrease: 0 },
      { id: uid(), name: "Savings & Checking", owner: "joint", type: "cash", balance: 6e4, annualSavings: 0, savingsIncrease: 0 }
    ],
    goals: [],
    income: [
      { id: uid(), name: "Sarah's Teacher Pension", owner: "spouse", annualAmount: 14e3, startAge: 63, endAge: 0, cola: true, survivorPct: 50 }
    ],
    otherAssets: [
      { id: uid(), name: "Primary Residence", kind: "home", value: 72e4 },
      { id: uid(), name: "Vehicles", kind: "personal", value: 45e3 }
    ],
    liabilities: [
      { id: uid(), name: "Mortgage", balance: 238e3, rate: 0.0375, monthlyPayment: 2450 }
    ],
    assumptions: { inflation: 0.025, fees: 6e-3, preRetPortfolio: 4, postRetPortfolio: 3, ssReduction: false },
    riskAnswers: [2, 2, 2, 2, 2]
  });
  const g = (t, over) => ({ ...newGoal(t, plan), ...over });
  plan.goals = [
    g("retirement", { amount: 118e3, acceptable: 104e3, survivorPct: 75 }),
    g("healthcare", { amount: 22e3, acceptable: 18e3, years: 2 }),
    g("college", { name: "Emma's College", amount: 38e3, acceptable: 28e3, startYear: THIS_YEAR + 1, years: 4, priority: 9 }),
    g("travel", { name: "Travel the World", amount: 15e3, acceptable: 1e4, years: 12, priority: 6 }),
    g("car", { name: "Replace Cars", amount: 45e3, acceptable: 35e3, startYear: THIS_YEAR + 2, repeatEvery: 7, priority: 5 }),
    g("purchase", { name: "Lake House Down Payment", amount: 12e4, acceptable: 8e4, startYear: client.birthYear + 66, priority: 3 }),
    g("legacy", { name: "Legacy for Children", amount: 2e5, acceptable: 1e5, priority: 2 })
  ];
  plan.client.sex = "M";
  plan.spouse.sex = "F";
  plan.client.lifeInsurance = 75e4;
  plan.spouse.lifeInsurance = 25e4;
  plan.assumptions.stateRate = 0.0495;
  plan.accounts.find((a) => a.type === "taxable").basis = 151e3;
  return plan;
}
function samplePlanRivera() {
  const client = {
    firstName: "Daniela",
    lastName: "Rivera",
    birthYear: THIS_YEAR - 38,
    retirementAge: 63,
    acceptableRetirementAge: 65,
    planningAge: 95,
    salary: 142e3,
    ssPia: 3100,
    ssClaimAge: 67
  };
  const plan = normalizePlan({
    client,
    spouse: null,
    accounts: [
      { id: uid(), name: "401(k)", owner: "client", type: "deferred", balance: 186e3, annualSavings: 24500, savingsIncrease: 0.03 },
      { id: uid(), name: "Roth IRA", owner: "client", type: "roth", balance: 52e3, annualSavings: 7e3, savingsIncrease: 0 },
      { id: uid(), name: "Brokerage", owner: "client", type: "taxable", balance: 41e3, annualSavings: 6e3, savingsIncrease: 0.02 },
      { id: uid(), name: "Emergency Fund", owner: "client", type: "cash", balance: 3e4, annualSavings: 0, savingsIncrease: 0 }
    ],
    goals: [],
    income: [],
    otherAssets: [{ id: uid(), name: "Condo", kind: "home", value: 41e4 }],
    liabilities: [
      { id: uid(), name: "Mortgage", balance: 298e3, rate: 0.061, monthlyPayment: 2180 },
      { id: uid(), name: "Auto Loan", balance: 14e3, rate: 0.049, monthlyPayment: 420 }
    ],
    assumptions: { inflation: 0.025, fees: 6e-3, preRetPortfolio: 5, postRetPortfolio: 3, ssReduction: true },
    riskAnswers: [4, 3, 3, 3, 3]
  });
  const g = (t, over) => ({ ...newGoal(t, plan), ...over });
  plan.goals = [
    g("retirement", { amount: 66e3, acceptable: 58e3, survivorPct: 100 }),
    g("healthcare", { amount: 14e3, acceptable: 11e3, years: 3 }),
    g("purchase", { name: "Upgrade to a House", amount: 11e4, acceptable: 8e4, startYear: THIS_YEAR + 4, priority: 7 }),
    g("travel", { name: "Annual Travel", amount: 9e3, acceptable: 6e3, years: 15, priority: 5 })
  ];
  plan.client.sex = "F";
  plan.client.health = "excellent";
  plan.client.lifeInsurance = 0;
  plan.assumptions.stateRate = 0;
  plan.accounts.find((a) => a.type === "taxable").basis = 33e3;
  return plan;
}
function samplePlanChen() {
  const client = {
    firstName: "Robert",
    lastName: "Chen",
    birthYear: THIS_YEAR - 66,
    retirementAge: 66,
    acceptableRetirementAge: 66,
    planningAge: 93,
    salary: 0,
    ssPia: 3800,
    ssClaimAge: 70
  };
  const spouse = {
    firstName: "Linda",
    lastName: "Chen",
    birthYear: THIS_YEAR - 64,
    retirementAge: 64,
    acceptableRetirementAge: 66,
    planningAge: 95,
    salary: 0,
    ssPia: 1900,
    ssClaimAge: 67
  };
  const plan = normalizePlan({
    client,
    spouse,
    accounts: [
      { id: uid(), name: "Rollover IRA", owner: "client", type: "deferred", balance: 165e4, annualSavings: 0, savingsIncrease: 0 },
      { id: uid(), name: "Linda's IRA", owner: "spouse", type: "deferred", balance: 42e4, annualSavings: 0, savingsIncrease: 0 },
      { id: uid(), name: "Roth IRAs", owner: "joint", type: "roth", balance: 18e4, annualSavings: 0, savingsIncrease: 0 },
      { id: uid(), name: "Trust Brokerage", owner: "joint", type: "taxable", balance: 64e4, annualSavings: 0, savingsIncrease: 0 },
      { id: uid(), name: "Money Market", owner: "joint", type: "cash", balance: 12e4, annualSavings: 0, savingsIncrease: 0 }
    ],
    goals: [],
    income: [],
    otherAssets: [
      { id: uid(), name: "Home", kind: "home", value: 125e4 },
      { id: uid(), name: "Rental Property", kind: "property", value: 48e4 }
    ],
    liabilities: [],
    assumptions: { inflation: 0.025, fees: 7e-3, preRetPortfolio: 3, postRetPortfolio: 3, ssReduction: false },
    riskAnswers: [2, 3, 2, 1, 2]
  });
  const g = (t, over) => ({ ...newGoal(t, plan), ...over });
  plan.goals = [
    g("retirement", { amount: 108e3, acceptable: 95e3, survivorPct: 75 }),
    g("travel", { name: "Travel", amount: 25e3, acceptable: 15e3, years: 10, priority: 7 }),
    g("other", { name: "Gifts to Grandchildren", amount: 18e3, acceptable: 1e4, startYear: THIS_YEAR, years: 15, priority: 4 }),
    g("legacy", { name: "Charitable Bequest", amount: 3e5, acceptable: 15e4, priority: 3 })
  ];
  plan.client.sex = "M";
  plan.spouse.sex = "F";
  plan.spouse.health = "excellent";
  plan.assumptions.stateRate = 0.093;
  plan.accounts.find((a) => a.type === "taxable").basis = 41e4;
  plan.inflows = [{ id: uid(), name: "Sell Rental Property", year: THIS_YEAR + 4, amount: 48e4, gainPct: 0.55 }];
  plan.otherAssets = plan.otherAssets.filter((a) => a.kind !== "property");
  return plan;
}
var DAY = 864e5;
function sampleHouseholds() {
  const now = Date.now();
  return [
    {
      id: uid(),
      name: "Michael & Sarah Thompson",
      updated: now,
      current: samplePlanThompson(),
      recommended: null,
      notes: "",
      reviews: [{ date: now - DAY * 380, probability: 74, note: "Annual review" }, { date: now - DAY * 190, probability: 69, note: "Added lake house goal" }]
    },
    {
      id: uid(),
      name: "Daniela Rivera",
      updated: now - DAY * 3,
      current: samplePlanRivera(),
      recommended: null,
      notes: "",
      reviews: [{ date: now - DAY * 240, probability: 71, note: "Initial plan" }]
    },
    {
      id: uid(),
      name: "Robert & Linda Chen",
      updated: now - DAY * 11,
      current: samplePlanChen(),
      recommended: null,
      notes: "",
      reviews: [{ date: now - DAY * 400, probability: 93, note: "Retirement transition" }]
    }
  ];
}
export {
  normalizePlan,
  probability,
  sampleHouseholds,
  simulate
};
