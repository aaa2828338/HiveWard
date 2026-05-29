import { describe, expect, it } from "vitest";
import { buildModelAuthRequest, getOpenClawConfigWizardMetadata } from "./openClawConfigWizard";

function modelOptionsFor(providerId: string, methodId: string): string[] {
  const metadata = getOpenClawConfigWizardMetadata();
  const provider = metadata.modelProviders.find((candidate) => candidate.id === providerId);
  const method = provider?.methods.find((candidate) => candidate.id === methodId);
  const field = method?.fields.find((candidate) => candidate.id === "modelId");
  return field?.options?.map((option) => option.value) ?? [];
}

describe("buildModelAuthRequest", () => {
  it("writes OpenAI Codex browser login with the Codex responses endpoint", () => {
    expect(
      buildModelAuthRequest({
        providerId: "openai-codex",
        methodId: "oauth",
        values: {
          modelId: "gpt-5.5"
        }
      })
    ).toMatchObject({
      provider: "openai-codex",
      modelId: "gpt-5.5",
      api: "openai-codex-responses",
      baseUrl: "https://chatgpt.com/backend-api/codex",
      apiKey: "oauth:openai-codex",
      setDefault: true
    });
  });

  it("maps the OpenAI Codex API-key fallback to the OpenAI provider", () => {
    expect(
      buildModelAuthRequest({
        providerId: "openai-codex",
        methodId: "api-key",
        values: {
          modelId: "gpt-5.5",
          apiKey: "test-key"
        }
      })
    ).toMatchObject({
      provider: "openai",
      modelId: "gpt-5.5",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      setDefault: true
    });
  });
});

describe("getOpenClawConfigWizardMetadata", () => {
  it("offers current official Anthropic Claude models instead of a single Sonnet default", () => {
    const options = modelOptionsFor("anthropic", "api-key");

    expect(options).toContain("claude-opus-4-8");
    expect(options).toContain("claude-opus-4-7");
    expect(options).toContain("claude-opus-4-6");
    expect(options).toContain("claude-sonnet-4-6");
    expect(options).toContain("claude-haiku-4-5");
    expect(options.length).toBeGreaterThan(1);
  });

  it("offers Xiaomi MiMo model IDs instead of the provider label placeholder", () => {
    const options = modelOptionsFor("xiaomi", "api-key");

    expect(options).toEqual([
      "mimo-v2.5-pro",
      "mimo-v2.5",
      "mimo-v2-pro",
      "mimo-v2-omni",
      "mimo-v2-flash"
    ]);
    expect(options).not.toContain("mi-milab");
  });
});
