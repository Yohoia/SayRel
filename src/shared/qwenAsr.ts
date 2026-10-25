export function qwenAsrRoute(model: string): 'message' | 'streaming' | 'task' | 'batch' | 'realtime' {
  if (/^qwen-audio-[\d.]+-asr-flash-message$/.test(model)) return 'message'
  if (/^qwen-audio-[\d.]+-asr-flash-streaming$/.test(model)) return 'streaming'
  if (/^(?:fun-asr-flash|qwen-audio-[\d.]+-asr-flash)/.test(model) && !model.includes('realtime')) return 'batch'
  return model.startsWith('fun-asr') ? 'task' : 'realtime'
}
