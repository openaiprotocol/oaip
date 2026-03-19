const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const TRACER_ABI = [
  "function verifyProof(bytes proofBytes, bytes publicInputs) external returns (bool)",
  "event VerificationResult(bool success, bool isVerified)",
];

const REGISTRY_ABI = [
  "function verifyAndRecord(bytes proofBytes, bytes32 nullifier, bytes32 cooperativeHash, uint256 validUntil, uint256 currentTime) external returns (bool)",
  "event RecordCreated(bytes32 indexed nullifier, bytes32 cooperativeHash)",
];

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  const clamped = Math.max(0, Math.min(sortedValues.length - 1, idx));
  return sortedValues[clamped];
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function optionalHex(value, name) {
  if (!value) return null;
  if (!/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${name} must be 0x-prefixed hex`);
  }
  return value;
}

function parseBridgeFile() {
  const defaultPath = path.join(process.cwd(), "frontend", "public", "verifier-inputs.json");
  const filePath = process.env.BENCH_BRIDGE_FILE || defaultPath;
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function deriveBytes32(prefix, i) {
  return hre.ethers.keccak256(
    hre.ethers.toUtf8Bytes(`${prefix}:${i}:${Date.now()}:${Math.random()}`)
  );
}

async function run() {
  const fixturePath = path.join(__dirname, "fixtures", "network-scenarios.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(__dirname, "results", "raw");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `bench-network-${timestamp}.json`);

  const tracerAddress = mustEnv("BENCH_TRACER_ADDRESS");
  const registryAddress = mustEnv("BENCH_REGISTRY_ADDRESS");

  const bridge = parseBridgeFile();
  const proofBytes =
    optionalHex(process.env.BENCH_PROOF_BYTES, "BENCH_PROOF_BYTES") ||
    (bridge ? bridge.proofBytes : null);
  const publicInputs =
    optionalHex(process.env.BENCH_PUBLIC_INPUTS, "BENCH_PUBLIC_INPUTS") || null;

  if (!proofBytes) {
    throw new Error(
      "Missing proof bytes. Set BENCH_PROOF_BYTES or provide frontend/public/verifier-inputs.json"
    );
  }

  const tracer = new hre.ethers.Contract(tracerAddress, TRACER_ABI, await hre.ethers.getSigner());
  const registry = new hre.ethers.Contract(
    registryAddress,
    REGISTRY_ABI,
    await hre.ethers.getSigner()
  );

  const network = await hre.ethers.provider.getNetwork();
  const env = {
    node: process.version,
    network: hre.network.name,
    chainId: Number(network.chainId),
    tracerAddress,
    registryAddress,
    iterations: fixture.iterations,
    blockNumberStart: await hre.ethers.provider.getBlockNumber(),
  };

  const result = {
    generatedAt: new Date().toISOString(),
    fixturePath,
    env,
    cases: [],
  };

  for (const benchCase of fixture.cases) {
    const samples = [];
    for (let i = 0; i < fixture.iterations; i++) {
      let tx;
      const t0 = Date.now();

      if (benchCase.call === "tracer.verifyProof") {
        if (!publicInputs) {
          throw new Error(
            "tracer.verifyProof case requires BENCH_PUBLIC_INPUTS (or custom fixture adaptation)"
          );
        }
        tx = await tracer.verifyProof(proofBytes, publicInputs);
      } else if (benchCase.call === "registry.verifyAndRecord") {
        const latestBlock = await hre.ethers.provider.getBlock("latest");
        const currentTime = Number(latestBlock.timestamp);
        const validUntil = currentTime + (fixture.validForSeconds || 3600);

        // Use unique nullifiers/hashes per iteration to avoid replay reverts.
        const nullifier = deriveBytes32("nullifier", i);
        const cooperativeHash = deriveBytes32("coophash", i);

        tx = await registry.verifyAndRecord(
          proofBytes,
          nullifier,
          cooperativeHash,
          validUntil,
          currentTime
        );
      } else {
        throw new Error(`Unknown call: ${benchCase.call}`);
      }

      const receipt = await tx.wait();
      const latencyMs = Date.now() - t0;

      samples.push({
        iteration: i + 1,
        txHash: tx.hash,
        status: Number(receipt.status),
        gasUsed: Number(receipt.gasUsed),
        cumulativeGasUsed: Number(receipt.cumulativeGasUsed),
        blockNumber: Number(receipt.blockNumber),
        latencyMs,
      });
    }

    const gasValues = samples.map((s) => s.gasUsed).sort((a, b) => a - b);
    const latencyValues = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
    const expectedStatus = benchCase.expectedStatus ?? 1;
    const passedStatus = samples.filter((s) => s.status === expectedStatus).length;

    result.cases.push({
      ...benchCase,
      samples,
      summary: {
        sampleCount: samples.length,
        statusMatchRate: passedStatus / samples.length,
        gas: {
          min: gasValues[0],
          max: gasValues[gasValues.length - 1],
          median: percentile(gasValues, 50),
          p95: percentile(gasValues, 95),
        },
        latencyMs: {
          min: latencyValues[0],
          max: latencyValues[latencyValues.length - 1],
          median: percentile(latencyValues, 50),
          p95: percentile(latencyValues, 95),
        },
      },
    });
  }

  result.env.blockNumberEnd = await hre.ethers.provider.getBlockNumber();
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Wrote network benchmark raw output: ${outPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

