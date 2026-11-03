"""Train the glass brain and save snapshots of it as it learns.

Writes web/data/brain.json: final weights, ~50 checkpoints from random init to trained,
the feature spec, and test accuracy at each checkpoint.
"""
import json, math, time
import numpy as np
import torch
import torch.nn as nn
from sim import FEATURES, encode

torch.manual_seed(7)
SIZES = [8, 24, 24, 12, 3]
EPOCHS = 45
BATCH = 512
L1 = 2e-6


def targets(y):
    p, leg, by = y[:, 0], y[:, 1], y[:, 2]
    leg_n = (np.log10(np.maximum(leg, 0) + 1e4) - 4) / 3.3
    by_n = np.log1p(by) / 3
    return np.stack([p, leg_n, by_n], 1).astype(np.float32)


class Brain(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.ModuleList(nn.Linear(a, b) for a, b in zip(SIZES, SIZES[1:]))

    def forward(self, x):
        for i, l in enumerate(self.layers):
            x = l(x)
            if i < len(self.layers) - 1:
                x = torch.relu(x)
        return x


def loss_fn(out, t):
    bce = nn.functional.binary_cross_entropy_with_logits(out[:, 0], t[:, 0])
    return bce + 2 * ((out[:, 1] - t[:, 1]) ** 2).mean() + 2 * ((out[:, 2] - t[:, 2]) ** 2).mean()


def snapshot(model):
    return [{"W": np.round(l.weight.detach().numpy(), 4).tolist(),
             "b": np.round(l.bias.detach().numpy(), 4).tolist()} for l in model.layers]


def main():
    tr, te = np.load("train/data_train.npz"), np.load("train/data_test.npz")
    Xtr, Ttr = torch.tensor(encode(tr["raw"])), torch.tensor(targets(tr["y"]))
    Xte, Tte = torch.tensor(encode(te["raw"])), torch.tensor(targets(te["y"]))
    model = Brain()
    opt = torch.optim.Adam(model.parameters(), lr=3e-3)
    steps_per = math.ceil(len(Xtr) / BATCH)
    total = EPOCHS * steps_per
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=4e-3, total_steps=total, pct_start=0.05)
    # Log-spaced checkpoints so the fast early learning gets as many frames as the slow polish.
    marks = sorted(set([0] + [int(round(x)) for x in np.geomspace(1, total, 56)]))
    ckpts = []

    def evaluate(step):
        with torch.no_grad():
            o = model(Xte)
            mae = (torch.sigmoid(o[:, 0]) - Tte[:, 0]).abs().mean().item()
        ckpts.append({"step": step, "mae": round(mae, 5), "layers": snapshot(model)})
        return mae

    step = 0
    evaluate(0)
    t0 = time.time()
    for ep in range(EPOCHS):
        perm = torch.randperm(len(Xtr))
        for i in range(steps_per):
            idx = perm[i * BATCH:(i + 1) * BATCH]
            out = model(Xtr[idx])
            loss = loss_fn(out, Ttr[idx]) + L1 * sum(l.weight.abs().sum() for l in model.layers)
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
            step += 1
            if step in marks:
                evaluate(step)
        print(f"epoch {ep + 1:2d}  loss {loss.item():.4f}  test MAE {ckpts[-1]['mae'] * 100:.2f} pts  {time.time() - t0:.0f}s", flush=True)

    torch.save(model.state_dict(), "train/brain.pt")
    spec = [{"name": n, "lo": lo, "hi": hi, "scale": sc} for n, lo, hi, sc in FEATURES]
    out = {"sizes": SIZES, "features": spec, "final": snapshot(model),
           "checkpoints": ckpts, "totalSteps": total, "trainExamples": int(len(Xtr)),
           "pathsPerExample": 256}
    json.dump(out, open("web/data/brain.json", "w"), separators=(",", ":"))
    print("saved; final MAE", ckpts[-1]["mae"])


if __name__ == "__main__":
    main()
