import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';

export const DEFAULT_LANGUAGE = 'zh-CN';
export const defaultNS = 'translation';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: { translation: typeof zhCN };
  }
}

/** 首屏就用保存的语言（与 stores/appearance.ts 的 localStorage 键一致），避免先闪一下中文 */
function storedLanguage(): string {
  try {
    const raw = JSON.parse(localStorage.getItem('mayochord.appearance') ?? 'null');
    const lang = raw?.state?.language;
    return lang === 'en' || lang === 'zh-CN' ? lang : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

void i18n.use(initReactI18next).init({
  lng: storedLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS,
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
