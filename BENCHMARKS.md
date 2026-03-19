# Benchmark Methodology

This document describes the reproducible benchmark process for this repository.
It avoids hard-coded public claims unless backed by raw benchmark artifacts.

## Scope

Current benchmark harness measures local Hardhat-network transaction behavior for:

- `VerificationRegistry.verifyAndRecord(...)`
- `OIAP_Tracer_Caller.verifyProof(...)`

using deterministic fixture-driven runs and per-transaction raw output capture.

## What Is Measured

For each benchmark case and iteration:

- `gasUsed`
- `cumulativeGasUsed`
- `status`
- `latencyMs` (wall-clock submit->receipt)
- `blockNumber`

Summary statistics per case:

- min / median / p95 / max for gas
- min / median / p95 / max for latency
- status match rate

## Reproducible Commands

From repository root:

```bash
# Run benchmark and write raw JSON to bench/results/raw/
npm run bench

# Generate markdown summary from latest raw run
npm run bench:summary
```

Network benchmark mode (target RPC):

```bash
# Required env (example)
export BENCH_TRACER_ADDRESS=0x...
export BENCH_REGISTRY_ADDRESS=0x...
export BENCH_PROOF_BYTES=0x...      # or provide frontend/public/verifier-inputs.json
export BENCH_PUBLIC_INPUTS=0x...     # required for tracer direct case

# Run against configured polkadotHubTestnet network
npm run bench:network:testnet

# Summarize latest network run
npm run bench:summary:network
```

Artifacts:

- Raw results: `bench/results/raw/bench-*.json`
- Latest summary: `bench/results/latest-summary.md`
- Raw network results: `bench/results/raw/bench-network-*.json`
- Latest network summary: `bench/results/latest-summary-network.md`

## Environment Discipline

When publishing numbers, include:

- Git commit SHA
- Node + npm versions
- Hardhat version
- Network and chain id
- fixture file used (`bench/fixtures/scenarios.json`)
- full raw result file(s)

## Important Limitations

- Local Hardhat benchmarks are **not** equivalent to final cross-VM on-chain costs.
- Final public performance claims should include network-level measurements on the
  target chain/RPC and, where applicable, finalized block latency.

## Publication Policy

Do not publish multiplier/cost claims without:

1. Reproducible raw artifacts in-repo (or attached release assets)
2. Clear environment metadata
3. Explicitly separated local-vs-network benchmark sections
