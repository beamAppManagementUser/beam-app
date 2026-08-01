// Language configuration — supports 12 Indian languages + English
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', script: 'Latin' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', script: 'Devanagari' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', script: 'Bengali' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', script: 'Telugu' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', script: 'Devanagari' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', script: 'Tamil' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', script: 'Gujarati' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', script: 'Kannada' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', script: 'Malayalam' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', script: 'Gurmukhi' },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ', script: 'Odia' },
  { code: 'ur', name: 'Urdu', nativeName: 'اُردُو', script: 'Nastaliq' },
];

export const DEFAULT_ADMIN_LANG = 'en';
export const DEFAULT_EMPLOYEE_LANG = 'hi';
export const FULLY_TRANSLATED = ['en', 'hi', 'hi-mixed'];

export function parseLangCode(code) {
  if (!code) return { base: 'en', mode: 'pure' };
  if (code.endsWith('-mixed')) return { base: code.replace('-mixed', ''), mode: 'mixed' };
  return { base: code, mode: 'pure' };
}

export function getLanguageModes(baseCode) {
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === baseCode);
  if (!lang) return [{ code: 'en', label: 'English', description: 'Pure English' }];
  const modes = [
    { code: 'en', label: 'English', description: 'Pure English' },
    { code: baseCode, label: lang.nativeName, description: `Pure ${lang.name}` },
  ];
  if (FULLY_TRANSLATED.includes(`${baseCode}-mixed`)) {
    modes.push({ code: `${baseCode}-mixed`, label: `${lang.nativeName} (Mixed)`, description: `${lang.name} common words + English technical terms` });
  }
  return modes;
}

export function isValidLanguage(code) {
  if (!code) return false;
  const { base, mode } = parseLangCode(code);
  const baseLang = SUPPORTED_LANGUAGES.find(l => l.code === base);
  if (!baseLang) return false;
  if (mode === 'mixed' && !FULLY_TRANSLATED.includes(`${base}-mixed`)) return false;
  return true;
}

export function getLanguageName(code) {
  const { base } = parseLangCode(code);
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === base);
  return lang ? lang.nativeName : 'English';
}

export function getEffectiveLanguage(user, company) {
  if (user.language && isValidLanguage(user.language)) return user.language;
  if (user.is_root) return DEFAULT_ADMIN_LANG;
  if (company) {
    if (user.role === 'admin') return company.admin_default_lang || DEFAULT_ADMIN_LANG;
    return company.employee_default_lang || DEFAULT_EMPLOYEE_LANG;
  }
  return user.role === 'admin' ? DEFAULT_ADMIN_LANG : DEFAULT_EMPLOYEE_LANG;
}
