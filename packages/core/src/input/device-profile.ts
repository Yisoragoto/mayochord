/** 键盘设备配置（扩展点 4.2-3）。具体配置数据放在 packages/content/devices。 */
export interface DeviceProfile {
  id: string;
  name: string;
  /** 端口名包含其中任意一个字符串（不区分大小写）即视为匹配 */
  match: { nameIncludes: string[] };
  keys: number;
  /** 最低/最高键的 MIDI 号（琴上 octave/transpose 为默认状态时）。null = 尚未实测 */
  lowestNote: number | null;
  highestNote: number | null;
  /** 是否已用真机确认以上数据 */
  verified: boolean;
  hasMidiOut?: boolean;
  /** 已知特性说明，键为简短标识 */
  knownBehaviors: Record<string, string>;
}

export function matchesDevice(profile: DeviceProfile, portName: string): boolean {
  const name = portName.toLowerCase();
  return profile.match.nameIncludes.some((s) => name.includes(s.toLowerCase()));
}
