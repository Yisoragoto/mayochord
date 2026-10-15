import type { I18nText } from '@mayochord/content';
import i18n from '@/i18n';

/** 内容包里的多语言文字：取当前界面语言，没有翻译时用简体中文 */
export function localize(text: I18nText): string {
  const lang = i18n.language as keyof I18nText;
  return text[lang] ?? text['zh-CN'];
}

/** 列表分隔符：中文用顿号，英文用逗号 */
export const listSep = () => (i18n.language === 'en' ? ', ' : '、');
/** 句内分隔符（屏幕阅读器的长说明） */
export const clauseSep = () => (i18n.language === 'en' ? '; ' : '，');

/** 日期等的区域格式 */
export const locale = () => (i18n.language === 'en' ? 'en' : 'zh-CN');
