---
name: script-backed-skill
description: Use when a deterministic generator script should prepare an artifact from a source file.
---

# Script Backed Skill

1. Inspect the input data.
2. Use `scripts/generate.mjs` to generate the artifact only when execution is explicitly allowed.
3. Validate the artifact against the expected output contract.
