const fs = require("fs");
const path = require("path");

function loadLatestRawFile(rawDir, modePrefix) {
  const files = fs
    .readdirSync(rawDir)
    .filter((f) => f.startsWith(modePrefix) && f.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    throw new Error(`No raw benchmark files (${modePrefix}*.json) found in ${rawDir}`);
  }
  return path.join(rawDir, files[files.length - 1]);
}

function markdownFromBench(bench, sourceFile) {
  const lines = [];
  lines.push("# Benchmark Summary");
  lines.push("");
  lines.push(`- Generated at: ${bench.generatedAt}`);
  lines.push(`- Source file: \`${sourceFile}\``);
  lines.push(`- Network: \`${bench.env.network}\` (chainId=${bench.env.chainId})`);
  lines.push(`- Iterations per case: ${bench.iterations}`);
  lines.push("");
  lines.push("| Case | Samples | Status Match | Gas Median | Gas p95 | Latency Median (ms) | Latency p95 (ms) |");
  lines.push("|------|---------|--------------|------------|---------|---------------------|------------------|");

  for (const c of bench.cases) {
    lines.push(
      `| ${c.id} | ${c.summary.sampleCount} | ${(c.summary.statusMatchRate * 100).toFixed(
        1
      )}% | ${c.summary.gas.median} | ${c.summary.gas.p95} | ${c.summary.latencyMs.median} | ${c.summary.latencyMs.p95} |`
    );
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- These measurements are local Hardhat-network benchmarks.");
  lines.push("- Cross-VM on-chain latency/gas must be measured separately on target network RPC.");
  lines.push("- Use the raw JSON output to audit every sample.");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const rawDir = path.join(__dirname, "results", "raw");
  const outDir = path.join(__dirname, "results");
  fs.mkdirSync(outDir, { recursive: true });

  const mode = process.argv.includes("--network") ? "network" : "local";
  const prefix = mode === "network" ? "bench-network-" : "bench-";
  const latest = loadLatestRawFile(rawDir, prefix);
  const bench = JSON.parse(fs.readFileSync(latest, "utf8"));
  const md = markdownFromBench(bench, path.relative(process.cwd(), latest));

  const outFile =
    mode === "network"
      ? path.join(outDir, "latest-summary-network.md")
      : path.join(outDir, "latest-summary.md");
  fs.writeFileSync(outFile, md);
  console.log(`Wrote summary: ${outFile}`);
}

main();

