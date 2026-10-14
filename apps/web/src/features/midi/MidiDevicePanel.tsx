import { Usb } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/design/ui/badge';
import { Button } from '@/design/ui/button';
import { Label } from '@/design/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/design/ui/select';
import { useCalibration } from '@/input/calibration';
import { useMidi, webMidi } from '@/input/webmidi';
import { cn } from '@/lib/utils';

const NONE = '__none__';

export function formatOffset(offset: number): string {
  if (offset === 0) return '0';
  const sign = offset > 0 ? '+' : '−';
  return `${sign}${Math.abs(offset)}`;
}

/** MIDI 连接状态与输入设备选择。没有权限时显示连接按钮。 */
export function MidiDevicePanel() {
  const { t } = useTranslation();
  const midi = useMidi();
  const offset = useCalibration((s) => s.record?.noteOffset ?? 0);

  if (midi.status === 'unsupported') {
    return <Notice tone="warning">{t('midi.unsupported')}</Notice>;
  }
  if (midi.status === 'idle' || midi.status === 'requesting') {
    return (
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-border-strong p-4">
        <Button onClick={() => void webMidi.request()} disabled={midi.status === 'requesting'}>
          <Usb />
          {midi.status === 'requesting' ? t('midi.connecting') : t('midi.connect')}
        </Button>
        <p className="text-sm text-muted-foreground">{t('midi.permissionHint')}</p>
      </div>
    );
  }
  if (midi.status === 'denied') return <Notice tone="danger">{t('midi.denied')}</Notice>;
  if (midi.status === 'error') {
    return <Notice tone="danger">{t('midi.error', { message: midi.errorMessage ?? '' })}</Notice>;
  }

  const connected = midi.inputs.filter((p) => p.state === 'connected');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <Label htmlFor="midi-input" className="text-muted-foreground">
            {t('midi.input')}
          </Label>
          <Select
            value={midi.selectedInputId ?? NONE}
            onValueChange={(v) => webMidi.select(v === NONE ? null : v)}
          >
            <SelectTrigger id="midi-input" className="min-w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('midi.none')}</SelectItem>
              {midi.inputs.map((p) => (
                <SelectItem key={p.id} value={p.id} disabled={p.state !== 'connected'}>
                  {p.name}
                  {p.state !== 'connected' && ` (${t('midi.disconnected')})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {offset !== 0 && (
            <Badge variant="outline">
              {t('midi.offsetBadge', { value: formatOffset(offset) })}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {t('midi.outputs')}：
          <span className="text-foreground">
            {midi.outputs.length ? midi.outputs.map((p) => p.name).join('、') : t('midi.noOutputs')}
          </span>
        </p>
      </div>
      {connected.length === 0 && <Notice tone="warning">{t('midi.noInputs')}</Notice>}
      {midi.openError && (
        <Notice tone="danger">{t('midi.portBusy', { message: midi.openError })}</Notice>
      )}
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'warning' | 'danger'; children: ReactNode }) {
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'rounded-xl border-l-4 bg-card px-4 py-3 text-sm leading-relaxed',
        tone === 'warning' ? 'border-warning' : 'border-destructive',
      )}
    >
      {children}
    </p>
  );
}

/** 紧凑版：只在还没连接 MIDI 时显示一个连接按钮（用于练习、试弹等页面）。 */
export function MidiConnectButton() {
  const { t } = useTranslation();
  const status = useMidi((s) => s.status);
  if (status !== 'idle' && status !== 'requesting') return null;
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => void webMidi.request()}
      disabled={status === 'requesting'}
    >
      <Usb />
      {status === 'requesting' ? t('midi.connecting') : t('midi.connect')}
    </Button>
  );
}
