"""Train Roth Autopilot: a network that outputs a household's optimal Roth conversion schedule in one pass.

Targets are exact optima from gradient descent through the compiled tax network (train/rothdata.mjs).
Inputs: age, IRA, Social Security, other income, heirs' tax rate, spending draw, growth.
Outputs: 17 yearly conversions as fractions of today's IRA. Writes web/data/rothpolicy.json.
The real test is in dollars: train/roth_eval.mjs runs each predicted schedule through the exact model.
"""
import json, math, time
import numpy as np
import torch
import torch.nn as nn

torch.manual_seed(5)
D = json.load(open("train/roth_data.json"))
K = D["K"]
P = np.array([r["p"] for r in D["rows"]], dtype=np.float64)
C = np.array([r["conv"] for r in D["rows"]], dtype=np.float64)


def encode(P):
    age, ira, ss, other, heir, draw, growth = P.T
    return np.stack([
        (age - 67) / 7, (np.log(ira) - np.log(700_000)) / 1.5, ss / 50_000 - 1, other / 60_000 - 1,
        heir / 0.2 - 1, (draw / ira) / 0.03 - 1, (growth - 0.0475) / 0.0175,
    ], 1).astype(np.float32)


X = encode(P)
Y = (C / P[:, 1:2]).astype(np.float32)  # conversions as a fraction of today's IRA
n = len(X)
idx = np.random.default_rng(1).permutation(n)
te, tr = idx[:2000], idx[2000:]
Xtr, Ytr, Xte, Yte = map(torch.tensor, (X[tr], Y[tr], X[te], Y[te]))

net = nn.Sequential(nn.Linear(7, 160), nn.SiLU(), nn.Linear(160, 160), nn.SiLU(), nn.Linear(160, 96), nn.SiLU(), nn.Linear(96, K), nn.Softplus())
opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-5)
EP, BS = 300, 256
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=EP * math.ceil(len(Xtr) / BS), pct_start=0.05)
t0 = time.time()
for ep in range(EP):
    perm = torch.randperm(len(Xtr))
    for i in range(0, len(Xtr), BS):
        b = perm[i:i + BS]
        loss = ((net(Xtr[b]) - Ytr[b]) ** 2).mean()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    if (ep + 1) % 50 == 0:
        with torch.no_grad():
            e = (net(Xte) - Yte).abs().mean().item()
        print(f"epoch {ep + 1}  mean |error| {e * 100:.2f}% of IRA per year  {time.time() - t0:.0f}s", flush=True)

lin = [m for m in net if isinstance(m, nn.Linear)]
json.dump({"engine": D.get("engine"), "K": K, "layers": [{"W": np.round(l.weight.detach().numpy(), 5).tolist(), "b": np.round(l.bias.detach().numpy(), 5).tolist()} for l in lin],
           "test": te.tolist()[:400], "examples": int(n)}, open("web/data/rothpolicy.json", "w"), separators=(",", ":"))
print("saved")
