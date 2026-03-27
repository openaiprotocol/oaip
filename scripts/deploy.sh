#!/usr/bin/env bash
# deploy.sh — PVM ZK Verifier Deployment Pipeline
# Usage: ./scripts/deploy.sh [testnet|local]
#
# Prerequisites:
#   - cargo + nightly (builds using included JSON target spec via `-Z json-target-spec`)
#   - polkatool  (install: cargo install polkatool)
#   - cast       (install: https://getfoundry.sh)
#   - PRIVATE_KEY env var set (via .env or export)

set -e
export PATH="$HOME/.config/.foundry/bin:$HOME/.cargo/bin:$PATH"

NETWORK=${1:-local}
CONTRACT_DIR="contracts/pvm_zk_verifier"
OUTPUT_NAME="pvm_zk_verifier"
# Use polkatool's canonical target JSON, patched for nightly-2026-01-22 compatibility.
# polkatool 0.27.0 uses "target-pointer-width": "64" (string) but this nightly requires int.
POLKATOOL_TARGET=$(polkatool get-target-json-path)
TARGET_JSON="/tmp/polkavm-target-patched.json"
python3 -c "
import json
with open('$POLKATOOL_TARGET') as f:
    j = json.load(f)
j['target-pointer-width'] = 64
import json; print(json.dumps(j, indent=2))
" > "$TARGET_JSON"

echo "========================================"
echo " OIAP PVM ZK Verifier — Deploy Script"
echo " Network: $NETWORK"
echo "========================================"

# ─── Step 1: Install RISC-V toolchain if needed ───────────────────────────────
echo "[1/4] Checking RISC-V toolchain..."
if ! rustup toolchain list | grep -q "nightly"; then
    echo "  Installing nightly toolchain..."
    rustup toolchain install nightly
fi
rustup component add rust-src --toolchain nightly
echo "  OK: Toolchain ready."

# ─── Step 2: Build the RISC-V ELF ────────────────────────────────────────────
echo "[2/4] Building RISC-V ELF..."
(
    cd "$CONTRACT_DIR"
    cargo +nightly build \
        --target "$TARGET_JSON" \
        --release \
        -Z build-std=core,alloc \
        -Z build-std-features=compiler-builtins-mem \
        -Z json-target-spec
)
# Target dir is named after the basename of the target JSON file (without extension).
TARGET_NAME=$(basename "$TARGET_JSON" .json)
ELF_PATH="$CONTRACT_DIR/target/$TARGET_NAME/release/$OUTPUT_NAME"
echo "  OK: ELF built: $ELF_PATH"

# ─── Step 3: polkatool — produce the deployable .polkavm artifact ─────────────
# polkatool performs tree-shaking and reformatting of the ELF into the
# custom PolkaVM binary format that pallet-revive accepts.
echo "[3/4] Running polkatool to produce .polkavm artifact..."
if ! command -v polkatool &> /dev/null; then
    echo "  Installing polkatool..."
    cargo install polkatool
fi
polkatool link "$ELF_PATH" -o "${OUTPUT_NAME}.polkavm"
echo "  OK: Artifact: ${OUTPUT_NAME}.polkavm ($(du -sh ${OUTPUT_NAME}.polkavm | cut -f1))"

# ─── Step 4: Deploy to the network ───────────────────────────────────────────
echo "[4/4] Deploying to $NETWORK..."

if [ "$NETWORK" == "testnet" ]; then
    RPC_URL="${POLKADOT_HUB_TESTNET_RPC:-https://eth-rpc-testnet.polkadot.io}"
elif [ "$NETWORK" == "local" ]; then
    RPC_URL="http://127.0.0.1:8545"
else
    echo "  Unknown network: $NETWORK"
    exit 1
fi

# Deploy via Hardhat — avoids shell ARG_MAX limit for 128K+ binaries.
# Hardhat provides hre.ethers without shell bytecode argument passing.
DEPLOY_OUTPUT=$(PVM_BINARY="${OUTPUT_NAME}.polkavm" \
    npx hardhat run "$(dirname "$0")/deploy-pvm-binary.cjs" \
    --network polkadotHubTestnet 2>&1)
echo "$DEPLOY_OUTPUT"
DEPLOYED_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "^  Address:" | awk '{print $2}')

echo "  OK: Deployed at: $DEPLOYED_ADDRESS"
echo ""
echo "  IMPORTANT: Copy this address into OIAP_Tracer_Caller.sol:"
echo "    address public constant INK_VERIFIER = $DEPLOYED_ADDRESS;"
echo ""
echo "========================================"
echo " Deployment complete."
echo "========================================"
