import { writeFileSync } from "node:fs";

const [, , outputPath] = process.argv;

if (!outputPath) {
  throw new Error("output path is required");
}

writeFileSync(outputPath, JSON.stringify({ summary: "generated", sourceCount: 1 }), "utf8");
