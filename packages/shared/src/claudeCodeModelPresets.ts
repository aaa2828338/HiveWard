import type { ClaudeCodeAuthEnvKey, ClaudeCodeModelPreset } from "./api";

const AUTH_TOKEN: ClaudeCodeAuthEnvKey = "ANTHROPIC_AUTH_TOKEN";
const API_KEY: ClaudeCodeAuthEnvKey = "ANTHROPIC_API_KEY";

type ModelSlotDefaults = Pick<
  ClaudeCodeModelPreset,
  "fallbackModelId" | "haikuModelId" | "sonnetModelId" | "opusModelId"
>;
type ModelDefaults = ModelSlotDefaults & Pick<ClaudeCodeModelPreset, "modelOptions">;

const CLAUDE_MODEL_OPTIONS = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001"
];

const ANTHROPIC_ROUTE_MODEL_OPTIONS = [
  "anthropic/claude-opus-4.7",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-opus-4.5",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-haiku-4.5"
];

const GLM_MODEL_OPTIONS = [
  "glm-5.1",
  "glm-5-turbo",
  "glm-5",
  "glm-4.7",
  "glm-4.7-flash",
  "glm-4.7-flashx",
  "glm-4.6",
  "glm-4.5-air",
  "glm-4.5-airx",
  "glm-4.5-flash"
];

const KIMI_MODEL_OPTIONS = [
  "kimi-k2.6",
  "kimi-k2.5",
  "moonshot-v1-8k",
  "moonshot-v1-32k",
  "moonshot-v1-128k",
  "moonshot-v1-8k-vision-preview",
  "moonshot-v1-32k-vision-preview",
  "moonshot-v1-128k-vision-preview"
];

const MINIMAX_MODEL_OPTIONS = [
  "MiniMax-M2.7",
  "MiniMax-M2.7-highspeed",
  "MiniMax-M2.5",
  "MiniMax-M2.5-highspeed",
  "MiniMax-M2.1",
  "MiniMax-M2.1-highspeed",
  "MiniMax-M2",
  "M2-her"
];

const STEPFUN_MODEL_OPTIONS = [
  "step-3.5-flash-2603",
  "step-3.5-flash"
];

const XIAOMI_MIMO_MODEL_OPTIONS = [
  "mimo-v2.5-pro",
  "mimo-v2.5",
  "mimo-v2-pro",
  "mimo-v2-omni",
  "mimo-v2-flash"
];

function sameModel(modelId: string, modelOptions?: string[]): ModelDefaults {
  return {
    fallbackModelId: modelId,
    haikuModelId: modelId,
    sonnetModelId: modelId,
    opusModelId: modelId,
    modelOptions
  };
}

function modelSlots(input: ModelDefaults): ModelDefaults {
  return input;
}

function inferPlanMetadata(preset: ClaudeCodeModelPreset): Pick<ClaudeCodeModelPreset, "planType" | "planProvider"> {
  const baseUrl = preset.baseUrl ?? "";
  const name = preset.name;

  if (preset.id === "xiaomi-mimo-token-plan-cn") return { planType: "token_plan", planProvider: "xiaomi_mimo" };
  if (/api\.kimi\.com\/coding/i.test(baseUrl)) return { planType: "coding_plan", planProvider: "kimi" };
  if (/bigmodel\.cn|api\.z\.ai/i.test(baseUrl)) return { planType: "coding_plan", planProvider: "zhipu" };
  if (/api\.minimaxi?\.com|api\.minimax\.io/i.test(baseUrl)) return { planType: "coding_plan", planProvider: "minimax" };
  if (/qianfan\.baidubce\.com\/anthropic\/coding/i.test(baseUrl)) return { planType: "coding_plan", planProvider: "baidu_qianfan" };
  if (/\/api\/coding|\/anthropic\/coding|\/coding\/?$/i.test(baseUrl) || /agentplan|coding plan/i.test(name)) {
    return { planType: "coding_plan", planProvider: preset.id.replace(/-(cn|global)$/u, "").replace(/-/gu, "_") };
  }
  return {};
}

function preset(input: ClaudeCodeModelPreset): ClaudeCodeModelPreset {
  return {
    authEnvKey: AUTH_TOKEN,
    ...inferPlanMetadata(input),
    ...input
  };
}

// Rebuilt from CC Switch's MIT-licensed Claude provider presets.
// This list keeps direct Claude Code-compatible Anthropic-format settings only.
// Proxy-only formats, OAuth-only providers, and template-only cloud credentials are intentionally omitted.
export const claudeCodeModelPresets: ClaudeCodeModelPreset[] = [
  preset({
    id: "shengsuanyun",
    name: "Shengsuanyun",
    category: "aggregator",
    websiteUrl: "https://www.shengsuanyun.com",
    apiKeyUrl: "https://www.shengsuanyun.com",
    baseUrl: "https://router.shengsuanyun.com/api"
  }),
  preset({
    id: "pateway-ai",
    name: "PatewayAI",
    category: "third_party",
    websiteUrl: "https://pateway.ai",
    apiKeyUrl: "https://pateway.ai",
    baseUrl: "https://api.pateway.ai",
    authEnvKey: API_KEY
  }),
  preset({
    id: "volcengine-agentplan",
    name: "Volcengine AgentPlan",
    category: "cn_official",
    websiteUrl: "https://www.volcengine.com/activity/agentplan",
    apiKeyUrl: "https://www.volcengine.com/activity/agentplan",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding",
    ...sameModel("ark-code-latest")
  }),
  preset({
    id: "byteplus",
    name: "BytePlus",
    category: "cn_official",
    websiteUrl: "https://www.byteplus.com/en/product/modelark",
    apiKeyUrl: "https://www.byteplus.com/en/product/modelark",
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/coding",
    ...sameModel("ark-code-latest")
  }),
  preset({
    id: "doubao-seed",
    name: "DouBaoSeed",
    category: "cn_official",
    websiteUrl: "https://console.volcengine.com/ark",
    apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    baseUrl: "https://ark.cn-beijing.volces.com/api/compatible",
    ...sameModel("doubao-seed-2-0-code-preview-latest"),
    extraEnv: { API_TIMEOUT_MS: "3000000" }
  }),
  preset({
    id: "deepseek",
    name: "DeepSeek",
    category: "cn_official",
    websiteUrl: "https://platform.deepseek.com",
    baseUrl: "https://api.deepseek.com/anthropic",
    ...modelSlots({
      fallbackModelId: "deepseek-v4-pro",
      haikuModelId: "deepseek-v4-flash",
      sonnetModelId: "deepseek-v4-pro",
      opusModelId: "deepseek-v4-pro",
      modelOptions: ["deepseek-v4-pro", "deepseek-v4-flash"]
    })
  }),
  preset({
    id: "zhipu-glm",
    name: "Zhipu GLM",
    category: "cn_official",
    websiteUrl: "https://open.bigmodel.cn",
    apiKeyUrl: "https://www.bigmodel.cn/claude-code",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    ...sameModel("glm-5", GLM_MODEL_OPTIONS)
  }),
  preset({
    id: "zhipu-glm-global",
    name: "Zhipu GLM en",
    category: "cn_official",
    websiteUrl: "https://z.ai",
    apiKeyUrl: "https://z.ai/subscribe",
    baseUrl: "https://api.z.ai/api/anthropic",
    ...sameModel("glm-5", GLM_MODEL_OPTIONS)
  }),
  preset({
    id: "baidu-qianfan-coding",
    name: "Baidu Qianfan Coding Plan",
    category: "cn_official",
    websiteUrl: "https://cloud.baidu.com/product/qianfan_modelbuilder",
    apiKeyUrl: "https://console.bce.baidu.com/qianfan/ais/console/applicationConsole/application",
    baseUrl: "https://qianfan.baidubce.com/anthropic/coding",
    ...sameModel("qianfan-code-latest")
  }),
  preset({
    id: "bailian",
    name: "Bailian",
    category: "cn_official",
    websiteUrl: "https://bailian.console.aliyun.com",
    baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic"
  }),
  preset({
    id: "bailian-coding",
    name: "Bailian For Coding",
    category: "cn_official",
    websiteUrl: "https://bailian.console.aliyun.com",
    baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic"
  }),
  preset({
    id: "kimi",
    name: "Kimi",
    category: "cn_official",
    websiteUrl: "https://platform.moonshot.cn/console",
    baseUrl: "https://api.moonshot.cn/anthropic",
    ...sameModel("kimi-k2.6", KIMI_MODEL_OPTIONS)
  }),
  preset({
    id: "kimi-coding",
    name: "Kimi For Coding",
    category: "cn_official",
    websiteUrl: "https://www.kimi.com/code/docs/",
    baseUrl: "https://api.kimi.com/coding/",
    modelOptions: KIMI_MODEL_OPTIONS
  }),
  preset({
    id: "stepfun",
    name: "StepFun",
    category: "cn_official",
    websiteUrl: "https://platform.stepfun.com/step-plan",
    apiKeyUrl: "https://platform.stepfun.com/interface-key",
    baseUrl: "https://api.stepfun.com/step_plan",
    ...sameModel("step-3.5-flash-2603", STEPFUN_MODEL_OPTIONS)
  }),
  preset({
    id: "stepfun-global",
    name: "StepFun en",
    category: "cn_official",
    websiteUrl: "https://platform.stepfun.ai/step-plan",
    apiKeyUrl: "https://platform.stepfun.ai/interface-key",
    baseUrl: "https://api.stepfun.ai/step_plan",
    ...sameModel("step-3.5-flash-2603", STEPFUN_MODEL_OPTIONS)
  }),
  preset({
    id: "modelscope",
    name: "ModelScope",
    category: "aggregator",
    websiteUrl: "https://modelscope.cn",
    baseUrl: "https://api-inference.modelscope.cn",
    ...sameModel("ZhipuAI/GLM-5")
  }),
  preset({
    id: "longcat",
    name: "Longcat",
    category: "cn_official",
    websiteUrl: "https://longcat.chat/platform",
    apiKeyUrl: "https://longcat.chat/platform/api_keys",
    baseUrl: "https://api.longcat.chat/anthropic",
    ...sameModel("LongCat-Flash-Chat"),
    extraEnv: {
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: "6000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1
    }
  }),
  preset({
    id: "minimax-cn",
    name: "MiniMax",
    category: "cn_official",
    websiteUrl: "https://platform.minimaxi.com",
    apiKeyUrl: "https://platform.minimaxi.com/subscribe/coding-plan",
    baseUrl: "https://api.minimaxi.com/anthropic",
    ...sameModel("MiniMax-M2.7", MINIMAX_MODEL_OPTIONS),
    extraEnv: {
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1
    }
  }),
  preset({
    id: "minimax-global",
    name: "MiniMax en",
    category: "cn_official",
    websiteUrl: "https://platform.minimax.io",
    apiKeyUrl: "https://platform.minimax.io/subscribe/coding-plan",
    baseUrl: "https://api.minimax.io/anthropic",
    ...sameModel("MiniMax-M2.7", MINIMAX_MODEL_OPTIONS),
    extraEnv: {
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1
    }
  }),
  preset({
    id: "bailing",
    name: "BaiLing",
    category: "cn_official",
    websiteUrl: "https://alipaytbox.yuque.com/sxs0ba/ling/get_started",
    baseUrl: "https://api.tbox.cn/api/anthropic",
    ...sameModel("Ling-2.5-1T")
  }),
  preset({
    id: "aihubmix",
    name: "AiHubMix",
    category: "aggregator",
    websiteUrl: "https://aihubmix.com",
    apiKeyUrl: "https://aihubmix.com",
    baseUrl: "https://aihubmix.com",
    authEnvKey: API_KEY
  }),
  preset({
    id: "siliconflow-cn",
    name: "SiliconFlow",
    category: "aggregator",
    websiteUrl: "https://siliconflow.cn",
    apiKeyUrl: "https://cloud.siliconflow.cn",
    baseUrl: "https://api.siliconflow.cn",
    ...sameModel("Pro/MiniMaxAI/MiniMax-M2.7")
  }),
  preset({
    id: "siliconflow-global",
    name: "SiliconFlow en",
    category: "aggregator",
    websiteUrl: "https://siliconflow.com",
    apiKeyUrl: "https://cloud.siliconflow.cn",
    baseUrl: "https://api.siliconflow.com",
    ...sameModel("MiniMaxAI/MiniMax-M2.7")
  }),
  preset({
    id: "dmxapi",
    name: "DMXAPI",
    category: "aggregator",
    websiteUrl: "https://www.dmxapi.cn",
    apiKeyUrl: "https://www.dmxapi.cn",
    baseUrl: "https://www.dmxapi.cn"
  }),
  preset({
    id: "packycode",
    name: "PackyCode",
    category: "third_party",
    websiteUrl: "https://www.packyapi.com",
    apiKeyUrl: "https://www.packyapi.com",
    baseUrl: "https://www.packyapi.com"
  }),
  preset({
    id: "claudeapi",
    name: "ClaudeAPI",
    category: "aggregator",
    websiteUrl: "https://claudeapi.com",
    apiKeyUrl: "https://console.claudeapi.com",
    baseUrl: "https://gw.claudeapi.com"
  }),
  preset({
    id: "claudecn",
    name: "ClaudeCN",
    category: "third_party",
    websiteUrl: "https://claudecn.top",
    apiKeyUrl: "https://claudecn.top/register",
    baseUrl: "https://claudecn.top"
  }),
  preset({
    id: "runapi",
    name: "RunAPI",
    category: "aggregator",
    websiteUrl: "https://runapi.co",
    apiKeyUrl: "https://runapi.co",
    baseUrl: "https://runapi.co"
  }),
  preset({
    id: "relaxycode",
    name: "RelaxyCode",
    category: "third_party",
    websiteUrl: "https://www.relaxycode.com",
    apiKeyUrl: "https://www.relaxycode.com/register",
    baseUrl: "https://www.relaxycode.com"
  }),
  preset({
    id: "cubence",
    name: "Cubence",
    category: "third_party",
    websiteUrl: "https://cubence.com",
    apiKeyUrl: "https://cubence.com/signup",
    baseUrl: "https://api.cubence.com"
  }),
  preset({
    id: "aigocode",
    name: "AIGoCode",
    category: "third_party",
    websiteUrl: "https://aigocode.com",
    apiKeyUrl: "https://aigocode.com",
    baseUrl: "https://api.aigocode.com"
  }),
  preset({
    id: "rightcode",
    name: "RightCode",
    category: "third_party",
    websiteUrl: "https://www.right.codes",
    apiKeyUrl: "https://www.right.codes/register",
    baseUrl: "https://www.right.codes/claude"
  }),
  preset({
    id: "aicodemirror",
    name: "AICodeMirror",
    category: "third_party",
    websiteUrl: "https://www.aicodemirror.com",
    apiKeyUrl: "https://www.aicodemirror.com/register",
    baseUrl: "https://api.aicodemirror.com/api/claudecode"
  }),
  preset({
    id: "crazyrouter",
    name: "CrazyRouter",
    category: "third_party",
    websiteUrl: "https://www.crazyrouter.com",
    apiKeyUrl: "https://www.crazyrouter.com/register",
    baseUrl: "https://cn.crazyrouter.com"
  }),
  preset({
    id: "sssaicode",
    name: "SSSAiCode",
    category: "third_party",
    websiteUrl: "https://www.sssaicode.com",
    apiKeyUrl: "https://www.sssaicode.com/register",
    baseUrl: "https://node-hk.sssaicode.com/api"
  }),
  preset({
    id: "compshare",
    name: "Compshare",
    category: "aggregator",
    websiteUrl: "https://www.compshare.cn",
    apiKeyUrl: "https://www.compshare.cn/coding-plan",
    baseUrl: "https://api.modelverse.cn"
  }),
  preset({
    id: "compshare-coding",
    name: "Compshare Coding Plan",
    category: "aggregator",
    websiteUrl: "https://www.compshare.cn",
    apiKeyUrl: "https://www.compshare.cn/coding-plan",
    baseUrl: "https://cp.compshare.cn"
  }),
  preset({
    id: "micu",
    name: "Micu",
    category: "third_party",
    websiteUrl: "https://www.micuapi.ai",
    apiKeyUrl: "https://www.micuapi.ai/register",
    baseUrl: "https://www.micuapi.ai"
  }),
  preset({
    id: "ctok",
    name: "CTok.ai",
    category: "third_party",
    websiteUrl: "https://ctok.ai",
    apiKeyUrl: "https://ctok.ai",
    baseUrl: "https://api.ctok.ai"
  }),
  preset({
    id: "openrouter",
    name: "OpenRouter",
    category: "aggregator",
    websiteUrl: "https://openrouter.ai",
    apiKeyUrl: "https://openrouter.ai/keys",
    baseUrl: "https://openrouter.ai/api",
    ...modelSlots({
      fallbackModelId: "anthropic/claude-sonnet-4.6",
      haikuModelId: "anthropic/claude-haiku-4.5",
      sonnetModelId: "anthropic/claude-sonnet-4.6",
      opusModelId: "anthropic/claude-opus-4.7",
      modelOptions: ANTHROPIC_ROUTE_MODEL_OPTIONS
    })
  }),
  preset({
    id: "therouter",
    name: "TheRouter",
    category: "aggregator",
    websiteUrl: "https://therouter.ai",
    apiKeyUrl: "https://dashboard.therouter.ai",
    baseUrl: "https://api.therouter.ai",
    ...modelSlots({
      fallbackModelId: "anthropic/claude-sonnet-4.6",
      haikuModelId: "anthropic/claude-haiku-4.5",
      sonnetModelId: "anthropic/claude-sonnet-4.6",
      opusModelId: "anthropic/claude-opus-4.7",
      modelOptions: ANTHROPIC_ROUTE_MODEL_OPTIONS
    })
  }),
  preset({
    id: "novita-ai",
    name: "Novita AI",
    category: "aggregator",
    websiteUrl: "https://novita.ai",
    apiKeyUrl: "https://novita.ai",
    baseUrl: "https://api.novita.ai/anthropic",
    ...sameModel("zai-org/glm-5")
  }),
  preset({
    id: "lemondata",
    name: "LemonData",
    category: "third_party",
    websiteUrl: "https://lemondata.cc",
    apiKeyUrl: "https://lemondata.cc",
    baseUrl: "https://api.lemondata.cc",
    authEnvKey: API_KEY
  }),
  preset({
    id: "pipellm",
    name: "PIPELLM",
    category: "aggregator",
    websiteUrl: "https://code.pipellm.ai",
    apiKeyUrl: "https://code.pipellm.ai/login",
    baseUrl: "https://cc-api.pipellm.ai",
    ...modelSlots({
      fallbackModelId: "claude-opus-4-7",
      haikuModelId: "claude-haiku-4-5-20251001",
      sonnetModelId: "claude-sonnet-4-6",
      opusModelId: "claude-opus-4-7",
      modelOptions: CLAUDE_MODEL_OPTIONS
    })
  }),
  preset({
    id: "xiaomi-mimo",
    name: "Xiaomi MiMo",
    category: "cn_official",
    websiteUrl: "https://platform.xiaomimimo.com",
    apiKeyUrl: "https://platform.xiaomimimo.com/#/console/api-keys",
    baseUrl: "https://api.xiaomimimo.com/anthropic",
    ...sameModel("mimo-v2.5-pro", XIAOMI_MIMO_MODEL_OPTIONS)
  }),
  preset({
    id: "xiaomi-mimo-token-plan-cn",
    name: "Xiaomi MiMo Token Plan (China)",
    category: "cn_official",
    websiteUrl: "https://platform.xiaomimimo.com/#/token-plan",
    apiKeyUrl: "https://platform.xiaomimimo.com/#/console/plan-manage",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
    ...sameModel("mimo-v2.5-pro", XIAOMI_MIMO_MODEL_OPTIONS)
  })
];
