import { describe, expect, it } from "vitest";
import {
  buildAgentHarnessOptions,
  buildBlueprintModelSelectOptions,
  buildSummaryHarnessOptions,
  blueprintSelectOpenEventName,
  getBlueprintSelectOutsidePointerListenerOptions,
  isBlueprintSelectorDisabled,
  resolveBlueprintModelSelectValue
} from "./blueprint-studio-state";

describe("blueprint studio state", () => {
  it("keeps the blueprint selector available for an empty selected company", () => {
    expect(isBlueprintSelectorDisabled({ busy: false, selectedCompanyId: "company-empty" })).toBe(false);
  });

  it("keeps the blueprint selector disabled while another action is busy", () => {
    expect(isBlueprintSelectorDisabled({ busy: true, selectedCompanyId: "company-empty" })).toBe(true);
  });

  it("keeps the blueprint selector disabled when no company is selected", () => {
    expect(isBlueprintSelectorDisabled({ busy: false })).toBe(true);
  });

  it("allows agent and manager nodes to switch to Claude Code from OpenClaw", () => {
    expect(buildAgentHarnessOptions().map((option) => option.value)).toEqual([
      "codex",
      "google",
      "cursor",
      "opencode",
      "hermes",
      "openclaw",
      "claude"
    ]);
  });

  it("marks newly added CLI harness options as beta", () => {
    expect(buildAgentHarnessOptions().filter((option) => ["google", "cursor", "opencode", "hermes"].includes(option.value))).toEqual([
      { value: "google", label: "Google CLI", badgeLabel: "Beta" },
      { value: "cursor", label: "Cursor CLI", badgeLabel: "Beta" },
      { value: "opencode", label: "OpenCode", badgeLabel: "Beta" },
      { value: "hermes", label: "Hermes", badgeLabel: "Beta" }
    ]);
  });

  it("allows agent and manager nodes to switch to Claude Code from Codex", () => {
    expect(buildAgentHarnessOptions().map((option) => option.value)).toContain("claude");
  });

  it("gives summary nodes the same beta CLI harness choices as agent nodes", () => {
    expect(buildSummaryHarnessOptions().filter((option) => ["google", "cursor", "opencode", "hermes"].includes(option.value))).toEqual([
      { value: "google", label: "Google CLI", badgeLabel: "Beta" },
      { value: "cursor", label: "Cursor CLI", badgeLabel: "Beta" },
      { value: "opencode", label: "OpenCode", badgeLabel: "Beta" },
      { value: "hermes", label: "Hermes", badgeLabel: "Beta" }
    ]);
  });

  it("listens for outside pointer events during capture so modal propagation stops do not trap open selects", () => {
    expect(getBlueprintSelectOutsidePointerListenerOptions()).toMatchObject({ capture: true });
  });

  it("uses a shared event name for closing peer selects when another select opens", () => {
    expect(blueprintSelectOpenEventName).toBe("hiveward:blueprint-select-open");
  });

  it("labels the implicit model choice as plain default without a runtime prefix", () => {
    expect(
      buildBlueprintModelSelectOptions({
        models: [],
        defaultLabel: "默认",
        defaultBadgeLabel: "默认"
      })
    ).toEqual([{ value: "", label: "默认" }]);
  });

  it("shows concrete harness models and marks the concrete default model", () => {
    expect(
      buildBlueprintModelSelectOptions({
        models: [
          { id: "inherit", label: "Claude Code default", isDefault: true },
          { id: "claude-sonnet-4-5", label: "claude-sonnet-4-5", isDefault: true },
          { id: "claude-opus-4-1", label: "claude-opus-4-1" }
        ],
        defaultLabel: "默认",
        defaultBadgeLabel: "默认"
      })
    ).toEqual([
      { value: "", label: "默认" },
      { value: "claude-sonnet-4-5", label: "claude-sonnet-4-5 默认" },
      { value: "claude-opus-4-1", label: "claude-opus-4-1" }
    ]);
  });

  it("treats inherited harness defaults as the implicit default selection", () => {
    expect(resolveBlueprintModelSelectValue("inherit")).toBe("");
  });

  it("keeps a custom selected model visible when it is not in the scanned model list", () => {
    expect(
      buildBlueprintModelSelectOptions({
        selectedModel: "custom-model",
        models: [{ id: "gpt-5.5", label: "gpt-5.5" }],
        defaultLabel: "默认",
        defaultBadgeLabel: "默认"
      })
    ).toEqual([
      { value: "", label: "默认" },
      { value: "custom-model", label: "custom-model" },
      { value: "gpt-5.5", label: "gpt-5.5" }
    ]);
  });
});
