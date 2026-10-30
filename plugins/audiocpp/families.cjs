const families = {
  confucius4_r2t2: { label: 'R2T2 识别', task: 'asr', kind: 'audiocpp.asr', streaming: true },
  qwen3_asr: { label: 'Qwen3 ASR', task: 'asr', kind: 'audiocpp.qwen3-asr', streaming: true },
  nemotron_asr: { label: 'NeMo 识别', task: 'asr', kind: 'audiocpp.nemo-asr', streaming: true },
  fun_asr_nano: { label: 'FunASR', task: 'asr', kind: 'audiocpp.funasr' },
  sense_asr: { label: 'SenseVoice', task: 'asr', kind: 'audiocpp.sensevoice', streaming: true },
  index_tts2: { label: 'IndexTTS', task: 'tts', language: true, kind: 'audiocpp.indextts' },
  qwen3_tts: { label: 'Qwen3 TTS', task: 'tts', language: true, kind: 'audiocpp.qwen3-tts' },
  cosyvoice3: { label: 'CosyVoice', task: 'tts', kind: 'audiocpp.cosyvoice', session: { 'cosyvoice3.weight_context_mb': '32', 'cosyvoice3.mem_saver': 'true' } },
  fish_drama3: { label: 'Fish Audio', task: 'tts', kind: 'audiocpp.fish', session: { 'fish_drama3.disk_experts': 'true', 'fish_drama3.expert_cache_size': '8', 'fish_drama3.cpu_expert_layers': '0', 'fish_drama3.codec_backend': 'cpu' } },
  breeze_tts: { label: 'Breeze TTS', task: 'tts', kind: 'audiocpp.breeze' },
};
module.exports = { families };
