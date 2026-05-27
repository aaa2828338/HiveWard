import { describe, expect, it } from "vitest";
import type { ClaudeCodeModelConfig, ClaudeCodeSavedModelProfile } from "@hiveward/shared";
import { getVisibleClaudeCodeSavedProfiles, isClaudeCodeSavedProfileActiveProvider } from "./claude-code-saved-profiles";

function profile(input: Partial<ClaudeCodeSavedModelProfile> & Pick<ClaudeCodeSavedModelProfile, "id">): ClaudeCodeSavedModelProfile {
  return {
    name: input.providerPresetName ?? input.id,
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    ...input
  };
}

describe("getVisibleClaudeCodeSavedProfiles", () => {
  it("keeps the active provider in saved profiles while still deduplicating by provider", () => {
    const config: ClaudeCodeModelConfig = {
      configPath: "/tmp/settings.json",
      providerPresetId: "deepseek",
      providerPresetName: "DeepSeek",
      baseUrl: "https://api.deepseek.com/anthropic",
      fallbackModelId: "deepseek-v4-pro",
      haikuModelId: "deepseek-v4-flash",
      sonnetModelId: "deepseek-v4-pro",
      opusModelId: "deepseek-v4-pro"
    };
    const savedProfiles = [
      profile({
        id: "deepseek-older-model",
        providerPresetId: "deepseek",
        providerPresetName: "DeepSeek",
        fallbackModelId: "deepseek-v3"
      }),
      profile({
        id: "deepseek-current-model",
        providerPresetId: "deepseek",
        providerPresetName: "DeepSeek",
        fallbackModelId: "deepseek-v4-pro"
      }),
      profile({
        id: "minimax",
        providerPresetId: "minimax-global",
        providerPresetName: "MiniMax",
        fallbackModelId: "MiniMax-M2.7"
      })
    ];

    const visibleProfiles = getVisibleClaudeCodeSavedProfiles(savedProfiles);

    expect(visibleProfiles.map((item) => item.id)).toEqual(["deepseek-older-model", "minimax"]);
    expect(isClaudeCodeSavedProfileActiveProvider(visibleProfiles[0]!, config)).toBe(true);
    expect(isClaudeCodeSavedProfileActiveProvider(visibleProfiles[1]!, config)).toBe(false);
  });

  it("deduplicates saved profiles by provider and keeps the newest profile from the sorted API list", () => {
    const savedProfiles = [
      profile({
        id: "minimax-new",
        providerPresetId: "minimax-global",
        providerPresetName: "MiniMax",
        fallbackModelId: "MiniMax-M2.7"
      }),
      profile({
        id: "minimax-old",
        providerPresetId: "minimax-global",
        providerPresetName: "MiniMax",
        fallbackModelId: "MiniMax-M1"
      }),
      profile({
        id: "deepseek",
        providerPresetId: "deepseek",
        providerPresetName: "DeepSeek",
        fallbackModelId: "deepseek-v4-pro"
      })
    ];

    expect(getVisibleClaudeCodeSavedProfiles(savedProfiles).map((item) => item.id)).toEqual(["minimax-new", "deepseek"]);
  });

  it("treats regional presets from the same provider as one saved vendor", () => {
    const config: ClaudeCodeModelConfig = {
      configPath: "/tmp/settings.json",
      providerPresetId: "minimax-global",
      providerPresetName: "MiniMax en",
      baseUrl: "https://api.minimax.io/anthropic",
      fallbackModelId: "MiniMax-M2.7"
    };
    const savedProfiles = [
      profile({
        id: "minimax-cn",
        providerPresetId: "minimax-cn",
        providerPresetName: "MiniMax",
        baseUrl: "https://api.minimaxi.com/anthropic",
        fallbackModelId: "MiniMax-M2.7"
      }),
      profile({
        id: "minimax-global",
        providerPresetId: "minimax-global",
        providerPresetName: "MiniMax en",
        baseUrl: "https://api.minimax.io/anthropic",
        fallbackModelId: "MiniMax-M2.7"
      }),
      profile({
        id: "deepseek",
        providerPresetId: "deepseek",
        providerPresetName: "DeepSeek",
        fallbackModelId: "deepseek-v4-pro"
      })
    ];

    const visibleProfiles = getVisibleClaudeCodeSavedProfiles(savedProfiles);

    expect(visibleProfiles.map((item) => item.id)).toEqual(["minimax-cn", "deepseek"]);
    expect(isClaudeCodeSavedProfileActiveProvider(visibleProfiles[0]!, config)).toBe(true);
  });

  it("preserves the current card order when refreshed saved profiles arrive in a different order", () => {
    const currentProfiles = [
      profile({
        id: "deepseek-old",
        providerPresetId: "deepseek",
        providerPresetName: "DeepSeek",
        fallbackModelId: "deepseek-v3"
      }),
      profile({
        id: "minimax-old",
        providerPresetId: "minimax-global",
        providerPresetName: "MiniMax",
        fallbackModelId: "MiniMax-M2.7"
      })
    ];
    const refreshedProfiles = [
      profile({
        id: "minimax-new",
        providerPresetId: "minimax-global",
        providerPresetName: "MiniMax",
        fallbackModelId: "MiniMax-M2.7"
      }),
      profile({
        id: "deepseek-new",
        providerPresetId: "deepseek",
        providerPresetName: "DeepSeek",
        fallbackModelId: "deepseek-v4-pro"
      })
    ];

    expect(getVisibleClaudeCodeSavedProfiles(refreshedProfiles, currentProfiles).map((item) => item.id)).toEqual([
      "deepseek-new",
      "minimax-new"
    ]);
  });
});
