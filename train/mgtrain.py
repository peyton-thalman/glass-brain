"""Train the MoneyGuide Brain: a neural surrogate of the real MoneyGuide planning engine.

Input: ten facts about a retired couple (ages, IRA/Roth/taxable balances, spending, Social Security, claim age,
portfolio, state tax). Target: the engine's probability of success (500-trial Monte Carlo under 2026 tax law,
RMDs, IRMAA, Social Security rules). SiLU activations keep the brain smooth, so its gradients, like what an extra
dollar in each account is worth, are meaningful. Writes web/data/mgbrain.json.
"""
import json, math, time
import numpy as np
import torch
import torch.nn as nn

torch.manual_seed(11)
D = json.load(open("train/mg_data.json"))
rows = np.array(D["rows"], dtype=np.float64)
names = D["features"]
SPEC = {  # how each fact is encoded to [-1, 1]
    "age": ("lin", 60, 75), "spouseGap": ("lin", -6, 2),
    "ira": ("log", 0, 4_000_000), "roth": ("log", 0, 1_500_000), "taxable": ("log", 0, 2_000_000),
    "spending": ("log", 40_000, 220_000), "pia": ("lin", 1_000, 4_200), "claimAge": ("lin", 62, 70),
    "portfolio": ("lin", 1, 6), "stateRate": ("lin", 0, 0.093),
}
LOG_K = 100_000.0  # log scale: log1p(x / 100k)


def enc(col, name):
    kind, lo, hi = SPEC[name]
    if kind == "log":
        f = lambda v: np.log1p(np.maximum(v, 0) / LOG_K)
        return 2 * (f(col) - f(lo)) / (f(hi) - f(lo)) - 1
    return 2 * (col - lo) / (hi - lo) - 1


X = np.stack([enc(rows[:, i], n) for i, n in enumerate(names)], 1).astype(np.float32)
p = (rows[:, len(names)] / 100).astype(np.float32)
legacy = rows[:, len(names) + 2]
leg = (np.log10(np.maximum(legacy, 0) + 1e4) - 4) / 3.5
Y = np.stack([p, leg], 1).astype(np.float32)
n = len(X)
idx = np.random.default_rng(0).permutation(n)
te, tr = idx[: n // 20], idx[n // 20:]
Xtr, Ytr, Xte, Yte = map(torch.tensor, (X[tr], Y[tr], X[te], Y[te]))
print(f"{n:,} plans; success mean {p.mean():.2f}, quartiles {np.percentile(p, [25, 50, 75])}")

SIZES = [len(names), 64, 64, 32, 2]
layers = []
for a, b in zip(SIZES, SIZES[1:]):
    layers += [nn.Linear(a, b), nn.SiLU()]
net = nn.Sequential(*layers[:-1])
opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
EPOCHS, BS = 260, 512
steps = EPOCHS * math.ceil(len(Xtr) / BS)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=steps, pct_start=0.05)
t0 = time.time()
for ep in range(EPOCHS):
    perm = torch.randperm(len(Xtr))
    for i in range(0, len(Xtr), BS):
        b = perm[i:i + BS]
        o = net(Xtr[b])
        loss = nn.functional.binary_cross_entropy_with_logits(o[:, 0], Ytr[b, 0]) + ((o[:, 1] - Ytr[b, 1]) ** 2).mean()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    if (ep + 1) % 20 == 0:
        with torch.no_grad():
            o = net(Xte)
            mae = (torch.sigmoid(o[:, 0]) - Yte[:, 0]).abs().mean().item() * 100
        print(f"epoch {ep + 1:3d}  test error {mae:.2f} pts  {time.time() - t0:.0f}s", flush=True)

with torch.no_grad():
    o = net(Xte)
    err = (torch.sigmoid(o[:, 0]) - Yte[:, 0]).abs() * 100
lin = [m for m in net if isinstance(m, nn.Linear)]
out = {
    "features": [{"name": n_, "kind": SPEC[n_][0], "lo": SPEC[n_][1], "hi": SPEC[n_][2]} for n_ in names],
    "logK": LOG_K, "sizes": SIZES, "activation": "silu",
    "layers": [{"W": np.round(l.weight.detach().numpy(), 5).tolist(), "b": np.round(l.bias.detach().numpy(), 5).tolist()} for l in lin],
    "stats": {"plans": int(n), "trials": D["trials"], "testMAE": float(err.mean()), "testP90": float(err.quantile(0.9))},
}
json.dump(out, open("web/data/mgbrain.json", "w"), separators=(",", ":"))
print(out["stats"])
