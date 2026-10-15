# 参与贡献

欢迎提 issue 和 pull request。开始之前请先看 [MAYOCHORD_SPEC.md](MAYOCHORD_SPEC.md)（需求与设计）和 [CLAUDE.md](CLAUDE.md)（开发约定），以及 [架构说明](docs/architecture.md)。

## 开发环境

需要 Node.js 22 以上和 pnpm 12。

```bash
pnpm install
pnpm dev
```

提交前请确认全部通过：

```bash
pnpm lint && pnpm typecheck && pnpm coverage && pnpm build && pnpm e2e
```

约定（详见 CLAUDE.md）：

- TypeScript strict，不用 `any`。判定、评分、调度、时间分析写成 `packages/core` 里的纯函数并写测试（覆盖率门槛 90%）。
- 界面文字放在 `apps/web/src/i18n/locales/`（`zh-CN.ts` 与 `en.ts`），不要写死在组件里。
- 新依赖只用宽松许可证（MIT / Apache / BSD / ISC，字体 OFL），`package.json` 写精确版本。
- 组件不用 Tailwind 的 `dark:` 变体，颜色只通过设计令牌（`apps/web/src/design/tokens.css`）切换。

## 添加内容（和弦、进行、主题）

内容都在 `packages/content/src/packs/mayochord-core.json`，格式见 [内容包格式](docs/content-pack.md)。

1. 新和弦：在 `chords` 里加一项，`id` 用 `chordSlug` 的规则。可以不写键位（自动排列），也可以在 `voicings` 里给参考键位。
2. 新进行：在 `progressions` 里加一项，每一步引用和弦与键位，写清楚拍数。
3. 新主题：在 `topics` 里加一项，写好先修、包含关系、练习内容和课程（讲解文字请同时写 `zh-CN` 与 `en`）。
4. 运行 `pnpm test`：内容包校验会检查 ID、拼写、和弦音、引用和图谱有没有环。必要时更新 `packages/content/src/content.test.ts` 里的数量。

版权：仓库里只放通用的和弦与进行。不要提交受版权保护的歌词、录音、乐谱。

## 添加键盘设备配置

在 `packages/content/src/devices/` 新增一个 JSON，并在 `packages/content/src/index.ts` 里 import 它、加进 `BUILTIN_DEVICE_PROFILES`（排在通用配置前面）：

```json
{
  "id": "yamaha-p45",
  "name": "Yamaha P-45",
  "match": { "nameIncludes": ["P-45"] },
  "keys": 88,
  "lowestNote": 21,
  "highestNote": 108,
  "verified": false,
  "knownBehaviors": {}
}
```

- `match.nameIncludes`：Web MIDI 端口名包含这些字符串时自动选中这台设备。
- 音域、通道、note off 形式等行为请用 MIDI 监视页（`/monitor`）实测后再填，`verified` 表示是否经过实测。不要凭说明书猜。

## 添加新的练习类型

1. 在 `packages/core/src/drill/` 实现 `Drill` 接口（`drill.ts`）：`accepts`（能用哪种卡片）、`createTrial`、`evaluate`（用 `evaluateTrial` 重放）、`toEvidence`，然后 `registerDrill`。
2. 如果需要新的卡片类型，加到 `cards.ts` 的 `AnyCard`，卡片 ID 要稳定（不含主题 ID，同一张卡在不同主题里共享记忆）。
3. 在 `scheduler/adaptive.ts` 的 `DEFAULT_ADAPTIVE` 里给新练习类型一个初始时限。
4. 网页里在 `features/practice/SessionRunner.tsx`（或 `ChordCues.tsx`）加上题面的显示。
5. 内容包里让某个主题的 `practice` 生成这种卡片。

调度器、每日任务编排、统计不需要改：它们只看作答日志和卡片 ID。

## 报告 MIDI 设备的问题

打开 `/monitor`，按测试清单操作，点"下载实测数据 JSON"，把文件附在 issue 里。
