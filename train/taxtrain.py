"""Train the Tax Brain on 3M returns from the 2026 tax engine.

One hidden layer of ReLU hinges, so the brain is literally a sum of hinges:
    tax(x) = c + sum_j v_j * relu(w_j . x + b_j)
Each hinge bends the tax curve at one place. Sobolev training (match the tax AND its slope, the marginal
rate) pushes the bends onto the exact dollar amounts where the law's marginal rate changes.

A second small brain learns the Medicare IRMAA surcharge, a staircase of cliffs.
Writes web/data/taxbrain.json.
"""
import json, os, sys, time
import numpy as np
import torch
import torch.nn as nn

torch.manual_seed(3)
RANGE = {"ord": 600_000, "ss": 100_000, "ltcg": 300_000}
TAX_SCALE = 10_000


TAG = sys.argv[4] if len(sys.argv) > 4 else ""  # law variant, e.g. "no-senior" for the audit's vendor brain


def load(name):
    pre = f"train/tax_{TAG}_" if TAG else "train/tax_"
    X = np.fromfile(f"{pre}{name}_X.f32", dtype=np.float32).reshape(-1, 3)
    Y = np.fromfile(f"{pre}{name}_Y.f32", dtype=np.float32).reshape(-1, 3)
    return torch.tensor(X), torch.tensor(Y)


class Hinges(nn.Module):
    def __init__(self, h, X):
        super().__init__()
        self.l1 = nn.Linear(3, h)
        self.l2 = nn.Linear(h, 1)
        with torch.no_grad():
            # Data-driven init: every hinge starts out passing through a real return, so none start dead.
            w = torch.randn(h, 3)
            w[:, 0] = w[:, 0].abs() + 0.5  # tax only rises with income; let hinges open upward in ordinary income
            self.l1.weight.copy_(w)
            pts = X[torch.randint(len(X), (h,))]
            self.l1.bias.copy_(-(w * pts).sum(1))
            self.l2.weight.mul_(0.1)

    def forward(self, x):
        return self.l2(torch.relu(self.l1(x))).squeeze(-1)


def train_tax(Xtr, Ytr, Xte, Yte, h, epochs, lam):
    m = Hinges(h, Xtr)
    opt = torch.optim.Adam(m.parameters(), lr=3e-3)
    bs = 4096
    steps = epochs * (len(Xtr) // bs)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=6e-3, total_steps=steps, pct_start=0.05)
    to_marg = TAX_SCALE / RANGE["ord"]  # d(out)/d(x_ord) -> dollars of tax per dollar of income
    t0 = time.time()
    for ep in range(epochs):
        perm = torch.randperm(len(Xtr))
        for i in range(len(Xtr) // bs):
            idx = perm[i * bs:(i + 1) * bs]
            x = Xtr[idx].clone().requires_grad_(True)
            y = Ytr[idx]
            out = m(x)
            g = torch.autograd.grad(out.sum(), x, create_graph=True)[0][:, 0] * to_marg
            loss = ((out - y[:, 0] / TAX_SCALE) ** 2).mean() + lam * ((g - y[:, 1]) ** 2).mean()
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        with torch.no_grad():
            err = (m(Xte) * TAX_SCALE - Yte[:, 0]).abs()
        print(f"  tax epoch {ep + 1:2d}  mean error ${err.mean():,.0f}  p95 ${err.quantile(0.95):,.0f}  {time.time() - t0:.0f}s", flush=True)
    return m


def train_irmaa(Xtr, Ytr, Xte, Yte, h, epochs):
    m = Hinges(h, Xtr)
    opt = torch.optim.Adam(m.parameters(), lr=3e-3)
    bs = 4096
    steps = epochs * (len(Xtr) // bs)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=8e-3, total_steps=steps, pct_start=0.05)
    for ep in range(epochs):
        perm = torch.randperm(len(Xtr))
        for i in range(len(Xtr) // bs):
            idx = perm[i * bs:(i + 1) * bs]
            loss = ((m(Xtr[idx]) - Ytr[idx, 2] / TAX_SCALE) ** 2).mean()
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        with torch.no_grad():
            err = (m(Xte) * TAX_SCALE - Yte[:, 2]).abs()
        print(f"  irmaa epoch {ep + 1:2d}  mean error ${err.mean():,.0f}", flush=True)
    return m


def dump(m):
    return {"W1": np.round(m.l1.weight.detach().numpy(), 6).tolist(), "b1": np.round(m.l1.bias.detach().numpy(), 6).tolist(),
            "W2": np.round(m.l2.weight.detach().numpy()[0], 6).tolist(), "b2": round(float(m.l2.bias.detach()[0]), 6)}


if __name__ == "__main__":
    H = int(sys.argv[1]) if len(sys.argv) > 1 else 48
    EP = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    LAM = float(sys.argv[3]) if len(sys.argv) > 3 else 3.0
    Xtr, Ytr = load("train"); Xte, Yte = load("test")
    print(f"tax brain: {H} hinges, {EP} epochs, slope weight {LAM}")
    tax = train_tax(Xtr, Ytr, Xte, Yte, H, EP, LAM)
    if TAG:
        irm = tax
    else:
        print("irmaa brain: 24 hinges")
        irm = train_irmaa(Xtr, Ytr, Xte, Yte, 24, max(6, EP // 2))
    with torch.no_grad():
        e_tax = (tax(Xte) * TAX_SCALE - Yte[:, 0]).abs()
        e_irm = (irm(Xte) * TAX_SCALE - Yte[:, 2]).abs()
    meta = f"train/tax_{TAG}_meta.json" if TAG else "train/tax_meta.json"
    engine = json.load(open(meta))["engine"] if os.path.exists(meta) else None
    out = {"engine": engine, "range": RANGE, "taxScale": TAX_SCALE, "tax": dump(tax), "irmaa": dump(irm),
           "stats": {"trainReturns": len(Xtr), "taxMeanErr": float(e_tax.mean()), "taxP95Err": float(e_tax.quantile(0.95)),
                     "irmaaMeanErr": float(e_irm.mean())}}
    if TAG:
        out.pop("irmaa")
        json.dump(out, open(f"web/data/taxbrain_{TAG}.json", "w"))
    else:
        json.dump(out, open("web/data/taxbrain.json", "w"))
        torch.save({"tax": tax.state_dict(), "irmaa": irm.state_dict()}, "train/taxbrain.pt")
    print(json.dumps(out["stats"], indent=1))
