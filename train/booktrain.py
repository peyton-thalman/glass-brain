"""Train the Book Brain: one network that reads a whole household (34 facts) and answers seven questions at once.

Targets are the planning engine's probability of success for the plan as it is and under six life events
(either spouse dying, three years of care, another crash, the 2033 Social Security cut, hotter inflation), each a
300-trial Monte Carlo labeled by the Household X-ray's own code (train/bookdata.mjs). Singles have no spouse-death
labels; those are masked out of the loss. SiLU keeps the network smooth so its gradients can explain a household.
Writes web/data/bookbrain.json.
"""
import json, math, sys, time
import numpy as np
import torch
import torch.nn as nn

torch.manual_seed(5)
# python3 train/booktrain.py [data files…]; the extra file holds households scored after a market drop.
FILES = sys.argv[1:] or ["train/book_data.json", "train/book_data_shock.json"]
Ds = [json.load(open(f)) for f in FILES]
D = {"heads": Ds[0]["heads"], "trials": Ds[0]["trials"], "rows": [r for d in Ds for r in d["rows"]]}
X = np.array([r[0] for r in D["rows"]], dtype=np.float32)
Y = np.array([r[1] for r in D["rows"]], dtype=np.float32)
M = (Y >= 0).astype(np.float32)
Y = np.clip(Y, 0, 100) / 100
n, d = X.shape
H = Y.shape[1]
idx = np.random.default_rng(0).permutation(n)
te, tr = idx[: n // 20], idx[n // 20:]
T = lambda a: torch.tensor(a)
Xtr, Ytr, Mtr, Xte, Yte, Mte = T(X[tr]), T(Y[tr]), T(M[tr]), T(X[te]), T(Y[te]), T(M[te])
print(f"{n:,} households, {d} facts, {H} heads; base success median {np.median(Y[:, 0]):.2f}")

SIZES = [d, 128, 128, 64, H]
layers = []
for a, b in zip(SIZES, SIZES[1:]):
    layers += [nn.Linear(a, b), nn.SiLU()]
net = nn.Sequential(*layers[:-1])
EPOCHS, BS = 300, 512
opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
steps = EPOCHS * math.ceil(len(Xtr) / BS)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=steps, pct_start=0.05)


def error(Xs, Ys, Ms):
    with torch.no_grad():
        e = (torch.sigmoid(net(Xs)) - Ys).abs() * 100 * Ms
        return (e.sum(0) / Ms.sum(0)).numpy(), e


t0 = time.time()
for ep in range(EPOCHS):
    perm = torch.randperm(len(Xtr))
    for i in range(0, len(Xtr), BS):
        b = perm[i:i + BS]
        o = net(Xtr[b])
        loss = (nn.functional.binary_cross_entropy_with_logits(o, Ytr[b], reduction="none") * Mtr[b]).sum() / Mtr[b].sum()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    if (ep + 1) % 20 == 0:
        mae, _ = error(Xte, Yte, Mte)
        print(f"epoch {ep + 1:3d}  test error by head {np.round(mae, 2)}  {time.time() - t0:.0f}s", flush=True)

mae, e = error(Xte, Yte, Mte)
base_err = e[:, 0]
lin = [m for m in net if isinstance(m, nn.Linear)]
out = {
    "heads": D["heads"], "sizes": SIZES, "activation": "silu",
    "layers": [{"W": np.round(l.weight.detach().numpy(), 5).tolist(), "b": np.round(l.bias.detach().numpy(), 5).tolist()} for l in lin],
    "stats": {
        "households": int(n), "trials": D["trials"], "testHouseholds": int(len(te)),
        "testMAE": [float(x) for x in mae], "baseP90": float(base_err.quantile(0.9)), "baseP99": float(base_err.quantile(0.99)),
    },
}
json.dump(out, open("web/data/bookbrain.json", "w"), separators=(",", ":"))
print(out["stats"])
