export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export function parseSemver(value: string): ParsedSemver | undefined {
  const match = value.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : []
  };
}

export function compareSemver(leftRaw: string, rightRaw: string): number {
  const left = parseSemver(leftRaw);
  const right = parseSemver(rightRaw);

  if (!left || !right) return leftRaw.localeCompare(rightRaw);

  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }

  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;

  const count = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    const leftNumeric = Number.isInteger(leftNumber);
    const rightNumeric = Number.isInteger(rightNumber);

    if (leftNumeric && rightNumeric) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPart > rightPart ? 1 : -1;
  }

  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareSemver(candidate, current) > 0;
}
