import { z } from 'zod';

/** /practice/session 的搜索参数（也是一轮练习的配置） */
export const PracticeSearchSchema = z.object({
  groupId: z.string().catch('c-g-am-f'),
  drill: z.enum(['name-to-chord', 'transition', 'ear-to-chord']).catch('name-to-chord'),
  mode: z.enum(['any', 'reference']).catch('any'),
  length: z.coerce.number().int().min(1).max(100).catch(20),
});

export type PracticeSearch = z.infer<typeof PracticeSearchSchema>;
