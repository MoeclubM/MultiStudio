export type LangOption = { code: string; label: string; asrCode: string };

export const LANGUAGES: LangOption[] = [
  { code: "auto", label: "自动检测", asrCode: "" },
  { code: "zh", label: "中文", asrCode: "zh" },
  { code: "en", label: "English", asrCode: "en" },
  { code: "ja", label: "日本語", asrCode: "ja" },
  { code: "ko", label: "한국어", asrCode: "ko" },
  { code: "fr", label: "Français", asrCode: "fr" },
  { code: "de", label: "Deutsch", asrCode: "de" },
  { code: "es", label: "Español", asrCode: "es" },
  { code: "ru", label: "Русский", asrCode: "ru" },
  { code: "pt", label: "Português", asrCode: "pt" },
  { code: "it", label: "Italiano", asrCode: "it" },
  { code: "ar", label: "العربية", asrCode: "ar" },
  { code: "th", label: "ไทย", asrCode: "th" },
  { code: "vi", label: "Tiếng Việt", asrCode: "vi" },
  { code: "id", label: "Indonesia", asrCode: "id" },
  { code: "tr", label: "Türkçe", asrCode: "tr" },
  { code: "pl", label: "Polski", asrCode: "pl" },
  { code: "nl", label: "Nederlands", asrCode: "nl" },
];

export function langLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export function asrLanguageParam(code: string): string | undefined {
  const opt = LANGUAGES.find((l) => l.code === code);
  if (!opt || !opt.asrCode) return undefined;
  return opt.asrCode;
}
