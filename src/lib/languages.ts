export type LangOption = { code: string; label: string };

export const LANGUAGES: LangOption[] = [
  { code: "auto", label: "自动检测" },
  { code: "zh", label: "中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "ru", label: "Русский" },
  { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" },
  { code: "ar", label: "العربية" },
  { code: "th", label: "ไทย" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "id", label: "Indonesia" },
  { code: "tr", label: "Türkçe" },
  { code: "pl", label: "Polski" },
  { code: "nl", label: "Nederlands" },
];

export function formatLangDisplay(lang?: string, text?: string): string {
  if (text) {
    const s = detectScriptLang(text);
    if (s) return s;
  }
  if (!lang || lang === "None") return "";
  const l = lang.trim().toLowerCase();
  if (l === "chinese" || l === "zh" || l === "zh-cn") return "中文";
  if (l === "english" || l === "en") return "English";
  if (l === "japanese" || l === "ja") return "日本語";
  if (l === "korean" || l === "ko") return "한국어";
  if (l === "french" || l === "fr") return "Français";
  if (l === "german" || l === "de") return "Deutsch";
  if (l === "spanish" || l === "es") return "Español";
  if (l === "russian" || l === "ru") return "Русский";
  return lang;
}

export function detectScriptLang(text?: string): string {
  if (!text) return "";
  let hanzi = 0, latin = 0, kana = 0, hangul = 0;
  for (const c of text) {
    const cp = c.codePointAt(0) || 0;
    if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) hanzi++;
    else if ((cp >= 0x3040 && cp <= 0x30ff)) kana++;
    else if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff)) hangul++;
    else if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) latin++;
  }
  if (hangul > 0) return "한국어";
  if (kana > 0) return "日本語";
  if (hanzi > 0 && hanzi >= latin) return "中文";
  if (latin > 0) return "English";
  return "";
}
