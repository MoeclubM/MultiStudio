export type AudioSourceKind = "microphone" | "loopback" | "microphone+loopback";

export type AudioDeviceInfo = {
  id: string;
  name: string;
  kind: "input" | "output";
  isDefault: boolean;
};

export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  asrModel: string;
  llmModel: string;
};

export type AppConfig = {
  asr: ProviderConfig;
  llm: ProviderConfig;
  audio: {
    sourceKind: AudioSourceKind;
    inputDeviceId: string | null;
    sampleRate: number;
    vadEnabled: boolean;
    vadThreshold: number;
    silenceMs: number;
    minSegmentMs: number;
    maxSegmentMs: number;
  };
  translation: {
    sourceLang: string;
    targetLang: string;
    sourceLangLabel: string;
    targetLangLabel: string;
    extraPrompt: string;
    llmTemperature: number;
    streamTranslation: boolean;
  };
};

export type TranscriptSegment = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
  lang?: string;
  segments?: { start: number; end: number; text: string }[];
};

export type TranslationSegment = {
  id: string;
  transcriptId: string;
  translatedText: string;
  isStreaming: boolean;
  latencyMs?: number;
};

export type PipelineStatus =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export type PipelineEvent =
  | { type: "status"; status: PipelineStatus; message?: string }
  | { type: "level"; rms: number; peak: number }
  | { type: "transcript"; segment: TranscriptSegment }
  | { type: "translation_delta"; id: string; delta: string }
  | { type: "translation_done"; segment: TranslationSegment }
  | { type: "error"; message: string };

export type SessionEntry = {
  id: string;
  startedAt: string;
  transcript: string;
  translation: string;
  sourceLang: string;
  targetLang: string;
  durationMs: number;
};
