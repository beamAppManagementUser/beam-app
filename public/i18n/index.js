// i18n loader — loads the correct translation file based on language code
// Supports: en, hi, hi-mixed, and other regional languages

const cache = {};

export async function loadTranslations(langCode) {
  if (cache[langCode]) return cache[langCode];

  let translations;
  try {
    if (langCode === 'en') {
      const mod = await import('./en.js');
      translations = mod.default;
    } else if (langCode === 'hi') {
      const mod = await import('./hi.js');
      translations = mod.default;
    } else if (langCode === 'hi-mixed') {
      const mod = await import('./hi-mixed.js');
      translations = mod.default;
    } else {
      const mod = await import('./en.js');
      translations = mod.default;
    }
  } catch (e) {
    console.error('Failed to load translations for', langCode, e);
    const mod = await import('./en.js');
    translations = mod.default;
  }

  cache[langCode] = translations;
  return translations;
}

export function t(key, translations, fallback) {
  if (translations && translations[key]) return translations[key];
  if (fallback) return fallback;
  return key;
}

export function createTranslator(translations) {
  return (key, fallback) => t(key, translations, fallback);
}
