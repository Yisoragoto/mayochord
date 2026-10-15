import { useTranslation } from 'react-i18next';
import { ToggleGroup, ToggleGroupItem } from '@/design/ui/toggle-group';
import { LANGUAGES, type Language, useAppearance } from '@/stores/appearance';

/** 每种语言用它自己的名字显示，看不懂当前语言也能切换 */
const NATIVE_NAME: Record<Language, string> = { 'zh-CN': '中文', en: 'English' };

export function LanguageSwitcher() {
  const { t } = useTranslation();
  const language = useAppearance((s) => s.language);
  const setLanguage = useAppearance((s) => s.setLanguage);
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={language}
      onValueChange={(v) => v && setLanguage(v as Language)}
      aria-label={t('appearance.language')}
      className="rounded-md border border-border p-0.5"
    >
      {LANGUAGES.map((lang) => (
        <ToggleGroupItem
          key={lang}
          value={lang}
          lang={lang}
          className="h-7 rounded-[calc(var(--radius)*0.6)] px-3 data-[state=on]:bg-surface-2 data-[state=on]:text-foreground"
        >
          {NATIVE_NAME[lang]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
