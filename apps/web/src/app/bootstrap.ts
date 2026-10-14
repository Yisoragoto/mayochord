import { BUILTIN_DEVICE_PROFILES } from '@mayochord/content';
import { startLiveSound } from '@/audio/live-sound';
import { CalibrationController } from '@/input/calibration';
import { startComputerKeyboard, useComputerKeyboard } from '@/input/computer-keyboard';
import { inputHub } from '@/input/hub';
import { liveInput } from '@/input/live';
import { useMidi, webMidi } from '@/input/webmidi';
import { type Repositories, repositories } from '@/storage';
import { bindAppearanceToDocument } from '@/stores/appearance';
import { loadSettings, useSettings } from '@/stores/settings';

function safeRepositories(): Repositories | null {
  try {
    return repositories();
  } catch {
    return null;
  }
}

export const calibration = new CalibrationController(
  inputHub,
  () => safeRepositories()?.calibrations ?? null,
);

/**
 * 应用启动：连接输入源、输入汇流、实时输入状态、音源和本地存储。
 * IndexedDB 不可用（例如某些隐私模式）时，用默认设置继续运行，只是不保存。
 */
export function bootstrap() {
  bindAppearanceToDocument();

  webMidi.setPreferredProfiles([...BUILTIN_DEVICE_PROFILES]);
  webMidi.onEvent((e) => {
    calibration.handleRawMidi(e);
    inputHub.ingest(e);
  });
  webMidi.onDetach((source) => inputHub.releaseSource(source));
  webMidi.onSelect((name) => useSettings.getState().update({ preferredInputName: name }));

  liveInput.start();

  // 已经授权过 MIDI 的话自动连接；否则等用户在页面上点“连接”（避免一打开网站就弹权限框）
  navigator.permissions
    ?.query({ name: 'midi' as PermissionName })
    .then((p) => {
      if (p.state === 'granted') void webMidi.request();
    })
    .catch(() => {});

  startComputerKeyboard(inputHub, {
    enabled: () => useSettings.getState().settings.computerKeyboard,
    onBaseChange: (base) => useComputerKeyboard.setState({ base }),
  });
  startLiveSound(inputHub, () => useSettings.getState().settings.onscreenSound);

  // 设置变化时同步到实时输入和 Web MIDI
  let prev = useSettings.getState().settings;
  useSettings.subscribe(({ settings }) => {
    if (
      settings.onsetWindowMs !== prev.onsetWindowMs ||
      settings.stableMs !== prev.stableMs ||
      settings.sustainCountsAsHeld !== prev.sustainCountsAsHeld
    ) {
      liveInput.setOptions(settings);
    }
    webMidi.setPreferredName(settings.preferredInputName);
    prev = settings;
  });

  const repos = safeRepositories();

  // MIDI 输入设备变化时加载它的校准数据
  let lastDevice: string | null = null;
  useMidi.subscribe(() => {
    const name = webMidi.selectedPortName();
    if (name === lastDevice) return;
    lastDevice = name;
    void calibration.setDevice(name);
  });

  if (repos) {
    loadSettings(repos.settings)
      .then(() => {
        const { settings } = useSettings.getState();
        liveInput.setOptions(settings);
        webMidi.setPreferredName(settings.preferredInputName);
      })
      .catch(() => useSettings.setState({ loaded: true }));
  } else {
    useSettings.setState({ loaded: true });
  }
}
