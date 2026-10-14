import type { DeviceProfile } from '@mayochord/core';

/**
 * 内置键盘设备配置。数据只写实测确认过的内容；未确认的字段为 null，verified 为 false。
 * JUNO-D7 的实测记录见 CLAUDE.md「JUNO-D7 实测行为」。
 */
export const JUNO_D7: DeviceProfile = {
  id: 'roland-juno-d7',
  name: 'Roland JUNO-D7',
  // 实测：Windows + Chrome 下输入、输出端口名都是 "JUNO-D"（不含 7），制造商 "Roland Corp."
  match: { nameIncludes: ['JUNO-D'] },
  keys: 76,
  // 第 2 次实测：OCTAVE/TRANSPOSE 默认状态下，从最低键逐个弹到最高键，得到 28（E1）– 103（G7），正好 76 键
  lowestNote: 28,
  highestNote: 103,
  verified: true,
  hasMidiOut: true,
  knownBehaviors: {
    channel: '默认键盘发送通道 1',
    noteOff: '用 0x8n note off，并带有非零的松键力度',
    activeSensing: 'USB 连接时约 2 分钟内没有收到 active sensing',
    split: 'SPLIT 时下半部分用通道 2 发送，上半部分仍是通道 1',
    dual: 'DUAL 时每个音同时在通道 1 和 2 各发一次（力度、时间戳相同），需按音符号跨通道合并',
    controlChannel: '按某些面板按钮时在通道 16 发送 Bank Select（CC0/CC32）+ Program Change',
    octaveTranspose: 'OCTAVE/TRANSPOSE 会改变发出的 MIDI 音符号（具体规律未确定），需要八度校准',
    rhythmClock: '当前设置下播放节奏型时，USB 上不发送 MIDI clock / start / stop',
  },
};

export const GENERIC_88: DeviceProfile = {
  id: 'generic-88',
  name: '通用 88 键',
  match: { nameIncludes: [] },
  keys: 88,
  lowestNote: 21,
  highestNote: 108,
  verified: true,
  knownBehaviors: {},
};

export const BUILTIN_DEVICE_PROFILES: readonly DeviceProfile[] = [JUNO_D7, GENERIC_88];
