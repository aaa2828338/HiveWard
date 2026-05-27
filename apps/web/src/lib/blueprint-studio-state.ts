import type { AgentRuntimeId } from "@hiveward/shared";
import { runtimeDisplayParts } from "./harness-labels";

export type BlueprintRuntimeOption = {
  value: AgentRuntimeId;
  label: string;
  badgeLabel?: string;
};

export type BlueprintModelOption = {
  id: string;
  label: string;
  isDefault?: boolean;
};

export type BlueprintModelSelectOption = {
  value: string;
  label: string;
};

export const blueprintSelectOpenEventName = "hiveward:blueprint-select-open";

export function isBlueprintSelectorDisabled(input: {
  busy: boolean;
  selectedCompanyId?: string;
}): boolean {
  return input.busy || !input.selectedCompanyId;
}

export function buildAgentHarnessOptions(): BlueprintRuntimeOption[] {
  return ([
    "codex",
    "google",
    "cursor",
    "opencode",
    "hermes",
    "openclaw",
    "claude"
  ] as const).map((value) => ({ value, ...runtimeDisplayParts(value) }));
}

export function getBlueprintSelectOutsidePointerListenerOptions(): AddEventListenerOptions {
  return { capture: true };
}

export function buildBlueprintModelSelectOptions(input: {
  models: BlueprintModelOption[];
  defaultLabel: string;
  defaultBadgeLabel: string;
  selectedModel?: string;
  defaultValue?: string;
  noChangeLabel?: string;
}): BlueprintModelSelectOption[] {
  const concreteModels = input.models.filter((model) => model.id !== "inherit");
  const selectedModel = resolveBlueprintModelSelectValue(input.selectedModel);
  const selectedModelOption: BlueprintModelOption[] =
    selectedModel && !concreteModels.some((model) => model.id === selectedModel)
      ? [{ id: selectedModel, label: selectedModel }]
      : [];

  return [
    ...(input.noChangeLabel ? [{ value: "", label: input.noChangeLabel }] : []),
    { value: input.defaultValue ?? "", label: input.defaultLabel },
    ...selectedModelOption
      .concat(concreteModels)
      .map((model) => ({
        value: model.id,
        label: model.isDefault ? `${model.label} ${input.defaultBadgeLabel}` : model.label
      }))
  ];
}

export function resolveBlueprintModelSelectValue(modelId: string | undefined): string {
  return modelId === "inherit" ? "" : modelId ?? "";
}
