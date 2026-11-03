"""Read the trained brain: what does each hidden neuron respond to, and what does it do?

For every hidden neuron we measure
  - how often it fires, and its correlation with human concepts (withdrawal rate, horizon...)
  - its vote: how the success estimate moves when the neuron is silenced
  - its share of each instinct: how much of the brain's sensitivity to a feature
    (early markets, health, flexibility, stocks, age) disappears when it's silenced.
Writes web/data/probe.json, which the app and the surgery challenges use.
"""
import json
import numpy as np
import torch
from sim import sample_clients, encode, MODE
from train import Brain, SIZES

FEAT = ["age", "portfolio", "spending", "income", "equity", "early", "flex", "health"]
INSTINCTS = ["early", "health", "flex", "equity", "age", "income"]


def concepts(raw):
    age, port, spend, income, equity, early, flex, health = raw.T
    need = np.maximum(spend - income, 0)
    wr = need / port
    return {
        "withdrawal rate": wr,
        "years of spending saved": np.minimum(port / np.maximum(need, 1), 80),
        "income covers spending": np.minimum(income / spend, 1.5),
        "years left to live": MODE + 5 * health - age,
        "stock allocation": equity,
        "early markets": early,
        "flexibility": flex,
        "health": health,
        "age": age,
        "wealth": np.log(port),
        "lifestyle": np.log(spend),
        "crash exposure": equity * -np.minimum(early, 0),
    }


def run(model, X, gains=None):
    h = X
    acts = []
    for i, l in enumerate(model.layers):
        h = l(h)
        if i < len(model.layers) - 1:
            h = torch.relu(h)
            if gains is not None:
                h = h * gains[i]
            acts.append(h)
    return torch.sigmoid(h[:, 0]), acts


def main():
    model = Brain()
    model.load_state_dict(torch.load("train/brain.pt"))
    model.eval()
    rng = np.random.default_rng(99)
    raw = sample_clients(20000, rng)
    X = torch.tensor(encode(raw))
    C = concepts(raw)
    ones = [torch.ones(n) for n in SIZES[1:-1]]

    def instinct(gains, f):
        j = FEAT.index(f)
        hi, lo = X.clone(), X.clone()
        hi[:, j], lo[:, j] = 1, -1
        ph, _ = run(model, hi, gains)
        pl, _ = run(model, lo, gains)
        return (ph - pl).mean().item()

    with torch.no_grad():
        p0, acts = run(model, X, ones)
        base = {f: instinct(ones, f) for f in INSTINCTS}
        print("instincts (mean success change, feature low->high):", {k: round(v, 3) for k, v in base.items()})
        neurons = []
        for li, A in enumerate(acts):
            A = A.numpy()
            for ni in range(A.shape[1]):
                a = A[:, ni]
                fire = float((a > 1e-6).mean())
                corr = {}
                if a.std() > 1e-6:
                    for k, v in C.items():
                        corr[k] = float(np.corrcoef(a, v)[0, 1])
                g = [t.clone() for t in ones]
                g[li][ni] = 0
                p1, _ = run(model, X, g)
                vote = float((p1 - p0).mean())
                vote_abs = float((p1 - p0).abs().mean())
                share = {f: (base[f] - instinct(g, f)) / base[f] for f in INSTINCTS}
                neurons.append({"layer": li, "index": ni, "fire": round(fire, 4),
                                "mean": round(float(a.mean()), 4),
                                "corr": {k: round(v, 3) for k, v in corr.items()},
                                "vote": round(vote, 4), "voteAbs": round(vote_abs, 4),
                                "share": {k: round(v, 3) for k, v in share.items()}})

    for n in neurons:
        top = sorted(n["corr"].items(), key=lambda kv: -abs(kv[1]))[:3]
        sh = sorted(n["share"].items(), key=lambda kv: -abs(kv[1]))[:2]
        print(f"L{n['layer']}#{n['index']:<2} fire {n['fire']:.2f} vote {n['vote']:+.3f} |{n['voteAbs']:.3f}|  "
              + "  ".join(f"{k} {v:+.2f}" for k, v in top) + "   share " + " ".join(f"{k} {v:+.2f}" for k, v in sh))
    json.dump({"instincts": base, "neurons": neurons}, open("web/data/probe.json", "w"))


if __name__ == "__main__":
    main()
