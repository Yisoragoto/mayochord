import type { DeviceProfile } from '@mayochord/core';
import { z } from 'zod';

const Midi = z.number().int().min(0).max(127);

/** 键盘设备配置（扩展点 4.2-3）。其他人可以按这个格式提交自己键盘的配置。 */
export const DeviceProfileSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1),
    match: z.object({ nameIncludes: z.array(z.string().min(1)) }),
    keys: z.number().int().min(1).max(128),
    lowestNote: Midi.nullable(),
    highestNote: Midi.nullable(),
    verified: z.boolean(),
    hasMidiOut: z.boolean().optional(),
    knownBehaviors: z.record(z.string(), z.string()),
  })
  .refine(
    (p) =>
      p.lowestNote === null ||
      p.highestNote === null ||
      p.highestNote - p.lowestNote + 1 === p.keys,
    { message: '最低键到最高键的数量应等于键数', path: ['highestNote'] },
  );

export function parseDeviceProfile(input: unknown): DeviceProfile {
  const p = DeviceProfileSchema.parse(input);
  const profile: DeviceProfile = {
    id: p.id,
    name: p.name,
    match: p.match,
    keys: p.keys,
    lowestNote: p.lowestNote,
    highestNote: p.highestNote,
    verified: p.verified,
    knownBehaviors: p.knownBehaviors,
  };
  if (p.hasMidiOut !== undefined) profile.hasMidiOut = p.hasMidiOut;
  return profile;
}
