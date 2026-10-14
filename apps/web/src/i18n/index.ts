import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { zhCN } from './locales/zh-CN';

export const DEFAULT_LANGUAGE = 'zh-CN';
export const defaultNS = 'translation';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: { translation: typeof zhCN };
  }
}

void i18n.use(initReactI18next).init({
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS,
  resources: { 'zh-CN': { translation: zhCN } },
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
