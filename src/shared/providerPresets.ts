import type { ProviderProtocol, ProviderService, ProviderProfile } from './providers'

export type ProviderPreset = { id: string; name: string; service: ProviderService; protocol: ProviderProtocol; endpoint: string; models: string[]; logo: string; helpUrl: string; docsUrl: string; description: string }

// Catalog recovered from 闪电说 0.8.0; see reference/shandianshuo/provider-catalog.json.
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    "id": "llm-volcengine",
    "name": "Volcengine",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://ark.cn-beijing.volces.com/api/v3",
    "models": [
      "doubao-seed-2-0-mini-260428",
      "doubao-seed-2-1-turbo-260628",
      "doubao-seed-2-1-pro-260915",
      "doubao-seed-2-1-lite-260915",
      "doubao-seed-2-0-lite-260428"
    ],
    "logo": "./assets/providers/llm-volcengine.svg",
    "helpUrl": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    "docsUrl": "https://www.volcengine.com/docs/82379/1298454",
    "description": "Volcengine Ark API (Doubao)"
  },
  {
    "id": "llm-ark_coding",
    "name": "Volcengine Ark Agent/Coding Plan",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://ark.cn-beijing.volces.com/api/plan/v3",
    "models": [
      "doubao-seed-2.0-mini",
      "doubao-seed-2.1-turbo",
      "doubao-seed-2.0-lite"
    ],
    "logo": "./assets/providers/llm-ark_coding.svg",
    "helpUrl": "https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan?projectName=shandianshuo-member&agentMode=close",
    "docsUrl": "https://www.volcengine.com/docs/82379/2160841",
    "description": "Volcengine Ark Agent / Coding Plan (subscription; thinking disabled by default)"
  },
  {
    "id": "llm-openai",
    "name": "OpenAI",
    "service": "refinement",
    "protocol": "openai-responses",
    "endpoint": "https://api.openai.com/v1",
    "models": [
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-5.6-sol"
    ],
    "logo": "./assets/providers/llm-openai.svg",
    "helpUrl": "https://platform.openai.com/api-keys",
    "docsUrl": "https://platform.openai.com/docs/models",
    "description": "OpenAI GPT models"
  },
  {
    "id": "llm-xai",
    "name": "xAI (Grok)",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://api.x.ai/v1",
    "models": [
      "grok-4.7"
    ],
    "logo": "./assets/providers/llm-xai.svg",
    "helpUrl": "https://console.x.ai/",
    "docsUrl": "https://docs.x.ai/developers/models/grok-4.7",
    "description": "xAI Grok 4.7 (minimum reasoning effort for low latency)"
  },
  {
    "id": "llm-zhipu",
    "name": "Zhipu",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://open.bigmodel.cn/api/paas/v4",
    "models": [
      "glm-5.3-flash",
      "glm-5.3"
    ],
    "logo": "./assets/providers/llm-zhipu.svg",
    "helpUrl": "https://open.bigmodel.cn/usercenter/apikeys",
    "docsUrl": "https://docs.bigmodel.cn/cn/guide/start/model-overview",
    "description": "Zhipu GLM models"
  },
  {
    "id": "llm-deepseek",
    "name": "DeepSeek",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://api.deepseek.com/v1",
    "models": [
      "deepseek-flash",
      "deepseek-v4-pro"
    ],
    "logo": "./assets/providers/llm-deepseek.svg",
    "helpUrl": "https://platform.deepseek.com/api_keys",
    "docsUrl": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
    "description": "DeepSeek models"
  },
  {
    "id": "llm-tencent_tokenhub",
    "name": "Tencent Cloud TokenHub",
    "service": "refinement",
    "protocol": "openai-responses",
    "endpoint": "https://tokenhub.tencentmaas.com/v1",
    "models": [
      "hy3",
      "hy4-preview"
    ],
    "logo": "./assets/providers/llm-tencent_tokenhub.svg",
    "helpUrl": "https://console.cloud.tencent.com/tokenhub/models",
    "docsUrl": "https://cloud.tencent.com/document/product/1823/130079",
    "description": "Tencent Cloud TokenHub Hunyuan models (Responses API)"
  },
  {
    "id": "llm-qwen",
    "name": "Qwen",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "models": [
      "qwen3.8-flash",
      "qwen3.7-plus",
      "qwen3.8-max"
    ],
    "logo": "./assets/providers/llm-qwen.svg",
    "helpUrl": "https://bailian.console.aliyun.com/cn-beijing/#/api-key",
    "docsUrl": "https://help.aliyun.com/zh/model-studio/text-generation-model",
    "description": "Alibaba Cloud Qwen"
  },
  {
    "id": "llm-kimi",
    "name": "Kimi",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://api.moonshot.cn/v1",
    "models": [
      "kimi-k2.6"
    ],
    "logo": "./assets/providers/llm-kimi.svg",
    "helpUrl": "https://platform.kimi.com/console/api-keys",
    "docsUrl": "https://platform.kimi.com/docs/overview",
    "description": "Moonshot Kimi"
  },
  {
    "id": "llm-minimax",
    "name": "MiniMax",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://api.minimaxi.com/v1",
    "models": [
      "MiniMax-M3",
      "MiniMax-M2.7"
    ],
    "logo": "./assets/providers/llm-minimax.svg",
    "helpUrl": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    "docsUrl": "https://platform.minimaxi.com/docs/guides/text-generation",
    "description": "MiniMax models"
  },
  {
    "id": "llm-minimax_token_plan",
    "name": "MiniMax Token Plan",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://api.minimaxi.com/v1",
    "models": [
      "MiniMax-M3",
      "MiniMax-M2.7"
    ],
    "logo": "./assets/providers/llm-minimax_token_plan.svg",
    "helpUrl": "https://platform.minimaxi.com/user-center/payment/token-plan",
    "docsUrl": "https://platform.minimaxi.com/docs/token-plan/intro",
    "description": "MiniMax monthly plan"
  },
  {
    "id": "llm-siliconflow",
    "name": "SiliconFlow",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://api.siliconflow.cn/v1",
    "models": [
      "deepseek-ai/DeepSeek-V4-Flash"
    ],
    "logo": "./assets/providers/llm-siliconflow.svg",
    "helpUrl": "https://cloud.siliconflow.cn/account/ak",
    "docsUrl": "https://docs.siliconflow.cn/",
    "description": "SiliconFlow"
  },
  {
    "id": "llm-mimo",
    "name": "Xiaomi MiMo",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://api.xiaomimimo.com/v1",
    "models": [
      "mimo-v2.6-flash",
      "mimo-v2.6-pro",
      "mimo-v2.6-pro-ultraspeed"
    ],
    "logo": "./assets/providers/llm-mimo.png",
    "helpUrl": "https://platform.xiaomimimo.com/console/balance",
    "docsUrl": "https://mimo.mi.com/docs/zh-CN/api/chat/openai-api",
    "description": "Xiaomi MiMo V2.6 multimodal model"
  },
  {
    "id": "llm-stepfun",
    "name": "StepFun",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://api.stepfun.com/v1",
    "models": [
      "step-3.7-flash",
      "step-5-preview"
    ],
    "logo": "./assets/providers/llm-stepfun.svg",
    "helpUrl": "https://platform.stepfun.com/account/apikey",
    "docsUrl": "https://platform.stepfun.com/docs/zh/api-reference/chat/chat-completion-create",
    "description": "StepFun (hybrid reasoning; minimum reasoning effort, cannot fully disable thinking)"
  },
  {
    "id": "llm-tokendance",
    "name": "TokenDance",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://tokendance.space/gateway/v1",
    "models": [
      "deepseek-v4-flash",
      "glm-5.3-flash"
    ],
    "logo": "./assets/providers/llm-tokendance.svg",
    "helpUrl": "https://tokendance.space/",
    "docsUrl": "https://tokendance.space/docs/app-attribution",
    "description": "TokenDance unified model API"
  },
  {
    "id": "llm-mimo_token_plan",
    "name": "Xiaomi MiMo Token Plan",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://token-plan-cn.xiaomimimo.com/v1",
    "models": [
      "mimo-v2.6-flash",
      "mimo-v2.6-pro"
    ],
    "logo": "./assets/providers/llm-mimo_token_plan.png",
    "helpUrl": "https://platform.xiaomimimo.com/console/balance",
    "docsUrl": "https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/team",
    "description": "Xiaomi MiMo V2.6 monthly plan"
  },
  {
    "id": "llm-openai_compatible",
    "name": "OpenAI compatible",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "",
    "models": [],
    "logo": "./assets/providers/llm-openai_compatible.svg",
    "helpUrl": "",
    "docsUrl": "",
    "description": "Groq and other OpenAI-compatible APIs"
  },
  {
    "id": "llm-openrouter",
    "name": "OpenRouter",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "https://openrouter.ai/api/v1",
    "models": [],
    "logo": "./assets/providers/llm-openrouter.svg",
    "helpUrl": "https://openrouter.ai/keys",
    "docsUrl": "https://openrouter.ai/docs",
    "description": "OpenRouter model gateway"
  },
  {
    "id": "llm-ollama",
    "name": "Ollama",
    "service": "refinement",
    "protocol": "ollama",
    "endpoint": "http://localhost:11434",
    "models": [],
    "logo": "./assets/providers/llm-ollama.svg",
    "helpUrl": "https://ollama.ai/",
    "docsUrl": "https://ollama.ai/library",
    "description": "Local Ollama models"
  },
  {
    "id": "llm-lm_studio",
    "name": "LM Studio",
    "service": "refinement",
    "protocol": "openai-chat",
    "endpoint": "http://localhost:1234/v1",
    "models": [],
    "logo": "./assets/providers/llm-lm_studio.svg",
    "helpUrl": "https://lmstudio.ai/",
    "docsUrl": "https://lmstudio.ai/docs",
    "description": "Local LM Studio models"
  },
  {
    "id": "llm-gemini",
    "name": "Gemini",
    "service": "refinement",
    "protocol": "gemini",
    "endpoint": "https://generativelanguage.googleapis.com/v1beta",
    "models": [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.5-flash-lite"
    ],
    "logo": "./assets/providers/llm-gemini.svg",
    "helpUrl": "https://aistudio.google.com/apikey",
    "docsUrl": "https://ai.google.dev/gemini-api/docs",
    "description": "Google Gemini"
  },
  {
    "id": "llm-claude",
    "name": "Claude",
    "service": "refinement",
    "protocol": "anthropic",
    "endpoint": "https://api.anthropic.com/v1",
    "models": [
      "claude-sonnet-5",
      "claude-opus-5"
    ],
    "logo": "./assets/providers/llm-claude.svg",
    "helpUrl": "https://console.anthropic.com/settings/keys",
    "docsUrl": "https://platform.claude.com/docs/en/about-claude/models/overview",
    "description": "Anthropic Claude"
  },
  {
    "id": "llm-azure_openai",
    "name": "Azure OpenAI",
    "service": "refinement",
    "protocol": "azure-openai",
    "endpoint": "",
    "models": [],
    "logo": "./assets/providers/llm-azure_openai.svg",
    "helpUrl": "https://portal.azure.com/",
    "docsUrl": "https://learn.microsoft.com/azure/ai-services/openai/",
    "description": "Microsoft Azure OpenAI Service"
  },
  {
    "id": "asr-aliyun_qwen",
    "name": "Alibaba Cloud",
    "service": "transcription",
    "protocol": "qwen-asr",
    "endpoint": "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
    "models": [
      "fun-asr-realtime",
      "qwen3-asr-flash",
      "fun-asr-flash-2026-06-15"
    ],
    "logo": "./assets/providers/asr-aliyun_qwen.svg",
    "helpUrl": "https://bailian.console.aliyun.com/cn-beijing/#/api-key",
    "docsUrl": "https://bailian.console.aliyun.com/#/model-market",
    "description": "Alibaba Cloud Bailian realtime transcription"
  },
  {
    "id": "asr-stepfun",
    "name": "StepFun",
    "service": "transcription",
    "protocol": "stepfun-asr",
    "endpoint": "https://api.stepfun.com/v1",
    "models": [
      "stepaudio-2.5-asr"
    ],
    "logo": "./assets/providers/asr-stepfun.svg",
    "helpUrl": "https://platform.stepfun.com/account/apikey",
    "docsUrl": "https://platform.stepfun.com/docs/zh/api-reference/audio/asr-sse",
    "description": "StepAudio 2.5 non-streaming transcription"
  },
  {
    "id": "asr-mimo",
    "name": "Xiaomi MiMo",
    "service": "transcription",
    "protocol": "mimo-asr",
    "endpoint": "https://api.xiaomimimo.com/v1",
    "models": [
      "mimo-v2.5-asr"
    ],
    "logo": "./assets/providers/asr-mimo.png",
    "helpUrl": "https://platform.xiaomimimo.com",
    "docsUrl": "https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/multimodal-understanding/Speech-Recognition",
    "description": "MiMo V2.5 ASR non-streaming transcription"
  },
  {
    "id": "asr-soniox",
    "name": "Soniox",
    "service": "transcription",
    "protocol": "soniox",
    "endpoint": "wss://stt-rt.soniox.com/transcribe-websocket",
    "models": [
      "stt-rt-v5"
    ],
    "logo": "./assets/providers/asr-soniox.svg",
    "helpUrl": "https://console.soniox.com/",
    "docsUrl": "https://soniox.com/docs/stt/rt/real-time-transcription",
    "description": "Soniox realtime transcription"
  },
  {
    "id": "asr-elevenlabs",
    "name": "ElevenLabs",
    "service": "transcription",
    "protocol": "elevenlabs",
    "endpoint": "wss://api.elevenlabs.io/v1/speech-to-text/realtime",
    "models": [
      "scribe_v2_realtime",
      "scribe_v2"
    ],
    "logo": "./assets/providers/asr-elevenlabs.svg",
    "helpUrl": "https://elevenlabs.io/app/settings/api-keys",
    "docsUrl": "https://elevenlabs.io/docs/api-reference/speech-to-text/convert",
    "description": "ElevenLabs Scribe transcription"
  },
  {
    "id": "asr-openai_realtime",
    "name": "OpenAI",
    "service": "transcription",
    "protocol": "openai-realtime",
    "endpoint": "wss://api.openai.com/v1/realtime",
    "models": [
      "gpt-realtime-whisper"
    ],
    "logo": "./assets/providers/asr-openai_realtime.svg",
    "helpUrl": "https://platform.openai.com/api-keys",
    "docsUrl": "https://developers.openai.com/api/docs/models/gpt-realtime-whisper",
    "description": "OpenAI Realtime streaming transcription"
  },
  {
    "id": "asr-volcengine",
    "name": "Volcengine",
    "service": "transcription",
    "protocol": "volcengine-asr",
    "endpoint": "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream",
    "models": [
      "bigmodel_nostream"
    ],
    "logo": "./assets/providers/asr-volcengine.svg",
    "helpUrl": "https://console.volcengine.com/speech/new/setting/apikeys?projectName=default",
    "docsUrl": "https://www.volcengine.com/docs/6561/1354869?lang=zh",
    "description": "Volcengine large-model transcription"
  },
  {
    "id": "asr-openai",
    "name": "OpenAI compatible",
    "service": "transcription",
    "protocol": "openai-transcription",
    "endpoint": "https://api.openai.com/v1",
    "models": [
      "whisper-1",
      "gpt-4o-mini-transcribe",
      "gpt-4o-transcribe"
    ],
    "logo": "./assets/providers/llm-openai.svg",
    "helpUrl": "https://platform.openai.com/api-keys",
    "docsUrl": "https://developers.openai.com/api/docs/guides/speech-to-text",
    "description": "Whisper and compatible audio transcription services"
  },
  {
    "id": "asr-audio-chat",
    "name": "Custom transcription",
    "service": "transcription",
    "protocol": "audio-chat",
    "endpoint": "",
    "models": [],
    "logo": "./assets/providers/llm-openai_compatible.svg",
    "helpUrl": "",
    "docsUrl": "",
    "description": "OpenAI-compatible service with audio messages"
  },
  {
    "id": "asr-local-whisper",
    "name": "Whisper",
    "service": "transcription",
    "protocol": "local-whisper",
    "endpoint": "whisper-cli",
    "models": [],
    "logo": "./assets/providers/llm-ollama.svg",
    "helpUrl": "",
    "docsUrl": "https://github.com/ggml-org/whisper.cpp",
    "description": "Uses an installed whisper.cpp executable and local model"
  }
]

export function createProviderProfile(preset: ProviderPreset, id: string = preset.id): ProviderProfile {
  const common = { id, presetId: preset.id, name: preset.name, enabled: false, endpoint: preset.endpoint, apiKey: '', models: [...preset.models], appId: '', accessToken: '', resourceId: 'volc.bigasr.sauc.duration', apiVersion: '2024-10-21' }
  if (preset.service === 'transcription') {
    const protocol = preset.protocol
    if (protocol === 'openai-chat' || protocol === 'openai-responses' || protocol === 'anthropic' || protocol === 'gemini' || protocol === 'ollama' || protocol === 'azure-openai') throw new Error('Invalid transcription preset')
    return { ...common, service: 'transcription', protocol }
  }
  const protocol = preset.protocol
  if (protocol !== 'openai-chat' && protocol !== 'openai-responses' && protocol !== 'anthropic' && protocol !== 'gemini' && protocol !== 'ollama' && protocol !== 'azure-openai') throw new Error('Invalid refinement preset')
  return { ...common, service: 'refinement', protocol, thinkingMode: 'auto' }
}
