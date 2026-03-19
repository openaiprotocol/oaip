const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  const clamped = Math.max(0, Math.min(sortedValues.length - 1, idx));
  return sortedValues[clamped];
}

async function deployFixture() {
  const [owner] = await hre.ethers.getSigners();

  const PvmMock = await hre.ethers.getContractFactory("PvmVerifierMock");
  const pvmMock = await PvmMock.deploy();

  const Tracer = await hre.ethers.getContractFactory("OIAP_Tracer_Caller");
  const tracer = await Tracer.deploy(pvmMock.target);

  const Registry = await hre.ethers.getContractFactory("VerificationRegistry");
  const registry = await Registry.deploy(tracer.target);

  return { owner, pvmMock, tracer, registry };
}

async function run() {
  const fixturePath = path.join(__dirname, "fixtures", "scenarios.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(__dirname, "results", "raw");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `bench-${timestamp}.json`);

  const env = {
    node: process.version,
    hardhat: hre.config.solidity?.compilers ? "hardhat-multi-compiler" : "hardhat",
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    blockNumberStart: await hre.ethers.provider.getBlockNumber(),
  };

  const result = {
    generatedAt: new Date().toISOString(),
    fixturePath,
    env,
    iterations: fixture.iterations,
    cases: [],
  };

  for (const benchCase of fixture.cases) {
    const { pvmMock, tracer, registry } = await deployFixture();

    const samples = [];
    for (let i = 0; i < fixture.iterations; i++) {
      const nullifier = hre.ethers.zeroPadValue(hre.ethers.toBeHex(i + 1), 32);
      const coopHash = hre.ethers.zeroPadValue(hre.ethers.toBeHex(1000 + i), 32);

      const latestBlock = await hre.ethers.provider.getBlock("latest");
      const currentTime = latestBlock.timestamp;
      const validUntil = currentTime + 3600;

      const proofBytes = `0x${"01".repeat(256)}`;
      const publicInputs = `0x${"02".repeat(128)}`;

      if (benchCase.id.includes("invalid")) {
        await pvmMock.setResult(false);
      } else {
        await pvmMock.setResult(true);
      }

      let tx;
      const t0 = Date.now();
      if (benchCase.call === "registry.verifyAndRecord") {
        tx = await registry.verifyAndRecord(
          proofBytes,
          nullifier,
          coopHash,
          validUntil,
          currentTime
        );
      } else if (benchCase.call === "tracer.verifyProof") {
        tx = await tracer.verifyProof(proofBytes, publicInputs);
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
    const passedStatus = samples.filter((s) => s.status === benchCase.expectedStatus).length;

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
  console.log(`Wrote benchmark raw output: ${outPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

