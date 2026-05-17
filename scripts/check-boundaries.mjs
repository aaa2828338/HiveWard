import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const scannedRoots = ["apps", "packages"];
const allowedGatewayPaths = [
  "packages/adapter",
  "apps/api/src/adapter"
];

const forbiddenImports = [
  {
    name: "OpenClaw runtime import outside adapter",
    pattern: /from\s+['"][^'"]*(agent-runtime|tool-executor|plugin-loader|channel-sdk|provider-fallback)[^'"]*['"]/i
  }
];

const gatewayRpcPattern = /\b(gatewayRpc|GatewayRPC|rpcMethod|gatewayMethod|openclawGatewayMethod)\b/;

function walk(dir) {
  const entries = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (["node_modules", "dist", ".vite"].includes(entry)) continue;
      entries.push(...walk(fullPath));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) {
      entries.push(fullPath);
    }
  }
  return entries;
}

function isAllowedGatewayFile(file) {
  const rel = relative(root, file).replaceAll("\\", "/");
  return allowedGatewayPaths.some((prefix) => rel.startsWith(prefix));
}

const violations = [];

for (const scannedRoot of scannedRoots) {
  const absoluteRoot = join(root, scannedRoot);
  let files = [];
  try {
    files = walk(absoluteRoot);
  } catch {
    continue;
  }

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const rel = relative(root, file).replaceAll("\\", "/");

    for (const rule of forbiddenImports) {
      if (rule.pattern.test(source) && !isAllowedGatewayFile(file)) {
        violations.push(`${rel}: ${rule.name}`);
      }
    }

    if (gatewayRpcPattern.test(source) && !isAllowedGatewayFile(file)) {
      violations.push(`${rel}: Gateway/RPC detail leaked outside adapter boundary`);
    }
  }
}

if (violations.length > 0) {
  console.error("Boundary check failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Boundary check passed.");
