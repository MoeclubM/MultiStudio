export type ConversationMode = "text" | "asr" | "tts";
export type Message = { id: string; role: "user" | "assistant"; content: string; audioId?: string | null; status: "complete" | "pending" | "error" | "interrupted"; error?: string | null; model?: string; createdAt: string };
export type Conversation = { id: string; title: string; mode: ConversationMode; createdAt: string; updatedAt: string; messages: Message[] };
export type ConversationSummary = Omit<Conversation, "messages"> & { count: number };
export type SpeechSettings = { baseUrl: string; asrModel: string; ttsModel: string; voice: string; hasApiKey: boolean; keyPersistent: boolean };
export const DEFAULT_SPEECH: SpeechSettings = { baseUrl: "", asrModel: "whisper-1", ttsModel: "tts-1", voice: "alloy", hasApiKey: false, keyPersistent: false };
export const modeLabels: Record<ConversationMode, string> = { text: "文本对话", asr: "语音转文字", tts: "文本转语音" };
export function audioUrl(id: string) { return `prism://app/__audio/${id}.wav`; }
