import generic88 from './devices/generic-88.json';
import junoD7 from './devices/roland-juno-d7.json';
import { type LoadedPack, loadContentPack } from './load';
import builtinPack from './packs/mayochord-core.json';
import { parseDeviceProfile } from './schema/device';

export * from './load';
export * from './schema/device';
export * from './schema/pack';

/**
 * 内置键盘设备配置。数据只写实测确认过的内容。
 * JUNO-D7 的实测记录见 CLAUDE.md「JUNO-D7 实测行为」。
 */
export const JUNO_D7 = parseDeviceProfile(junoD7);
export const GENERIC_88 = parseDeviceProfile(generic88);
export const BUILTIN_DEVICE_PROFILES = [JUNO_D7, GENERIC_88] as const;

function loadBuiltin(): LoadedPack {
  const result = loadContentPack(builtinPack);
  if (!result.ok) {
    throw new Error(`内置内容包校验失败：${JSON.stringify(result.issues, null, 2)}`);
  }
  return result.pack;
}

/** 内置内容包（第 11 节的和弦、键位与进行）。 */
export const BUILTIN_PACK: LoadedPack = loadBuiltin();

export * from './scores/example';
