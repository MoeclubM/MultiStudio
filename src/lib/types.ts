export type ProviderConfig = { baseUrl: string; apiKey?: string; llmModel: string };
export type AppConfig = { llm: ProviderConfig };

export type SessionEntry = {
  id: string;
  startedAt: string;
  transcript: string;
  translation: string;
  sourceLang: string;
  targetLang: string;
  durationMs: number;
};
