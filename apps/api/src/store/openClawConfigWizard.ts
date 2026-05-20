import type {
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  CreateOpenClawChannelRequest,
  CreateOpenClawModelRequest,
  OpenClawChannelSetupOption,
  OpenClawConfigWizardMetadata,
  OpenClawModelAuthMethodOption,
  OpenClawModelAuthProviderOption,
  OpenClawWizardField,
  OpenClawWizardValue
} from "@hiveward/shared";

type ModelProviderDefinition = Omit<OpenClawModelAuthProviderOption, "methods"> & {
  methods: ModelMethodDefinition[];
};

type ModelMethodDefinition = OpenClawModelAuthMethodOption & {
  write: {
    providerId?: string;
    providerIdField?: string;
    api?: string;
    baseUrl?: string;
    baseUrlTemplate?: (values: Record<string, OpenClawWizardValue>) => string | undefined;
    apiKeyMarker?: string;
    defaultEnv?: string;
  };
};

const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  anthropic: "claude-sonnet-4-5",
  arcee: "spotlight",
  byteplus: "doubao-seed-1-6",
  cerebras: "llama-3.3-70b",
  chutes: "deepseek-ai/DeepSeek-V3.1",
  cloudflare: "@cf/meta/llama-3.1-8b-instruct",
  codex: "gpt-5.5",
  "codex-cli": "gpt-5.5",
  deepinfra: "deepseek-ai/DeepSeek-V3.1",
  deepseek: "deepseek-chat",
  fireworks: "accounts/fireworks/models/deepseek-v3",
  google: "gemini-2.5-pro",
  "google-vertex": "gemini-2.5-pro",
  groq: "llama-3.3-70b-versatile",
  huggingface: "meta-llama/Llama-3.1-8B-Instruct",
  kilocode: "anthropic/claude-sonnet-4.5",
  litellm: "gpt-4.1-mini",
  lmstudio: "local-model",
  "microsoft-foundry": "deployment-name",
  minimax: "MiniMax-Text-01",
  "minimax-portal": "MiniMax-Text-01",
  mistral: "mistral-large-latest",
  moonshot: "kimi-k2-0905-preview",
  nvidia: "meta/llama-3.1-70b-instruct",
  ollama: "llama3.2",
  openai: "gpt-5.5",
  "openai-codex": "gpt-5.5",
  opencode: "qwen/qwen3-coder",
  openrouter: "openai/gpt-5.5",
  qianfan: "ernie-4.5-turbo",
  qwen: "qwen3-coder-plus",
  sglang: "local-model",
  stepfun: "step-2-mini",
  "stepfun-plan": "step-2-mini",
  synthetic: "claude-sonnet-4-5",
  "tencent-tokenhub": "hunyuan-t1-latest",
  together: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  venice: "llama-3.3-70b",
  "vercel-ai-gateway": "openai/gpt-5.5",
  vllm: "local-model",
  volcengine: "doubao-seed-1-6",
  xai: "grok-4",
  xiaomi: "mi-milab",
  zai: "glm-4.5"
};

const MODEL_API_OPENAI = "openai-responses";
const MODEL_API_OPENAI_CODEX = "openai-codex-responses";
const MODEL_API_ANTHROPIC = "anthropic-messages";
const MODEL_API_GOOGLE = "google-generative-ai";
const MODEL_API_COPILOT = "github-copilot";
const MODEL_API_OLLAMA = "ollama";
const MODEL_API_AZURE = "azure-openai-responses";
const OPENAI_RESPONSES_BASE_URL = "https://api.openai.com/v1";
const OPENAI_CODEX_RESPONSES_BASE_URL = "https://chatgpt.com/backend-api/codex";

const apiKeyField: OpenClawWizardField = {
  id: "apiKey",
  label: "API Key",
  type: "password",
  required: true,
  placeholder: "sk-..."
};

const modelBaseFields = (modelId = "default"): OpenClawWizardField[] => [
  {
    id: "modelId",
    label: "Model",
    type: "select",
    required: true,
    defaultValue: modelId,
    options: [{ value: modelId, label: modelId }]
  }
];

const apiKeyFields = (_defaultEnv: string, modelId?: string, _extraFields: OpenClawWizardField[] = []): OpenClawWizardField[] => [
  ...modelBaseFields(modelId),
  apiKeyField
];

const localFields = (_baseUrl: string, modelPlaceholder?: string): OpenClawWizardField[] => modelBaseFields(modelPlaceholder);

const tokenFields = (tokenLabel: string, modelPlaceholder?: string): OpenClawWizardField[] => [
  ...modelBaseFields(modelPlaceholder),
  {
    id: "apiKey",
    label: tokenLabel,
    type: "password",
    required: true
  }
];

const markerFields = (modelPlaceholder?: string): OpenClawWizardField[] => modelBaseFields(modelPlaceholder);

function apiProvider(params: {
  id: string;
  label: string;
  env: string;
  hint?: string;
  api?: string;
  baseUrl?: string;
  modelPlaceholder?: string;
  methodLabel?: string;
  methodHint?: string;
  choiceId?: string;
}): ModelProviderDefinition {
  return {
    id: params.id,
    label: params.label,
    hint: params.hint,
    methods: [
      {
        id: "api-key",
        label: params.methodLabel ?? `${params.label} API key`,
        hint: params.methodHint ?? "Direct API key",
        kind: "api_key",
        choiceId: params.choiceId,
        fields: apiKeyFields(params.env, params.modelPlaceholder ?? DEFAULT_MODEL_BY_PROVIDER[params.id]),
        write: {
          api: params.api ?? MODEL_API_OPENAI,
          baseUrl: params.baseUrl,
          defaultEnv: params.env
        }
      }
    ]
  };
}

const MODEL_PROVIDER_DEFINITIONS: ModelProviderDefinition[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    hint: "Claude CLI + API key",
    methods: [
      {
        id: "cli",
        label: "Anthropic Claude CLI",
        hint: "Reuse a local Claude CLI login on this host",
        kind: "custom",
        choiceId: "anthropic-cli",
        fields: markerFields("claude-sonnet-4-5"),
        write: {
          providerId: "claude-cli",
          api: MODEL_API_ANTHROPIC,
          apiKeyMarker: "oauth:claude-cli"
        }
      },
      {
        id: "api-key",
        label: "Anthropic API Key",
        hint: "Direct Anthropic API key",
        kind: "api_key",
        choiceId: "apiKey",
        fields: apiKeyFields("ANTHROPIC_API_KEY", "claude-sonnet-4-5"),
        write: {
          api: MODEL_API_ANTHROPIC,
          defaultEnv: "ANTHROPIC_API_KEY"
        }
      },
      {
        id: "setup-token",
        label: "Anthropic setup-token",
        hint: "Paste a setup token generated by the Anthropic provider flow",
        kind: "token",
        choiceId: "setup-token",
        fields: tokenFields("Setup token", "claude-sonnet-4-5"),
        write: {
          api: MODEL_API_ANTHROPIC
        }
      }
    ]
  },
  apiProvider({
    id: "arcee",
    label: "Arcee AI",
    env: "ARCEEAI_API_KEY",
    choiceId: "arceeai-api-key",
    methodLabel: "Arcee AI API key",
    methodHint: "Direct access to Arcee platform"
  }),
  apiProvider({ id: "byteplus", label: "BytePlus", env: "BYTEPLUS_API_KEY", choiceId: "byteplus-api-key" }),
  apiProvider({
    id: "cerebras",
    label: "Cerebras",
    env: "CEREBRAS_API_KEY",
    choiceId: "cerebras-api-key",
    methodHint: "Fast OpenAI-compatible inference"
  }),
  {
    id: "chutes",
    label: "Chutes",
    methods: [
      {
        id: "oauth",
        label: "Chutes OAuth",
        hint: "Use an existing Chutes browser sign-in profile",
        kind: "oauth",
        choiceId: "chutes",
        fields: markerFields(),
        write: {
          api: MODEL_API_OPENAI,
          apiKeyMarker: "oauth:chutes"
        }
      },
      {
        id: "api-key",
        label: "Chutes API key",
        hint: "Open-source models including Llama, DeepSeek, and more",
        kind: "api_key",
        choiceId: "chutes-api-key",
        fields: apiKeyFields("CHUTES_API_KEY"),
        write: {
          api: MODEL_API_OPENAI,
          defaultEnv: "CHUTES_API_KEY"
        }
      }
    ]
  },
  {
    id: "cloudflare-ai-gateway",
    label: "Cloudflare AI Gateway",
    hint: "Account ID + Gateway ID + API key",
    methods: [
      {
        id: "api-key",
        label: "Cloudflare AI Gateway",
        hint: "OpenAI-compatible Cloudflare AI Gateway endpoint",
        kind: "api_key",
        choiceId: "cloudflare-ai-gateway-api-key",
        fields: apiKeyFields("CLOUDFLARE_API_TOKEN", "openai/gpt-4o-mini", [
          {
            id: "accountId",
            label: "Cloudflare Account ID",
            type: "text",
            required: true
          },
          {
            id: "gatewayId",
            label: "Cloudflare AI Gateway ID",
            type: "text",
            required: true
          }
        ]),
        write: {
          api: MODEL_API_OPENAI,
          defaultEnv: "CLOUDFLARE_API_TOKEN",
          baseUrlTemplate: (values) => {
            const accountId = readWizardString(values.accountId);
            const gatewayId = readWizardString(values.gatewayId);
            if (!accountId || !gatewayId) return undefined;
            return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openai`;
          }
        }
      }
    ]
  },
  {
    id: "codex",
    label: "Codex",
    hint: "Reuse a local Codex CLI login",
    methods: [
      {
        id: "codex-cli",
        label: "Codex CLI",
        hint: "Use an existing Codex CLI auth profile on this host",
        kind: "custom",
        choiceId: "codex-cli",
        fields: markerFields("gpt-5.5"),
        write: {
          providerId: "codex-cli",
          api: MODEL_API_OPENAI_CODEX,
          baseUrl: OPENAI_CODEX_RESPONSES_BASE_URL,
          apiKeyMarker: "oauth:codex-cli"
        }
      }
    ]
  },
  {
    id: "github-copilot",
    label: "Copilot",
    hint: "GitHub Copilot device login",
    methods: [
      {
        id: "device",
        label: "GitHub device login",
        hint: "Use an existing GitHub Copilot device-code auth profile",
        kind: "device_code",
        choiceId: "github-copilot",
        fields: markerFields("gpt-5-mini"),
        write: {
          api: MODEL_API_COPILOT,
          apiKeyMarker: "oauth:github-copilot"
        }
      }
    ]
  },
  apiProvider({ id: "deepinfra", label: "DeepInfra", env: "DEEPINFRA_API_KEY", choiceId: "deepinfra-api-key" }),
  apiProvider({ id: "deepseek", label: "DeepSeek", env: "DEEPSEEK_API_KEY", choiceId: "deepseek-api-key", modelPlaceholder: "deepseek-chat" }),
  apiProvider({ id: "fireworks", label: "Fireworks", env: "FIREWORKS_API_KEY", choiceId: "fireworks-api-key" }),
  apiProvider({
    id: "google",
    label: "Google",
    env: "GOOGLE_API_KEY",
    api: MODEL_API_GOOGLE,
    choiceId: "gemini-api-key",
    methodLabel: "Google Gemini API key",
    methodHint: "AI Studio / Gemini API key",
    modelPlaceholder: "gemini-2.5-pro"
  }),
  apiProvider({
    id: "google-vertex",
    label: "Google Vertex",
    env: "GOOGLE_APPLICATION_CREDENTIALS",
    api: MODEL_API_GOOGLE,
    choiceId: "google-vertex-api-key",
    methodLabel: "Google Vertex credentials",
    modelPlaceholder: "gemini-2.5-pro"
  }),
  apiProvider({ id: "groq", label: "Groq", env: "GROQ_API_KEY", choiceId: "groq-api-key" }),
  apiProvider({
    id: "huggingface",
    label: "Hugging Face",
    env: "HUGGINGFACE_API_KEY",
    choiceId: "huggingface-api-key",
    methodHint: "Inference API (HF token)"
  }),
  apiProvider({
    id: "kilocode",
    label: "Kilo Gateway",
    env: "KILOCODE_API_KEY",
    choiceId: "kilocode-api-key",
    methodHint: "API key (OpenRouter-compatible)"
  }),
  apiProvider({ id: "litellm", label: "LiteLLM", env: "LITELLM_API_KEY", choiceId: "litellm-api-key" }),
  {
    id: "lmstudio",
    label: "LM Studio",
    methods: [
      {
        id: "custom",
        label: "LM Studio",
        hint: "Local/self-hosted LM Studio server",
        kind: "local",
        fields: localFields("http://127.0.0.1:1234/v1", "local-model"),
        write: {
          api: MODEL_API_OPENAI,
          baseUrl: "http://127.0.0.1:1234/v1",
          apiKeyMarker: "lmstudio-local"
        }
      }
    ]
  },
  {
    id: "microsoft-foundry",
    label: "Microsoft Foundry",
    methods: [
      {
        id: "entra-id",
        label: "Entra ID (az login)",
        hint: "Use an existing Azure login; no API key needed",
        kind: "custom",
        choiceId: "microsoft-foundry-entra",
        fields: localFields("https://your-resource.openai.azure.com/openai/v1", "deployment-name"),
        write: {
          api: MODEL_API_AZURE,
          apiKeyMarker: "oauth:microsoft-foundry"
        }
      },
      {
        id: "api-key",
        label: "Azure OpenAI API key",
        hint: "Direct Azure OpenAI API key",
        kind: "api_key",
        choiceId: "microsoft-foundry-apikey",
        fields: apiKeyFields("AZURE_OPENAI_API_KEY", "deployment-name", [
          {
            id: "baseUrl",
            label: "Azure OpenAI base URL",
            type: "text",
            required: true,
            placeholder: "https://your-resource.openai.azure.com/openai/v1"
          }
        ]),
        write: {
          api: MODEL_API_AZURE,
          defaultEnv: "AZURE_OPENAI_API_KEY"
        }
      }
    ]
  },
  {
    id: "minimax",
    label: "MiniMax",
    methods: [
      {
        id: "api-cn",
        label: "MiniMax API Key (CN)",
        hint: "CN endpoint - api.minimaxi.com",
        kind: "api_key",
        choiceId: "minimax-cn-api",
        fields: apiKeyFields("MINIMAX_API_KEY", "MiniMax-Text-01"),
        write: {
          api: MODEL_API_OPENAI,
          baseUrl: "https://api.minimaxi.com/v1",
          defaultEnv: "MINIMAX_API_KEY"
        }
      },
      {
        id: "api-global",
        label: "MiniMax API Key (Global)",
        hint: "Global endpoint - api.minimax.io",
        kind: "api_key",
        choiceId: "minimax-global-api",
        fields: apiKeyFields("MINIMAX_API_KEY", "MiniMax-Text-01"),
        write: {
          api: MODEL_API_OPENAI,
          baseUrl: "https://api.minimax.io/v1",
          defaultEnv: "MINIMAX_API_KEY"
        }
      },
      {
        id: "oauth-cn",
        label: "MiniMax OAuth (CN)",
        hint: "CN endpoint - api.minimaxi.com",
        kind: "device_code",
        choiceId: "minimax-cn-oauth",
        fields: markerFields("MiniMax-Text-01"),
        write: {
          providerId: "minimax-portal",
          api: MODEL_API_OPENAI,
          baseUrl: "https://api.minimaxi.com/v1",
          apiKeyMarker: "minimax-oauth"
        }
      },
      {
        id: "oauth-global",
        label: "MiniMax OAuth (Global)",
        hint: "Global endpoint - api.minimax.io",
        kind: "device_code",
        choiceId: "minimax-global-oauth",
        fields: markerFields("MiniMax-Text-01"),
        write: {
          providerId: "minimax-portal",
          api: MODEL_API_OPENAI,
          baseUrl: "https://api.minimax.io/v1",
          apiKeyMarker: "minimax-oauth"
        }
      }
    ]
  },
  apiProvider({ id: "mistral", label: "Mistral AI", env: "MISTRAL_API_KEY", choiceId: "mistral-api-key" }),
  {
    id: "moonshot",
    label: "Moonshot AI (Kimi K2.6)",
    methods: [
      {
        id: "api-key",
        label: "Kimi API key (.ai)",
        hint: "Kimi K2.6 + Kimi",
        kind: "api_key",
        choiceId: "moonshot-api-key",
        fields: apiKeyFields("MOONSHOT_API_KEY", "kimi-k2-0905-preview"),
        write: {
          api: MODEL_API_OPENAI,
          defaultEnv: "MOONSHOT_API_KEY"
        }
      },
      {
        id: "api-key-cn",
        label: "Kimi API key (.cn)",
        hint: "Kimi K2.6 + Kimi",
        kind: "api_key",
        choiceId: "moonshot-api-key-cn",
        fields: apiKeyFields("MOONSHOT_API_KEY", "kimi-k2-0905-preview"),
        write: {
          api: MODEL_API_OPENAI,
          defaultEnv: "MOONSHOT_API_KEY"
        }
      }
    ]
  },
  apiProvider({ id: "nvidia", label: "NVIDIA", env: "NVIDIA_API_KEY", choiceId: "nvidia-api-key" }),
  {
    id: "ollama",
    label: "Ollama",
    methods: [
      {
        id: "local",
        label: "Ollama",
        hint: "Cloud and local open models",
        kind: "local",
        fields: localFields("http://127.0.0.1:11434/v1", "llama3.2"),
        write: {
          api: MODEL_API_OLLAMA,
          baseUrl: "http://127.0.0.1:11434/v1",
          apiKeyMarker: "ollama-local"
        }
      }
    ]
  },
  {
    id: "openai",
    label: "OpenAI",
    hint: "ChatGPT subscription or API key",
    methods: [
      {
        id: "chatgpt-login",
        label: "ChatGPT Login",
        hint: "Sign in with your ChatGPT or Codex subscription",
        kind: "oauth",
        choiceId: "openai",
        fields: markerFields("gpt-5.5"),
        write: {
          api: MODEL_API_OPENAI,
          baseUrl: OPENAI_RESPONSES_BASE_URL,
          apiKeyMarker: "oauth:openai"
        }
      },
      {
        id: "device-code",
        label: "ChatGPT Device Pairing",
        hint: "Pair your ChatGPT account in browser with a device code",
        kind: "device_code",
        choiceId: "openai-device-code",
        fields: markerFields("gpt-5.5"),
        write: {
          api: MODEL_API_OPENAI,
          baseUrl: OPENAI_RESPONSES_BASE_URL,
          apiKeyMarker: "oauth:openai"
        }
      },
      {
        id: "api-key",
        label: "OpenAI API Key",
        hint: "Use your OpenAI API key directly",
        kind: "api_key",
        choiceId: "openai-api-key",
        fields: apiKeyFields("OPENAI_API_KEY", "gpt-5.5"),
        write: {
          api: MODEL_API_OPENAI,
          baseUrl: OPENAI_RESPONSES_BASE_URL,
          defaultEnv: "OPENAI_API_KEY"
        }
      }
    ]
  },
  {
    id: "openai-codex",
    label: "OpenAI Codex",
    hint: "ChatGPT/Codex sign-in",
    methods: [
      {
        id: "oauth",
        label: "OpenAI Codex Browser Login",
        hint: "Sign in with OpenAI in your browser",
        kind: "oauth",
        choiceId: "openai-codex",
        fields: markerFields("gpt-5.5"),
        write: {
          api: MODEL_API_OPENAI_CODEX,
          baseUrl: OPENAI_CODEX_RESPONSES_BASE_URL,
          apiKeyMarker: "oauth:openai-codex"
        }
      },
      {
        id: "device-code",
        label: "OpenAI Codex Device Pairing",
        hint: "Pair in browser with a device code",
        kind: "device_code",
        choiceId: "openai-codex-device-code",
        fields: markerFields("gpt-5.5"),
        write: {
          api: MODEL_API_OPENAI_CODEX,
          baseUrl: OPENAI_CODEX_RESPONSES_BASE_URL,
          apiKeyMarker: "oauth:openai-codex"
        }
      },
      {
        id: "api-key",
        label: "OpenAI API Key Backup",
        hint: "Use an OpenAI API key when your Codex subscription is unavailable",
        kind: "api_key",
        choiceId: "openai-codex-api-key",
        fields: apiKeyFields("OPENAI_API_KEY", "gpt-5.5"),
        write: {
          providerId: "openai",
          api: MODEL_API_OPENAI,
          baseUrl: OPENAI_RESPONSES_BASE_URL,
          defaultEnv: "OPENAI_API_KEY"
        }
      }
    ]
  },
  apiProvider({
    id: "opencode",
    label: "OpenCode",
    env: "OPENCODE_API_KEY",
    choiceId: "opencode-zen",
    methodLabel: "OpenCode Zen catalog"
  }),
  apiProvider({ id: "openrouter", label: "OpenRouter", env: "OPENROUTER_API_KEY", choiceId: "openrouter-api-key", baseUrl: "https://openrouter.ai/api/v1" }),
  apiProvider({ id: "qianfan", label: "Qianfan", env: "QIANFAN_API_KEY", choiceId: "qianfan-api-key" }),
  {
    id: "qwen",
    label: "Qwen Cloud",
    methods: [
      qwenMethod("standard-api-key-cn", "Standard API Key for China (pay-as-you-go)", "qwen-standard-api-key-cn", "dashscope.aliyuncs.com"),
      qwenMethod("standard-api-key", "Standard API Key for Global/Intl (pay-as-you-go)", "qwen-standard-api-key", "dashscope-intl.aliyuncs.com"),
      qwenMethod("api-key-cn", "Coding Plan API Key for China (subscription)", "qwen-api-key-cn", "coding.dashscope.aliyuncs.com"),
      qwenMethod("api-key", "Coding Plan API Key for Global/Intl (subscription)", "qwen-api-key", "coding-intl.dashscope.aliyuncs.com")
    ]
  },
  {
    id: "sglang",
    label: "SGLang",
    methods: [
      {
        id: "custom",
        label: "SGLang",
        hint: "Fast self-hosted OpenAI-compatible server",
        kind: "local",
        fields: localFields("http://127.0.0.1:30000/v1", "local-model"),
        write: {
          api: MODEL_API_OPENAI,
          baseUrl: "http://127.0.0.1:30000/v1",
          apiKeyMarker: "custom-local"
        }
      }
    ]
  },
  {
    id: "stepfun",
    label: "Stepfun",
    methods: [
      stepfunMethod("standard-api-key-cn", "StepFun Standard API key (China)", "stepfun-standard-api-key-cn", "https://api.stepfun.com/v1"),
      stepfunMethod("standard-api-key-intl", "StepFun Standard API key (Global/Intl)", "stepfun-standard-api-key-intl", "https://api.stepfun.ai/v1")
    ]
  },
  {
    id: "stepfun-plan",
    label: "Stepfun Plan",
    methods: [
      stepfunMethod("plan-api-key-cn", "StepFun Step Plan API key (China)", "stepfun-plan-api-key-cn", "https://api.stepfun.com/step_plan/v1"),
      stepfunMethod("plan-api-key-intl", "StepFun Step Plan API key (Global/Intl)", "stepfun-plan-api-key-intl", "https://api.stepfun.ai/step_plan/v1")
    ]
  },
  apiProvider({
    id: "synthetic",
    label: "Synthetic",
    env: "SYNTHETIC_API_KEY",
    api: MODEL_API_ANTHROPIC,
    choiceId: "synthetic-api-key",
    methodHint: "Anthropic-compatible multi-model provider"
  }),
  apiProvider({
    id: "tencent-tokenhub",
    label: "Tencent Cloud (Tencent TokenHub)",
    env: "TENCENT_TOKENHUB_API_KEY",
    choiceId: "tokenhub-api-key",
    methodLabel: "Tencent TokenHub"
  }),
  apiProvider({ id: "together", label: "Together AI", env: "TOGETHER_API_KEY", choiceId: "together-api-key" }),
  apiProvider({ id: "venice", label: "Venice AI", env: "VENICE_API_KEY", choiceId: "venice-api-key" }),
  apiProvider({ id: "vercel-ai-gateway", label: "Vercel AI Gateway", env: "AI_GATEWAY_API_KEY", choiceId: "ai-gateway-api-key" }),
  {
    id: "vllm",
    label: "vLLM",
    methods: [
      {
        id: "custom",
        label: "vLLM",
        hint: "Local/self-hosted OpenAI-compatible server",
        kind: "local",
        fields: localFields("http://127.0.0.1:8000/v1", "local-model"),
        write: {
          api: MODEL_API_OPENAI,
          baseUrl: "http://127.0.0.1:8000/v1",
          apiKeyMarker: "custom-local"
        }
      }
    ]
  },
  apiProvider({ id: "volcengine", label: "Volcengine", env: "VOLCENGINE_API_KEY", choiceId: "volcengine-api-key" }),
  apiProvider({ id: "xai", label: "xAI", env: "XAI_API_KEY", choiceId: "xai-api-key" }),
  apiProvider({ id: "xiaomi", label: "Xiaomi", env: "XIAOMI_API_KEY", choiceId: "xiaomi-api-key" }),
  {
    id: "zai",
    label: "Z.AI",
    methods: [
      zaiMethod("api-key", "Z.AI API key", "zai-api-key"),
      zaiMethod("coding-global", "Coding-Plan-Global", "zai-coding-global", "https://api.z.ai/api/coding/paas/v4"),
      zaiMethod("coding-cn", "Coding-Plan-CN", "zai-coding-cn", "https://open.bigmodel.cn/api/coding/paas/v4"),
      zaiMethod("global", "Global", "zai-global", "https://api.z.ai/api/paas/v4"),
      zaiMethod("cn", "CN", "zai-cn", "https://open.bigmodel.cn/api/paas/v4")
    ]
  },
  {
    id: "custom",
    label: "Custom Provider",
    hint: "OpenAI-compatible or Anthropic-compatible custom endpoint",
    methods: [
      {
        id: "custom-api-key",
        label: "Custom Provider API key",
        hint: "Write a custom provider entry under models.providers",
        kind: "api_key",
        choiceId: "custom-api-key",
        fields: [
          {
            id: "providerId",
            label: "Provider ID",
            type: "text",
            required: true,
            placeholder: "my-provider"
          },
          ...apiKeyFields("CUSTOM_API_KEY", "model-name", [
            {
              id: "baseUrl",
              label: "Base URL",
              type: "text",
              required: true,
              placeholder: "https://api.example.com/v1"
            },
            {
              id: "api",
              label: "API compatibility",
              type: "select",
              defaultValue: MODEL_API_OPENAI,
              options: [
                { value: MODEL_API_OPENAI, label: "OpenAI Responses" },
                { value: "openai-completions", label: "OpenAI Completions" },
                { value: MODEL_API_ANTHROPIC, label: "Anthropic Messages" }
              ]
            }
          ])
        ],
        write: {
          providerIdField: "providerId",
          defaultEnv: "CUSTOM_API_KEY"
        }
      }
    ]
  }
];

function qwenMethod(id: string, label: string, choiceId: string, endpoint: string): ModelMethodDefinition {
  return {
    id,
    label,
    hint: `Endpoint: ${endpoint}`,
    kind: "api_key",
    choiceId,
    fields: apiKeyFields(id.includes("cn") ? "DASHSCOPE_API_KEY" : "DASHSCOPE_API_KEY", "qwen3-coder-plus"),
    write: {
      api: MODEL_API_OPENAI,
      baseUrl: `https://${endpoint}/compatible-mode/v1`,
      defaultEnv: "DASHSCOPE_API_KEY"
    }
  };
}

function stepfunMethod(id: string, label: string, choiceId: string, baseUrl: string): ModelMethodDefinition {
  return {
    id,
    label,
    hint: `Endpoint: ${baseUrl.replace(/^https?:\/\//, "")}`,
    kind: "api_key",
    choiceId,
    fields: apiKeyFields("STEPFUN_API_KEY", "step-2-mini"),
    write: {
      api: MODEL_API_OPENAI,
      baseUrl,
      defaultEnv: "STEPFUN_API_KEY"
    }
  };
}

function zaiMethod(id: string, label: string, choiceId: string, baseUrl?: string): ModelMethodDefinition {
  return {
    id,
    label,
    kind: "api_key",
    choiceId,
    fields: apiKeyFields("ZAI_API_KEY", "glm-4.5"),
    write: {
      api: MODEL_API_OPENAI,
      baseUrl,
      defaultEnv: "ZAI_API_KEY"
    }
  };
}

const commonChannelFields: OpenClawWizardField[] = [
  {
    id: "account",
    label: "Account ID",
    type: "text",
    placeholder: "default"
  },
  {
    id: "name",
    label: "Display name",
    type: "text",
    placeholder: "Support inbox"
  },
  {
    id: "useEnv",
    label: "Use environment variables",
    type: "checkbox",
    defaultValue: false
  }
];

const tokenChannelFields = (tokenId = "token", tokenLabel = "Token"): OpenClawWizardField[] => [
  ...commonChannelFields,
  {
    id: tokenId,
    label: tokenLabel,
    type: "password",
    placeholder: "Leave empty when using env"
  },
  {
    id: "tokenFile",
    label: "Token file",
    type: "text",
    placeholder: "Optional path"
  }
];

const CHANNEL_SETUP_OPTIONS: OpenClawChannelSetupOption[] = [
  {
    id: "telegram",
    label: "Telegram",
    hint: "Bot token account",
    fields: tokenChannelFields("token", "Bot token")
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    hint: "WhatsApp bridge token or URL",
    fields: [...tokenChannelFields("token", "Access token"), { id: "url", label: "Webhook URL", type: "text" }]
  },
  {
    id: "discord",
    label: "Discord",
    hint: "Bot token",
    fields: tokenChannelFields("botToken", "Bot token")
  },
  {
    id: "irc",
    label: "IRC",
    hint: "Server URL and password",
    fields: [
      ...commonChannelFields,
      { id: "url", label: "Server URL", type: "text", placeholder: "ircs://irc.example.net:6697/#channel" },
      { id: "password", label: "Password", type: "password" }
    ]
  },
  {
    id: "googlechat",
    label: "Google Chat",
    hint: "Webhook URL",
    fields: [...commonChannelFields, { id: "url", label: "Webhook URL", type: "text", required: true }]
  },
  {
    id: "slack",
    label: "Slack",
    hint: "Bot token + optional signing secret/app token",
    fields: [
      ...commonChannelFields,
      { id: "botToken", label: "Bot token", type: "password" },
      { id: "appToken", label: "App token", type: "password" },
      { id: "secret", label: "Signing secret", type: "password" }
    ]
  },
  {
    id: "signal",
    label: "Signal",
    hint: "Signal CLI / signal-cli-rest-api settings",
    fields: [
      ...commonChannelFields,
      { id: "signalNumber", label: "Signal number", type: "text", placeholder: "+15551234567" },
      { id: "httpUrl", label: "HTTP URL", type: "text", placeholder: "http://127.0.0.1:8080" },
      { id: "cliPath", label: "Signal CLI path", type: "text" },
      { id: "authDir", label: "Auth directory", type: "text" }
    ]
  },
  {
    id: "imessage",
    label: "iMessage",
    hint: "Local Messages database",
    fields: [
      ...commonChannelFields,
      { id: "dbPath", label: "Messages DB path", type: "text" },
      {
        id: "service",
        label: "Service",
        type: "select",
        defaultValue: "auto",
        options: [
          { value: "auto", label: "Auto" },
          { value: "iMessage", label: "iMessage" },
          { value: "SMS", label: "SMS" }
        ]
      },
      { id: "region", label: "Region", type: "text", placeholder: "US" }
    ]
  },
  {
    id: "feishu",
    label: "Feishu",
    hint: "App credentials",
    fields: [
      ...commonChannelFields,
      { id: "appToken", label: "App token", type: "password" },
      { id: "secret", label: "App secret", type: "password" },
      { id: "url", label: "Webhook URL", type: "text" }
    ]
  },
  { id: "nostr", label: "Nostr", hint: "Relay URL + private key", fields: [...commonChannelFields, { id: "url", label: "Relay URL", type: "text" }, { id: "secret", label: "Private key", type: "password" }] },
  { id: "msteams", label: "Microsoft Teams", hint: "Webhook URL", fields: [...commonChannelFields, { id: "url", label: "Webhook URL", type: "text", required: true }] },
  { id: "mattermost", label: "Mattermost", hint: "Base URL + token", fields: [...commonChannelFields, { id: "baseUrl", label: "Base URL", type: "text" }, { id: "token", label: "Token", type: "password" }] },
  { id: "nextcloud-talk", label: "Nextcloud Talk", hint: "Base URL + token/password", fields: [...commonChannelFields, { id: "baseUrl", label: "Base URL", type: "text" }, { id: "token", label: "Token", type: "password" }, { id: "password", label: "Password", type: "password" }] },
  { id: "matrix", label: "Matrix", hint: "Homeserver + token", fields: [...commonChannelFields, { id: "baseUrl", label: "Homeserver URL", type: "text" }, { id: "token", label: "Access token", type: "password" }] },
  { id: "line", label: "LINE", hint: "Channel token + secret", fields: [...commonChannelFields, { id: "token", label: "Channel access token", type: "password" }, { id: "secret", label: "Channel secret", type: "password" }] },
  { id: "zalo", label: "Zalo", hint: "Token + secret", fields: [...commonChannelFields, { id: "token", label: "Token", type: "password" }, { id: "secret", label: "Secret", type: "password" }] },
  { id: "clickclack", label: "ClickClack", hint: "Token", fields: tokenChannelFields("token", "Token") },
  { id: "zalouser", label: "Zalo User", hint: "Auth directory", fields: [...commonChannelFields, { id: "authDir", label: "Auth directory", type: "text" }] },
  { id: "synology-chat", label: "Synology Chat", hint: "Webhook URL", fields: [...commonChannelFields, { id: "url", label: "Webhook URL", type: "text" }] },
  { id: "tlon", label: "Tlon", hint: "URL + password", fields: [...commonChannelFields, { id: "url", label: "URL", type: "text" }, { id: "password", label: "Password", type: "password" }] },
  { id: "qa-channel", label: "QA Channel", hint: "Local QA channel", fields: commonChannelFields },
  { id: "qqbot", label: "QQ Bot", hint: "Bot token + secret", fields: [...commonChannelFields, { id: "botToken", label: "Bot token", type: "password" }, { id: "secret", label: "Secret", type: "password" }] },
  { id: "twitch", label: "Twitch", hint: "OAuth token", fields: tokenChannelFields("token", "OAuth token") }
];

export function getOpenClawConfigWizardMetadata(): OpenClawConfigWizardMetadata {
  return {
    modelProviders: MODEL_PROVIDER_DEFINITIONS.map(({ methods, ...provider }) => ({
      ...provider,
      methods: methods.map(({ write: _write, ...method }) => method)
    })),
    channels: CHANNEL_SETUP_OPTIONS
  };
}

export function buildModelAuthRequest(input: ConfigureOpenClawModelAuthRequest): CreateOpenClawModelRequest {
  const provider = MODEL_PROVIDER_DEFINITIONS.find((candidate) => candidate.id === input.providerId);
  if (!provider) throw new Error(`Unknown model provider: ${input.providerId}`);
  const method = provider.methods.find((candidate) => candidate.id === input.methodId);
  if (!method) throw new Error(`Unknown auth method for ${provider.id}: ${input.methodId}`);

  const providerIdFromField = method.write.providerIdField ? readWizardString(input.values[method.write.providerIdField]) : undefined;
  const providerId = providerIdFromField ?? method.write.providerId ?? provider.id;
  const modelId = readWizardString(input.values.modelId);
  if (!modelId) throw new Error("Model ID is required.");

  const api = readWizardString(input.values.api) ?? method.write.api;
  const baseUrl = readWizardString(input.values.baseUrl) ?? method.write.baseUrlTemplate?.(input.values) ?? method.write.baseUrl;
  const apiKeyEnv = readWizardString(input.values.apiKeyEnv);
  const directApiKey = readWizardString(input.values.apiKey);
  const markerApiKey = method.write.apiKeyMarker;

  return {
    provider: providerId,
    modelId,
    label: readWizardString(input.values.label),
    alias: readWizardString(input.values.alias),
    api,
    baseUrl,
    apiKeyEnv: markerApiKey ? undefined : apiKeyEnv,
    apiKey: markerApiKey ?? directApiKey,
    setDefault: input.values.setDefault !== false
  };
}

export function buildChannelRequest(input: ConfigureOpenClawChannelRequest): CreateOpenClawChannelRequest {
  const channel = CHANNEL_SETUP_OPTIONS.find((candidate) => candidate.id === input.channelId);
  if (!channel) throw new Error(`Unknown channel: ${input.channelId}`);

  const request: CreateOpenClawChannelRequest = {
    channel: channel.id,
    account: readWizardString(input.values.account),
    name: readWizardString(input.values.name),
    useEnv: input.values.useEnv === true
  };

  for (const key of [
    "token",
    "botToken",
    "appToken",
    "password",
    "secret",
    "url",
    "baseUrl",
    "dbPath",
    "httpHost",
    "httpPort",
    "httpUrl",
    "cliPath",
    "authDir",
    "region",
    "service",
    "signalNumber",
    "tokenFile",
    "secretFile"
  ] as const) {
    const value = readWizardString(input.values[key]);
    if (value) request[key] = value;
  }

  return request;
}

function readWizardString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
