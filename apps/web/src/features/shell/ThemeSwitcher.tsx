import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ToggleGroup, ToggleGroupItem } from '@/design/ui/toggle-group';
import { type ThemePreference, useAppearance } from '@/stores/appearance';

const OPTIONS = [
  { value: 'system', icon: Monitor },
  { value: 'dark', icon: Moon },
  { value: 'light', icon: Sun },
] as const;

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const theme = useAppearance((s) => s.theme);
  const setTheme = useAppearance((s) => s.setTheme);
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={theme}
      onValueChange={(v) => v && setTheme(v as ThemePreference)}
      aria-label={t('appearance.theme')}
      className="rounded-md border border-border p-0.5"
    >
      {OPTIONS.map(({ value, icon: Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={t(`appearance.${value}`)}
          title={t(`appearance.${value}`)}
          className="size-7 rounded-[calc(var(--radius)*0.6)] data-[state=on]:bg-surface-2 data-[state=on]:text-foreground"
        >
          <Icon className="size-3.5" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
