import { describe, expect, it } from "vitest";
import { buildModelAuthRequest } from "./openClawConfigWizard";

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
