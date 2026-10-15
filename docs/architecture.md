# 架构与扩展点

MayoChord 是一个纯前端应用：所有逻辑在浏览器里运行，数据存在 IndexedDB，部署在 GitHub Pages 上。仓库是 pnpm monorepo，分三个包。

```
packages/core      纯 TypeScript：乐理、识别与判定、评分、调度、知识图谱、节奏、乐谱导入与跟弹判定。不依赖 React 和浏览器 API
packages/content   内容包格式（Zod）、内置内容包、设备配置；把内容包加载成 LoadedPack
apps/web           React 应用：输入、音频、存储、页面
```

`core` 的 tsconfig 不包含 DOM 类型，保证判定、评分、调度这些核心逻辑都是可以单独测试的纯函数（覆盖率门槛 90%）。`web` 只负责把它们和输入、音频、存储、计时器接起来。

## 数据流

```
Web MIDI ──(八度校准)──► InputHub ◄── 屏幕键盘 / 电脑键盘
                            │  同一个音跨通道、跨输入源只算一次（JUNO-D7 的 DUAL 会在两个通道各发一次）
                            ▼
                        LiveInput：按住的音 + AttemptTracker（80 ms 内落下、150 ms 稳定 = 弹出一个和弦）
                            │
               ┌────────────┼──────────────┐
               ▼            ▼              ▼
     PracticeController  ProgressionRun   和弦库试弹 / 监视页
     （一题一题）        Controller（跟拍）
               │            │
               ▼            ▼
        core：stepTrial / runAttempt（判定）→ gradeEvidence（评分）→ applyLog（FSRS、阶段）
               │
               ▼
        Dexie：reviewLogs（只追加）、cardStates（缓存）、sessions、dailyPlans、settings
```

时间：输入事件一律用 `performance.now()` 域（与 `MIDIMessageEvent.timeStamp` 同源）。节拍器在 AudioContext 时钟上调度，用 `getOutputTimestamp()` 换算到同一个时间域，再扣除延迟校准的偏移。

## 扩展点（规格 4.2）

| 扩展点 | 位置 | 怎么扩展 |
|---|---|---|
| 输入源 | `apps/web/src/input/hub.ts` | 实现一个输入源，把 `InputEvent` 交给 `inputHub.ingest()`（Web MIDI、屏幕键盘、电脑键盘都是这样接入的） |
| 音频输出 | `apps/web/src/audio/piano.ts` 的 `AudioOutput` | 例如以后用 MIDI Out 让琴本身发声 |
| 设备配置 | `packages/content/src/devices/*.json` | 新增一个 JSON（名称匹配、音域、已知行为），见 [CONTRIBUTING](../CONTRIBUTING.md) |
| 练习类型 | `packages/core/src/drill/drill.ts` 的 `Drill` 接口与注册表 | 实现 `createTrial` / `evaluate` / `toEvidence` 并 `registerDrill`；调度器不用改 |
| 内容包 | `packages/content` | 见 [内容包格式](content-pack.md) |
| 存储 | `apps/web/src/storage/repositories.ts` 的仓储接口 | 业务代码只依赖接口；以后可以加云同步实现 |
| 调度策略 | `packages/core/src/strategy/default.ts` | 评分规则、FSRS 参数、练习内出题、85% 规则的参数集中在策略对象里 |

## 学习系统的几层

1. **一道题**（`drill/trial.ts`）：出题 → 和弦尝试 → 第一次判定决定成绩 → 答错显示提示、改对再继续。
2. **一张卡**（`scheduler/progress.ts`、`memory.ts`）：作答日志 → 评分 → FSRS 记忆状态与新卡三阶段。卡片状态可以由日志重放得到。
3. **一轮练习**（`scheduler/session.ts`）：集中练新卡、按顺序、打乱；答错几题后重做；85% 规则调时限。
4. **一个主题**（`graph/topic-progress.ts`）：课程四个阶段、掌握检查、主题自己的 FSRS 记忆、隐式重复（包含关系的信用）。
5. **一天**（`scheduler/daily.ts`）：热身、针对性补救、到期复习（优先能顺带覆盖其他主题的）、测验、新课（同一干扰组一天只引入一个）。
6. **起点**（`graph/diagnostic.ts`）：诊断测试在图谱上二分，通过推断先修已掌握，没通过推断后继还要学。

## 曲谱跟弹

```
文件 ──► detectScoreFormat ──► MusicXML（自写 XML 解析）/ .mxl（fflate 解压）/ MIDI（自写 SMF 解析）
                                   │
                                   ▼
                     Score：notes（演奏）+ elements（记谱）+ measures
                       │                     │
                       ▼                     ▼
       buildFollowPlan → 等待 / 跟拍判定      render-score（VexFlow 排版）/ 瀑布流（canvas）
       （score/follow.ts，纯函数）
```

本地乐谱库存的是原文（MusicXML 文本或 MIDI 的 base64），每次打开重新解析，解析器改进后旧的谱子也受益。

## 页面

TanStack Router 的文件路由在 `apps/web/src/routes/`。练习类页面（`staticData: { focus: true }`）是专注模式，不显示导航。大文件按需加载：Tone.js 与钢琴采样（第一次发声）、VexFlow（第一次显示五线谱）、ECharts（统计页）、乐谱排版（曲谱页面）。

PWA：`vite-plugin-pwa` 预缓存应用本体，字体子集和钢琴采样第一次用到时缓存，之后离线可用。
