import { BUILTIN_DEVICE_PROFILES } from '@mayochord/content';
import { startLiveSound } from '@/audio/live-sound';
import i18n from '@/i18n';
import { CalibrationController } from '@/input/calibration';
import { startComputerKeyboard, useComputerKeyboard } from '@/input/computer-keyboard';
import { inputHub } from '@/input/hub';
import { liveInput } from '@/input/live';
import { useMidi, webMidi } from '@/input/webmidi';
import { setClockOffsetDays } from '@/lib/clock';
import { tryRepositories } from '@/storage';
import { bindAppearanceToDocument, useAppearance } from '@/stores/appearance';
import { loadSettings, useSettings } from '@/stores/settings';

export const calibration = new CalibrationController(
  inputHub,
  () => tryRepositories()?.calibrations ?? null,
);

/** 界面语言：切换时更新 i18n 与 <html lang> */
function bindLanguage() {
  const apply = () => {
    const { language } = useAppearance.getState();
    if (i18n.language !== language) void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  };
  apply();
  useAppearance.subscribe(apply);
}

/**
 * 应用启动：连接输入源、输入汇流、实时输入状态、音源和本地存储。
 * IndexedDB 不可用（例如某些隐私模式）时，用默认设置继续运行，只是不保存。
 */
export function bootstrap() {
  bindAppearanceToDocument();
  bindLanguage();

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
    setClockOffsetDays(settings.devClockOffsetDays);
    prev = settings;
  });

  const repos = tryRepositories();

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
        setClockOffsetDays(settings.devClockOffsetDays);
      })
      .catch(() => useSettings.setState({ loaded: true }));
  } else {
    useSettings.setState({ loaded: true });
  }
}
