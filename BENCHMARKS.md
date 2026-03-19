# Gas Benchmarks

Comparative analysis of Groth16 verification costs on Polkadot Hub.

> [!NOTE]
> These are preliminary estimates based on the Phase 1 Tracer Bullet. Actual costs on the Westend Asset Hub testnet may vary based on exact weight-to-gas calibration.

| Operation | EVM-Native (Solidity) | PVM-Native (Rust ink!) | Improvement |
|-----------|-----------------------|-------------------------|-------------|
| G1 Pairing | ~120,000 gas | ~6,000 gas eq. | 20x |
| G2 Pairing | ~180,000 gas | ~8,000 gas eq. | 22x |
| **Total Verification** | **~350,000 gas** | **~15,000 gas eq.** | **~23x** |

## Cost Analysis

At current Polkadot Hub fee parameters:
- **EVM-Native**: ~$1.20 - $5.00 per verification.
- **PVM-Native**: **<$0.05** per verification.

This enables high-frequency identity claims that are otherwise economically impossible.
