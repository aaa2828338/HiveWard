import type { ClaudeCodeModelConfig, ClaudeCodeSavedModelProfile } from "@hiveward/shared";

type ClaudeCodeProfileVendorInput = Pick<
  ClaudeCodeSavedModelProfile,
  "id" | "providerPresetId" | "providerPresetName" | "baseUrl"
>;

type ClaudeCodeConfigVendorInput = Pick<ClaudeCodeModelConfig, "providerPresetId" | "providerPresetName" | "baseUrl">;

export function getVisibleClaudeCodeSavedProfiles(
  savedProfiles: ClaudeCodeSavedModelProfile[],
  previousVisibleProfiles: ClaudeCodeSavedModelProfile[] = []
): ClaudeCodeSavedModelProfile[] {
  const currentVendorGroups = buildClaudeCodeProfileVendorGroups(savedProfiles);
  if (!previousVisibleProfiles.length) return currentVendorGroups.map((group) => group.profile);

  const orderedProfiles: ClaudeCodeSavedModelProfile[] = [];
  const usedCurrentGroupIndexes = new Set<number>();

  for (const previousProfile of previousVisibleProfiles) {
    const previousKeys = buildClaudeCodeVendorKeys(previousProfile);
    const nextGroupIndex = currentVendorGroups.findIndex((group, index) => {
      if (usedCurrentGroupIndexes.has(index)) return false;
      return hasOverlappingVendorKeys(previousKeys, group.keys);
    });
    if (nextGroupIndex < 0) continue;

    usedCurrentGroupIndexes.add(nextGroupIndex);
    orderedProfiles.push(currentVendorGroups[nextGroupIndex]!.profile);
  }

  for (let index = 0; index < currentVendorGroups.length; index += 1) {
    if (usedCurrentGroupIndexes.has(index)) continue;
    orderedProfiles.push(currentVendorGroups[index]!.profile);
  }

  return orderedProfiles;
}

function buildClaudeCodeProfileVendorGroups(savedProfiles: ClaudeCodeSavedModelProfile[]): Array<{
  profile: ClaudeCodeSavedModelProfile;
  keys: string[];
}> {
  const seenVendorKeys = new Set<string>();
  const groups: Array<{ profile: ClaudeCodeSavedModelProfile; keys: string[] }> = [];

  for (const profile of savedProfiles) {
    const profileVendorKeys = buildClaudeCodeVendorKeys(profile);
    const dedupeKeys = profileVendorKeys.length ? profileVendorKeys : [`profile:${profile.id}`];
    if (dedupeKeys.some((key) => seenVendorKeys.has(key))) continue;

    for (const key of dedupeKeys) seenVendorKeys.add(key);
    groups.push({ profile, keys: dedupeKeys });
  }

  return groups;
}

export function isClaudeCodeSavedProfileActiveProvider(
  profile: ClaudeCodeSavedModelProfile,
  config: ClaudeCodeModelConfig | undefined
): boolean {
  const activeVendorKeys = new Set(buildClaudeCodeVendorKeys(config));
  if (!activeVendorKeys.size) return false;
  return buildClaudeCodeVendorKeys(profile).some((key) => activeVendorKeys.has(key));
}

function buildClaudeCodeVendorKeys(input: ClaudeCodeProfileVendorInput | ClaudeCodeConfigVendorInput | undefined): string[] {
  if (!input) return [];
  return [
    keyedValue("preset", normalizeClaudeCodeProviderPresetId(input.providerPresetId)),
    keyedValue("name", normalizeClaudeCodeProviderName(input.providerPresetName)),
    keyedValue("base-url", input.baseUrl)
  ].filter((key): key is string => Boolean(key));
}

function hasOverlappingVendorKeys(leftKeys: string[], rightKeys: string[]): boolean {
  return leftKeys.some((leftKey) => rightKeys.includes(leftKey));
}

function normalizeClaudeCodeProviderPresetId(value: string | undefined): string | undefined {
  return value?.trim().replace(/-(cn|global)$/iu, "");
}

function normalizeClaudeCodeProviderName(value: string | undefined): string | undefined {
  return value?.trim().replace(/\s+en$/iu, "");
}

function keyedValue(prefix: string, value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? `${prefix}:${normalized}` : undefined;
}
