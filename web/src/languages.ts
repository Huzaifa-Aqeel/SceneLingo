// Language catalog for translation targets (FR-AI-011). Data only: add a language by adding a row.
// `dir` is the text direction used when rendering that language (FR-AI-012).
// English is listed so a learner can choose "no translation".

export type Direction = "ltr" | "rtl";
export interface Language { code: string; name: string; native: string; dir: Direction }

const L = (code: string, name: string, native: string, dir: Direction = "ltr"): Language => ({ code, name, native, dir });

export const LANGUAGES: Language[] = [
  L("ar", "Arabic", "العربية", "rtl"),
  L("bn", "Bengali", "বাংলা"),
  L("bg", "Bulgarian", "Български"),
  L("zh", "Chinese (Simplified)", "简体中文"),
  L("zh-TW", "Chinese (Traditional)", "繁體中文"),
  L("hr", "Croatian", "Hrvatski"),
  L("cs", "Czech", "Čeština"),
  L("da", "Danish", "Dansk"),
  L("nl", "Dutch", "Nederlands"),
  L("en", "English (no translation)", "English"),
  L("et", "Estonian", "Eesti"),
  L("fi", "Finnish", "Suomi"),
  L("fr", "French", "Français"),
  L("de", "German", "Deutsch"),
  L("el", "Greek", "Ελληνικά"),
  L("gu", "Gujarati", "ગુજરાતી"),
  L("he", "Hebrew", "עברית", "rtl"),
  L("hi", "Hindi", "हिन्दी"),
  L("hu", "Hungarian", "Magyar"),
  L("id", "Indonesian", "Bahasa Indonesia"),
  L("it", "Italian", "Italiano"),
  L("ja", "Japanese", "日本語"),
  L("kn", "Kannada", "ಕನ್ನಡ"),
  L("ko", "Korean", "한국어"),
  L("lv", "Latvian", "Latviešu"),
  L("lt", "Lithuanian", "Lietuvių"),
  L("ms", "Malay", "Bahasa Melayu"),
  L("ml", "Malayalam", "മലയാളം"),
  L("mr", "Marathi", "मराठी"),
  L("ne", "Nepali", "नेपाली"),
  L("no", "Norwegian", "Norsk"),
  L("fa", "Persian", "فارسی", "rtl"),
  L("pl", "Polish", "Polski"),
  L("pt-BR", "Portuguese (Brazil)", "Português (Brasil)"),
  L("pt-PT", "Portuguese (Portugal)", "Português (Portugal)"),
  L("pa", "Punjabi", "ਪੰਜਾਬੀ"),
  L("ro", "Romanian", "Română"),
  L("ru", "Russian", "Русский"),
  L("sr", "Serbian", "Српски"),
  L("sk", "Slovak", "Slovenčina"),
  L("sl", "Slovenian", "Slovenščina"),
  L("es", "Spanish", "Español"),
  L("sw", "Swahili", "Kiswahili"),
  L("sv", "Swedish", "Svenska"),
  L("tl", "Tagalog", "Tagalog"),
  L("ta", "Tamil", "தமிழ்"),
  L("te", "Telugu", "తెలుగు"),
  L("th", "Thai", "ไทย"),
  L("tr", "Turkish", "Türkçe"),
  L("uk", "Ukrainian", "Українська"),
  L("ur", "Urdu", "اردو", "rtl"),
  L("vi", "Vietnamese", "Tiếng Việt"),
];

const byCode = new Map<string, Language>(LANGUAGES.map((l) => [l.code, l]));

export const findLanguage = (code: string): Language | null => byCode.get(code) ?? null;
export const directionOf = (code: string): Direction => findLanguage(code)?.dir ?? "ltr";
export const isEnglish = (code: string) => code === "en" || String(code).startsWith("en-");

// Firestore field-path-safe key for the card's `translations` map ("pt-BR" -> "pt_BR").
export const translationKey = (code: string) => String(code).replace(/-/g, "_");

// Suggests a language to translate into, from the browser's language list, or null.
// English is skipped: these learners are studying English, and many browsers list it first
// ("en-US") ahead of their own language.
export function suggestLanguage(browserLanguages: readonly string[] = []): string | null {
  for (const raw of browserLanguages) {
    const base = String(raw).split("-")[0] ?? "";
    if (base === "en") continue;
    if (byCode.has(raw)) return raw;
    if (base && byCode.has(base)) return base;
  }
  return null;
}
