"""Retirement Monte Carlo on the GPU. Generates the lives the brain learns from.

Every training example is one client. For each client we simulate PATHS possible
futures (markets + lifespan) and record what fraction of them never ran out of money.
The web app runs the same model in JS (web/sim.js) to draw the lifelines, so keep the
two in step.
"""
import math, json, sys, time
import numpy as np
import torch

DEV = "mps" if torch.backends.mps.is_available() else "cpu"
MAX_AGE = 110

# Market model, real (after-inflation) annual returns.
STOCK_MU, STOCK_SD = 0.065, 0.17
BOND_MU, BOND_SD = 0.018, 0.065
CORR = 0.10
EARLY_YEARS = 5

# Gompertz mortality: modal age of death 88, dispersion 9.5. Health shifts the mode +/-5y.
MODE, DISP = 88.0, 9.5

# Feature spec: name, low, high, scale. The net sees each feature mapped to [-1, 1].
FEATURES = [
    ("age",       55,     80,      "lin"),
    ("portfolio", 150e3,  6e6,     "log"),
    ("spending",  25e3,   300e3,   "log"),
    ("income",    0,      90e3,    "lin"),   # Social Security + pensions, real $/yr
    ("equity",    0,      1,       "lin"),
    ("early",     -0.12,  0.16,    "lin"),   # stock real return, avg of first 5 years
    ("flex",      0,      0.30,    "lin"),   # max spending cut in a downturn
    ("health",    -1,     1,       "lin"),
]


def encode(raw):
    """raw: (N, 8) array of real-world values -> (N, 8) in [-1, 1]."""
    out = np.empty_like(raw, dtype=np.float32)
    for i, (_, lo, hi, sc) in enumerate(FEATURES):
        x = raw[:, i]
        if sc == "log":
            x, lo, hi = np.log(x), math.log(lo), math.log(hi)
        out[:, i] = 2 * (x - lo) / (hi - lo) - 1
    return out


def sample_clients(n, rng):
    age = rng.uniform(55, 80, n)
    port = np.exp(rng.uniform(math.log(150e3), math.log(6e6), n))
    income = rng.uniform(0, 90e3, n) * (rng.random(n) > 0.08)
    # Draw the withdrawal rate so labels span ruin to rock-solid, then derive spending.
    wr = np.exp(rng.uniform(math.log(0.022), math.log(0.17), n))
    spend = np.clip(income + wr * port, 25e3, 300e3)
    equity = rng.uniform(0, 1, n)
    early = rng.uniform(-0.12, 0.16, n)
    flex = rng.uniform(0, 0.30, n) * (rng.random(n) > 0.15)
    health = rng.uniform(-1, 1, n)
    return np.stack([age, port, spend, income, equity, early, flex, health], 1)


@torch.no_grad()
def simulate(raw, paths, gen, return_paths=False):
    """raw: (N, 8) numpy. Returns success prob, median legacy, expected broke years."""
    t = torch.tensor(raw, dtype=torch.float32, device=DEV)
    age, port, spend, income, equity, early, flex, health = t.T
    N = t.shape[0]
    Y = int(MAX_AGE - 55)

    # Lifespan: invert the conditional Gompertz survival curve.
    mode = MODE + 5 * health
    u = torch.rand(N, paths, device=DEV, generator=gen).clamp_min(1e-7)
    k = torch.exp((age - mode) / DISP)[:, None]
    years_left = DISP * torch.log1p(-torch.log(u) / k)
    death = (age[:, None] + years_left).clamp(max=MAX_AGE)

    z1 = torch.randn(N, paths, Y, device=DEV, generator=gen)
    z2 = torch.randn(N, paths, Y, device=DEV, generator=gen)
    zb = CORR * z1 + math.sqrt(1 - CORR**2) * z2
    stock = STOCK_MU + STOCK_SD * z1
    # Pin the first five years' average to the client's "early" scenario.
    e = stock[:, :, :EARLY_YEARS]
    stock[:, :, :EARLY_YEARS] = e - e.mean(2, keepdim=True) + early[:, None, None]
    bond = BOND_MU + BOND_SD * zb
    eq = equity[:, None, None]
    ret = (eq * stock + (1 - eq) * bond).clamp_min(-0.95)

    w = port[:, None].expand(N, paths).clone()
    w0 = w.clone()
    ok = torch.ones(N, paths, dtype=torch.bool, device=DEV)
    broke_years = torch.zeros(N, paths, device=DEV)
    legacy = torch.zeros(N, paths, device=DEV)
    need = (spend - income).clamp_min(0)[:, None]
    hist = [w.clone()] if return_paths else None
    for y in range(Y):
        a = age[:, None] + y
        alive = a < death
        # Guardrail: cut spending by up to `flex` as the portfolio falls toward 60% of start.
        dd = ((1 - w / w0) / 0.4).clamp(0, 1)
        draw = need * (1 - flex[:, None] * dd)
        w = torch.where(alive, (w - draw) * (1 + ret[:, :, y]), w)
        dead_now = alive & (a + 1 >= death)
        broke = alive & (w <= 0)
        ok &= ~broke
        broke_years += broke.float() * (need > 0).float()
        w = w.clamp_min(0)
        legacy = torch.where(dead_now, w, legacy)
        if return_paths:
            hist.append(torch.where(alive, w, torch.full_like(w, float("nan"))))
    p = ok.float().mean(1)
    leg = legacy.median(1).values
    by = broke_years.mean(1)
    if return_paths:
        return p, leg, by, torch.stack(hist, 2), death
    return p, leg, by


def build(n, paths, seed, chunk=2048):
    rng = np.random.default_rng(seed)
    gen = torch.Generator(device=DEV).manual_seed(seed)
    raw = sample_clients(n, rng)
    ys = []
    t0 = time.time()
    for i in range(0, n, chunk):
        p, leg, by = simulate(raw[i:i + chunk], paths, gen)
        ys.append(torch.stack([p, leg, by], 1).cpu().numpy())
        if (i // chunk) % 20 == 0:
            print(f"  {i + chunk:>7}/{n}  {time.time() - t0:5.1f}s", flush=True)
    return raw, np.concatenate(ys)


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200_000
    print(f"device={DEV}")
    print("train set"); raw, y = build(n, 256, seed=1)
    np.savez_compressed("train/data_train.npz", raw=raw, y=y)
    print("test set (1024 paths each)"); raw, y = build(4000, 1024, seed=2, chunk=256)
    np.savez_compressed("train/data_test.npz", raw=raw, y=y)
    print("done")
