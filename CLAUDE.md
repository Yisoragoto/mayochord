# CLAUDE.md — MayoChord 开发约定与实测记录

> 每次开发会话开始前先读 `MAYOCHORD_SPEC.md`（需求与设计依据）和本文件。规格变化时先改规格，再改代码。
> 本文件在每个里程碑结束时更新。

## 当前进度

| 里程碑 | 状态 |
|---|---|
| M0 骨架与真机验证 | 完成（commit 7abbefd） |
| M1 核心与数据层 | 完成（commit 53b1aa2；用户采纳就近转位的推荐键位） |
| M2 学习系统核心 | 完成（commit d24db51） |
| M3 知识图谱与每日任务 | 完成（用户 2026-10-15 测试通过） |
| M4 节奏与进行 | 完成（用户 2026-10-15 测试通过） |
| M5 听觉与读谱 | 完成（用户 2026-10-15 确认） |
| M6 统计与发布 | 完成（commit fe043f8，用户 2026-10-15 确认） |
| M7 导入乐谱跟弹 | 完成（commit e125bbb，用户 2026-10-15 确认） |
| M8 反复记号与自动标和弦 | 完成（commit 90053a8，用户 2026-10-15 确认） |
| M9 课程扩展：和弦词汇、调性与进行 | 完成（用户 2026-10-17 确认） |
| M10 五线谱教程 | 已推送，等待用户测试 |
| M11 曲谱练习优化 | 计划中 |
| M12 左手伴奏型与节奏、M13 听觉进阶、电吉他 | 之后 |

## 常用命令（仓库根目录）

```bash
pnpm dev          # 开发服务器 http://localhost:5173/mayochord/
pnpm lint         # Biome 检查（pnpm lint:fix 自动修复）
pnpm typecheck    # tsc -b（TypeScript 7，project references）
pnpm test         # Vitest（core + content + web）
pnpm coverage     # 同上 + core 覆盖率门槛 90%
pnpm build        # 构建 apps/web，输出 dist/ 并复制 404.html
pnpm e2e          # Playwright（本地用已安装的 Chrome，CI 用 chromium）
```

每个里程碑结束前必须全部通过：`pnpm lint && pnpm typecheck && pnpm coverage && pnpm build && pnpm e2e`。

## 项目约定

- **工作方式**：每个里程碑结束停下，列出需要在琴上/浏览器里测试的内容；用户确认后再 commit。
- **GitHub**：https://github.com/Yisoragoto/mayochord（公开）。commit 后可以自行评估并 push，不用等用户。
- **提交信息不加 `Co-Authored-By: Claude …`**（用户要求：仓库的 Contributors 里不能出现 Claude；2026-10-14 已从历史中清除并强制推送）。
- **JUNO-D7 相关行为不要猜**：只根据用户在琴上实测、导出的数据实现，并记录到本文件「JUNO-D7 实测行为」。
- **依赖**：安装前用 `npm view <pkg> version license time` 核对版本、许可证（只接受 MIT/Apache/BSD/ISC 等宽松许可证；字体可接受 OFL-1.1），`package.json` 写精确版本。pnpm 12 默认有 `minimumReleaseAge`（约 1 天），刚发布的版本会被拒绝：选更早的稳定版，**不要**往 `pnpm-workspace.yaml` 加 `minimumReleaseAgeExclude`。
- **TypeScript**：strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`。禁止 `any`（Biome `noExplicitAny: error`）；确需时用 `biome-ignore` 写明原因。
- **core 包**（`packages/core`）：纯 TypeScript，不依赖 React 和浏览器 API（tsconfig 的 `lib` 不含 DOM 来强制）。判定、评分、调度、时间分析都写成纯函数并测试。
- **内部包不预构建**：`exports` 直接指向 `src/*.ts`，由 Vite/Vitest 编译。
- **i18n**：界面文字放在 `apps/web/src/i18n/locales/`（`zh-CN.ts`、`en.ts`；`en.ts` 的类型由 zh-CN 推出，少了键会类型检查失败），默认 `zh-CN`，通过 `t()` 使用。内容包里的多语言文字用 `lib/localize.ts` 的 `localize()`（当前语言，没有翻译时用中文），列表分隔符用 `listSep()`，日期用 `locale()`。`/design` 页面是开发用的组件展示页，说明文字不进 i18n。
- **shadcn/ui 组件**在 `apps/web/src/design/ui/`。用 CLI 添加后要做两件事：把 `from "cn"` 改成 `from "@/lib/utils"`（CLI 在 monorepo 里解析别名有误），并检查 CLI 有没有往 `package.json` 加一个无用的 `cn` 依赖（M0 时加过，M2 已删除）；删除 `dark:` 变体并把 `accent` 悬停色改为 `surface-2`（见下方设计系统）。
- **路由**：TanStack Router 文件路由（`apps/web/src/routes/`），`routeTree.gen.ts` 由插件生成并提交到仓库。
- **GitHub Pages**：browser history + 构建时把 `index.html` 复制为 `404.html`（`vite.config.ts` 的 `spaFallback` 插件）。`base` 默认 `/mayochord/`，可用环境变量 `MAYOCHORD_BASE` 覆盖。
- **localStorage** 只存外观设置：深浅色与界面语言（`mayochord.appearance`，首屏脚本与 `i18n/index.ts` 读取以避免闪烁）。业务数据一律走 Dexie。
- **音乐理论自行实现**（规格第 3 节已改）：Tonal 自 2026-09-28 起各子包发布入口错误，已移除。不要再引入 Tonal。
- **拼写**：音名一律保留拼写（'Bb4' 不写成 'A#4'），由字母+度数推出（`spellInterval`）。显示时用 `prettyAccidentals` 换成 ♭ ♯。
- **和弦 ID**（URL 安全）：`chordSlug(root, quality, bass)`，例如 gm7、fmaj7、c7-9、bb、fsm7b5、c-on-e。内容包校验会检查 ID 与和弦一致。
- **大文件懒加载**：Tone.js 与钢琴采样在第一次发声时加载（`audio/piano.ts`）；VexFlow 在第一次显示五线谱时加载（`design/staff`）。不要在首屏代码里静态 import 它们。
- **时间**：写日志、编排每日任务一律用 `lib/clock.ts` 的 `wallNow()` 与 `dayParams()`（练习日凌晨 4 点换日、本地时区），不要直接用 `Date.now()`。开发服务器里设置页有"模拟时间前进"（`devClockOffsetDays`），正式版本不生效。
- **布局库**：图谱布局是 core 里自己写的分层布局（`graph/layout.ts`），没有引入 dagre（节点只有几十个，纯函数便于测试）。
- **在 Git Bash 里用 Python 改文件**：写文件时加 `newline='
'`，否则在 Windows 上会写成 CRLF。长脚本先写到临时文件再执行（直接放在 heredoc 里，bash 可能解析失败）。

## 目录结构

```
packages/core/src/
  input/        InputEvent、MIDI 解析、DeviceProfile 类型；merge.ts 跨通道/跨输入源合并、整体移调
  theory/       音名解析与拼写（spellInterval）、和弦性质表、和弦符号解析/格式化/ID、级数（key.ts）
  voicing/      Voicing 类型、声部进行配对、就近转位搜索、右手转位描述、自动生成的密集排列键位（close.ts）
  recognition/  按住音、自由识别、判定（judgeNotes、findUniformShift）、和弦尝试检测（AttemptTracker）
  log/          ReviewLog 类型（作答日志）
  drill/        卡片（cards.ts，和弦/切换/音名/音程）、目标位置（targets.ts）、一道题的判定流程（trial.ts，纯函数）、
                Drill 接口与注册表（drill.ts：看名弹和弦、和弦切换、认音名、音程）
  grading/      自动评分、个人反应时间中位数、主题评分与掌握检查（topic.ts）、XP 与防乱按（xp.ts）
  scheduler/    FSRS 封装（memory.ts）、卡片进度与新卡三阶段（progress.ts）、练习内出题顺序（session.ts）、
                85% 自适应（adaptive.ts）、轮次总结（summary.ts）、隐式重复（implicit.ts）、每日任务编排（daily.ts）
  strategy/     调度策略对象：各项参数集中在这里（createDefaultStrategy）
  graph/        主题图谱（校验、拓扑、包含权重）、分层布局、主题进度与状态（topic-progress.ts）、诊断测试（diagnostic.ts）
  stats/        统计页的纯函数：反应时间趋势、切换热力图、节拍偏差、总体
  score/        乐谱导入（MusicXML/.mxl/MIDI → Score）、XML 解析、临时记号、反复记号展开（repeats.ts）、
                自动标和弦（chords.ts）、跟弹判定（等待/跟拍）与按小节统计
  timing/       音频时钟↔performance.now() 换算（clock.ts）、节拍网格与"在拍上"容差（beat-grid.ts）、
                延迟校准（latency.ts）、统计（平均、标准差、直方图）
  drill/rhythm-reading.ts   节奏读谱：节奏型记号解析（parseRhythm）、判定（judgeRhythm）、评分（M10）
  drill/progression-run.ts  跟拍弹进行的判定（纯函数状态机）、证据、评分、总结、BPM 的 85% 规则
packages/content/src/
  schema/       Zod：内容包（含跨字段校验）、设备配置
  scores/       示例曲谱（欢乐颂，自编简易版）
  packs/        内置内容包 mayochord-core.json（第 11 节 + 课程用的和弦（共 108 个）+ 23 条进行 + 26 个节奏型 + 59 个主题）
  devices/      设备配置 JSON（JUNO-D7、通用 88 键）
  load.ts       校验 + 加载成 LoadedPack（ChordEntry、ProgressionEntry）
apps/web/src/
  app/          bootstrap.ts：启动时连接输入源、汇流、实时输入、音源、存储、校准
  routes/       /（今天）、/graph、/learn/$topicId（课程，专注模式）、/practice/progression、
                /practice/progression/run（专注模式）、/today/task/$taskId（热身/复习，专注模式）、
                /review/$topicId（从图谱进入的复习）、/practice、/practice/session（专注模式）、
                /chords、/chords/$chordId、/scores、/scores/$scoreId（专注模式）、/stats、/diagnostic、/monitor、/settings、/design
  features/     shell、today（每日任务）、graph（知识图谱）、learn（LearningService、课程、每日任务运行）、
                practice（PracticeController、SessionRunner、ChordCues 题面、自由练习、轮次总结）、stats（统计页）、
                progression（进行练习器：ProgressionRunController、ProgressionRunner、总结、声部进行图 VoiceLeading）、
                chords（和弦库、详情、试弹）、scores（乐谱库、跟弹页面、五线谱排版、瀑布流）、reading（节奏读谱的控制器与界面，M10）、midi（设备面板）、monitor、settings、design-gallery
  input/        webmidi.ts、hub.ts（输入汇流）、live.ts（实时按住音 + 和弦尝试）、calibration.ts、
                computer-keyboard.ts、PlayableKeyboard.tsx（屏幕键盘）
  audio/        tone.ts（懒加载 Tone.js，钢琴与节拍器共用一个原生 AudioContext；outputStamp 时钟换算）、
                piano.ts（Salamander 采样）、metronome.ts（Tone.Clock 节拍器）、cues.ts（听辨题：终止式 + 目标和弦）、
                live-sound.ts、feedback-sound.ts
  storage/      Dexie 数据库 db.ts、仓储接口与实现 repositories.ts、备份与 CSV（backup.ts）
  design/       tokens.css、ui/（shadcn）、keyboard/、staff/（VexFlow，懒加载）、ChordName、Wordmark
  stores/       Zustand：appearance、settings
  lib/          clock.ts（墙上时钟、练习日参数、开发用的模拟时间）、uuid.ts、localize.ts（内容的多语言）、download.ts
  design/charts/ EChart（ECharts 懒加载、按需引入、颜色取自主题令牌）
apps/web/public/samples/salamander/   钢琴采样（CC-BY 3.0，见 NOTICE）
apps/web/e2e/   Playwright；fake-midi.ts 注入假的 navigator.requestMIDIAccess；fixtures/sample-backup.json（统计、导入用的样例数据）；
                screenshots.spec.ts 生成 README 截图（平时跳过，见文件注释）
docs/           architecture.md、content-pack.md、learning-science.md、screenshots/
```

## 数据格式

### InputEvent（`packages/core/src/input/events.ts`）

- 时间 `t`：`performance.now()` 域的毫秒（`MIDIMessageEvent.timeStamp` 与之同源）。
- 通道 `channel`：**1–16**（与琴的说明书一致），非 MIDI 输入源固定为 1。
- 音符号 `note`：MIDI 号，中央 C = C4 = 60。
- `noteOn` 的 velocity = 0 解析为 `noteOff`。CC64 解析为 `sustain`（value ≥ 64 为踩下）。
- 系统实时消息：保留 `clock/start/continue/stop`；**忽略** active sensing（0xFE）、reset（0xFF）、sysex。
- 其他通道消息（音色切换、弯音、触后）解析出来只给监视页显示。

### 输入流水线（apps/web）

`Web MIDI → (八度校准：减去偏移) → 输入汇流 InputHub ← 屏幕键盘 / 电脑键盘`
`InputHub → createNoteMerger（同一个音跨通道、跨输入源只算一次） → LiveInput（按住音 + AttemptTracker） → 页面`
- 输入源 ID：`webmidi:<portId>`、`onscreen`、`keyboard`。`sourceKind()` 映射成日志用的 midi / onscreen / keyboard。
- 输入源断开、校准偏移改变、窗口失焦时补发 noteOff，避免"卡音"。
- 校准（`calibration.ts`）直接监听未校准的 Web MIDI 事件；偏移按设备（端口名）存在 Dexie 的 calibrations 表。
- 屏幕键盘有两种模式（设置里切换）：按住发声（触摸屏多指按和弦）/ 点击切换（鼠标按和弦）。

### 按住音（`recognition/held-notes.ts`）

- 状态记录每个按住音的按下时间、力度、通道、输入源和 `sustained` 标记（手指已松开、因踏板仍在发声）。
- 是否把 `sustained` 的音算作"按住"由查询参数 `sustainCountsAsHeld` 决定（设置项，默认 false）。

### 内容包（`packages/content`，`schemaVersion: 1`）

`{ id, version(semver), schemaVersion, name, chords: [{ id, root, quality, bass? }], voicings: [{ id, chordId, reference, status, notes: [{ pitch, hand, finger? }], note? }], progressions: [{ id, name, key, steps: [{ chordId, voicingId?, beats }], description? }], topics: [...] }`
校验规则：ID 唯一且符合 chordSlug；键位的音必须是和弦音且拼写正确；除可省略的五音外不能缺和弦音；给了键位的和弦恰好一个参考键位；进行引用的和弦、键位存在且对应。

- **没有给键位的和弦**：加载时用 `closeVoicing` 自动生成参考键位（`status: 'generated'`，ID `<chord>-ref`）：左手根音（斜杠和弦为低音）C3–B3，右手从根音（斜杠和弦从低音）开始密集排列，最低音在 C4–B4，九和弦省略五音。和弦库里单独分组并标"自动排列"。
- **topics**（M3，`topics` 字段可省略，默认空；没有升 schemaVersion，因为是新增的可选字段）：
  `{ id, title, summary, prerequisites[], encompasses[{ topicId, weight 0–1 }], interferenceGroup?, practice, lesson }`
  - `practice`：`{ kind: 'notes', notes }` | `{ kind: 'intervals', items: [{ root, interval: m2|M2|m3|M3|P4|P5 }] }` | `{ kind: 'chords', chords, voicingMode }` | `{ kind: 'transitions', progressions, voicingMode }`（进行相邻和弦循环切换，多条进行合并去重）| `{ kind: 'progression', progression, bpm, beatsPerChord?, voicingMode }`（M4 跟拍主题；卡片 = 这条进行的切换卡，每日复习用普通的切换题）。
  - `lesson`：`{ explain: [{ text, demo?: { notes? | chord?, labels: semitones|fingers|none, play: together|arpeggio|none } }], guided: { count }, independent: { requiredCorrect }, mastery: { questions, minAccuracy, timeLimitMs }, minutes }`。
  - M5：`chords` 可以带 `cue`（name / spelled / audio / staff / roman，默认 name）和 `key`（级数题必须有；听辨给了调就先播放终止式、选项用级数）。新增 `{ kind: 'contrast', pairs: [[a, b], …] }`（对比配对：听声音的卡片，选项是这一对）。讲解示范可以 `show: keyboard|staff|both`、`play: cadence`（配合 `key`）。
  - `LoadedPack.choicesByCard`：听声音的卡片 → 作答选项（和弦 ID，多个主题用到时合并）。
  - 校验：图谱无环、引用存在、示范和弦存在、级数题有调、对比配对的两个和弦存在且不同。加载后 `LoadedPack` 有 `topics`、`graph`（拓扑顺序）、`cardById`、`topicsOfCard`。
- 进行的每一步可以有 `anticipation`（0–3，提前几个 16 分音符换和弦，默认 0；M4）。内置 `c-g-am-f-push` 每步提前 1 个 16 分音符。
- 内置图谱 21 个主题（M4 新增跟拍主题：跟着节拍器弹 C–G–Am–F → 16 分音符先行切分；跟拍弹丸サ進行）。M3 的 18 个：认识键盘与音名 → 半音与全音 → 大三度/小三度 → 大三/小三和弦公式（干扰组 triad-quality）→ C 调三和弦 → C–G–Am–F → 转位 → 就近转位与声部进行 → 王道进行；12 调三和弦；M7/7/m7/m7♭5 公式（干扰组 seventh-quality）→ C 调七和弦 → II–V–I → 丸サ進行。规格里的"16 分音符切分"在 M4 加入（sixteenth-anticipation）。

### 本地数据库（Dexie，`MayoChordDB`，当前 version 3）

| 表 | 主键 / 索引 | 说明 |
|---|---|---|
| reviewLogs | `++seq, &id, ts, cardId, sessionId, [cardId+ts]` | 作答日志，只追加（仓储接口不提供修改、删除） |
| settings | `key` | 'app' → AppSettings（Zod 校验，每个字段损坏时单独回退默认值） |
| calibrations | `deviceKey` | 每个 MIDI 设备的音高偏移、实测音域 |
| cardStates | `cardId, due` | `{ cardId, due, progress: CardProgress }`。**缓存**，可由 reviewLogs 重放重建（`replayProgress`）。新卡 due = `Number.MAX_SAFE_INTEGER` |
| sessions | `id, startedAt` | 每轮练习：`{ id, startedAt, endedAt, kind: 'practice', config, summary }` |
| userPacks | `id` | 用户导入的内容包（M6） |
| scores（v3） | `id, importedAt` | 本地乐谱库：`{ id, title, fileName, format, importedAt, source: { kind: 'musicxml', text } \| { kind: 'midi', base64 }, measureCount, noteCount, prefs, lastPlayedAt }`。存原文，打开时重新解析 |
| scoreRuns（v3） | `id, scoreId, startedAt` | 跟弹记录：模式、手、小节范围、速度、`FollowSummary`（含每个小节的统计）、XP |
| dailyPlans（v2） | `date` | 每日任务：`{ date, createdAt, tasks: [{ id, kind, topicIds, cardIds, minutes, covers, status: pending/done/skipped, completedAt, xp, result }], dueTopics, spareLessons }` |

- 主题进度**不入库**：每次从主题日志（`cardId` 以 `topic:` 开头）重放得到（`replayTopicProgress`），日志不多，保证与日志一致。
- ReviewLog 新增可选字段 `xp`、`mashing`（M3 起写入；之前的日志没有）。sessions 记录新增 `xp`，`config.kind` 为练习类型（practice/warmup/review/guided/independent/mastery）。

AppSettings 新增（M4）：`latencyOffsetMs`、`latencyCalibrated`、`metronomeVolume`、`progression`（进行练习器上次的选项与每条进行的 BPM，`ProgressionPrefsSchema`）。
settings 表另有键 `'adaptive'`：`{ 'name-to-chord' | 'transition': { timeLimitMs, sinceAdjust } }`（85% 规则的当前时限）。
M3 新增 version 2（dailyPlans 表），M7 新增 version 3（scores、scoreRuns），`db.test.ts` 有 v1、v2 数据升级测试。备份格式仍是 formatVersion 1：新增的 `scores`、`scoreRuns` 两项可以省略（M6 的备份照样能导入）。

改表结构：新增 `this.version(n)`，保留旧版本声明，需要时写 `.upgrade()`，并在 `storage/db.test.ts` 加"旧数据升级后不丢失"的测试。

### 监视页导出 JSON（`kind: "midi-monitor-capture"`, `formatVersion: 2`）

`{ startedAt, exportedAt, userAgent, ports: { inputs, outputs, selectedInputId }, openError, settings, summary, markers: [{ t, step, label }], messages: [{ t, recv, portId, portName, data: number[] }] }`
`markers` 是用户点击测试清单步骤时记下的时间点（v2 新增）。`ports` 在导出时直接从 MIDIAccess 读取。
`recv - t` 是从消息时间戳到 JS 回调执行的延迟。原始消息包含 active sensing。最多保存 50 000 条。

## 和弦判定规则

### 自由识别（`identifyChord`，M0 已实现）

- 输入按住音的 MIDI 号，去掉八度与重复后得到音级集合；少于 3 个音级不识别。
- 对集合里每个音级作为候选根音，与 `CHORD_QUALITIES` 模板逐个比较（精确相等）。七和弦和九和弦允许省略五音（`omit5Allowed`）。
- 最低音不是根音时给出斜杠和弦。
- 排序分数 = 常见程度 `commonness` − 斜杠惩罚 3（根音在低音则 +1）− 省略五音 0.5。
  例：C E G A 低音为 C → `C6` 优先于 `Am7/C`；低音为 A → `Am7`。减七、增三等对称和弦以低音为根。
- 支持：maj、m、dim、aug、sus2、sus4、6、m6、M7、7、m7、m7♭5、dim7、mM7、add9、madd9、7(9)、M7(9)、m7(9)。

### 和弦尝试（`AttemptTracker` / `findAttempts`）

- 按住的音集合变化后，若 `stableMs`（默认 150）内不再变化，产生一次尝试；同一个稳定状态只产生一次。
- 只松开手指（没有新按下的音）不算尝试。
- **按得太短**：这次动作里按下的音都在稳定前松开了 → 不算尝试，记一次 `ShortTap`（`takeShortTap()`）。练习界面和试弹面板显示 2.5 秒提示"按住一下再松开"（用户 2026-10-14 测试时发现点按不识别，要求只加提示、不改判定）。
- 齐整度 `spreadMs` 只算这次新按下的音（从上一个和弦保持下来的共同音不算）；`together = spreadMs <= onsetWindowMs`（默认 80）。
- 两个阈值和踏板选项都在设置页可调。屏幕键盘、电脑键盘的齐整度没有意义，界面上不显示。

### 判定（`judgeNotes`）

- 宽松 loose：比较音级集合，忽略八度和转位；多按 = 按住音中不在目标音级里的；少按 = 参考键位中音级没被按到的（标在参考键位的位置上）。
- 严格 strict：与参考键位逐音一致。
- 低音 bass（M3）：宽松 + 最低音的音级必须与参考键位最低音相同；不对时 `wrongBass: true`。用于音程题和斜杠和弦（转位）题；斜杠和弦在宽松模式下自动用低音判定（试弹面板也是）。低音不对立即判错（不当作"没弹完"）。
- 什么都没按不算对。
- `findUniformShift`：按的音整体平移 k 个半音后与目标一致时返回 k，用于提示"OCTAVE/TRANSPOSE 可能被改动，请重新校准"。

### 就近转位（`rankRightHandVoicings` / `nearestBass`）

- 右手：在 G3–G5 内枚举 3 个音的组合（跨度 ≤ 12，不重复音级）；七和弦必须含三音、七音（有九音时含九音），三和弦三个音都要有；按声部进行移动总量 → 最大单步 → 跨度排序。
- 左手：E2–B3 内离前一个左手音最近的根音。
- 内置包里 Dm7、G7、CM7、D、Bm 的键位就是这样推出来的（`content.test.ts` 验证），2026-10-14 用户采纳，状态为 confirmed。

## 练习与调度规则（M2）

### 卡片（`drill/cards.ts`）

- `ChordCard { kind: 'chord', id, topicId, chordId, cue, key, voicingMode }`；`TransitionCard { kind: 'transition', id, topicId, fromChordId, toChordId, voicingMode }`。
- **卡片 ID 不含 topicId**：`chord:<chordId>:<cue>[@<key>]:<any|reference>`、`transition:<from>><to>:<any|reference>`。
  同一个"看 Am 弹 Am"不管出现在哪个主题里都共享一份记忆状态。
- `voicingMode`：any = 宽松判定（任意转位），reference = 严格判定（参考键位）。两者是不同的卡片。
- M2 的卡片由练习入口的"和弦组"生成（每条进行一组 + 全部和弦），topicId 为 null。M3 起由知识图谱生成。

### 一道题的流程（`drill/trial.ts`，看名弹和弦与和弦切换共用）

- 状态：setup（仅切换题：先弹"从"和弦，不计分、不计时）→ awaiting（计时）→ retry（显示提示）→ done。
- **第一次判定决定成绩**：弹对 → done；弹错 → retry 并显示键位提示（标出多按/少按）；超时 → retry。retry 中弹对才进入下一题，不改变成绩。可以跳过（awaiting 中跳过记为超时）。
- **只按了目标的一部分（没有多按的音）不算作答**，继续等（初学者一个个按音时不会被立即判错；按得不齐会体现在齐整度上）。
- **整体平移**（`findUniformShift`，OCTAVE/TRANSPOSE 被改动）不计成绩，提示重新校准。
- 切换题里重新按一遍"从"和弦不算作答。出题时已经按着"从"和弦（例如上一题的目标）就直接开始计时。
- **反应时间** = 这次新按下的音中最后一个的按下时间 − 计时起点。计时起点：看名弹和弦 = 出题时刻；切换 = "从"和弦弹稳（`stableAt`）的时刻（也就是界面亮出目标的时刻）。
- **齐整度**只统计提示出现之后按下的音（保持下来的共同音不算），只对 MIDI 输入记录；屏幕键盘/电脑键盘记 null。
- 超时判断用尝试的 `stableAt`：超时之后才弹稳的尝试按超时处理。
- **第一次见到的卡片**（没有任何作答记录）一开始就显示键位（切换题同时显示"从"和弦的键位），记为用过提示。
- 切换题只给切换卡记证据，不给目标和弦卡记（反应条件不同，不混进和弦卡的反应时间）。

### 自动评分（`grading/grade.ts`，参数在 `DEFAULT_GRADING`）

| 条件 | 评分 |
|---|---|
| 错误或超时 | Again (1) |
| 正确，反应时间 > 个人中位数 × 1.5 | Hard (2) |
| 正确，反应时间 < 个人中位数 × 0.6 | Easy (4) |
| 正确，其他 | Good (3) |
| 用了提示 | 最多 Hard |
| MIDI 输入且没有同时落下（齐整度 > 窗口） | 最多 Hard（第 11 节"和弦的音同时落下"） |

- 个人中位数：同一练习类型、同一类输入源，最近 50 条"正确、无提示"的显式日志；不足 5 条时为 null，此时正确一律 Good。

### 记忆与进度（`scheduler/memory.ts`、`progress.ts`）

- ts-fsrs 5.4.2，目标保持率 0.9，最长间隔 365 天，不加随机抖动，**关闭短期学习步骤**（`enable_short_term: false`）：按天调度，练习内的重复由会话自己安排。
- **每张卡每个练习日只用第一次评分更新 FSRS**（练习日从凌晨 4 点开始，按本地时区）。同一天的后续作答照样写日志、影响阶段和统计，但不改间隔。
- 新卡三阶段：focused（集中练）→ ordered（按顺序）→ mixed（随机），**连续 3 次达标**进入下一阶段（达标 = 正确、无提示、评分 ≥ Good；不达标清零连续次数，阶段不倒退）。
- 卡片进度全部可由日志重放得到（`replayProgress`），cardStates 表只是缓存。

### 一轮练习的出题顺序（`scheduler/session.ts`）

- focused 阶段的卡集中练：同一张卡连续出现，直到进入 ordered，或本轮已练 6 次（先放一放）。
- 每完成一个集中练块，先把已有的卡（ordered + mixed）轮一遍，再开始下一张新卡。开局如果有已学过的卡，也先轮一遍。
- 一轮里 ordered 的卡按和弦组原顺序连续出现，mixed 的卡打乱；两块的先后随机。
- 答错（不含集中练中的卡）在 3–5 题之后再出现；等待重做期间这张卡不从轮换里出。
- 相邻两题尽量不是同一张卡（集中练除外）。

### 85% 自适应（`scheduler/adaptive.ts`）

- 每个练习类型一个时限：看名弹和弦初始 6 秒（1.5–15 秒），切换初始 5 秒（1–12 秒）。
- 每题之后看最近 20 题（至少 10 题）的正确率：> 90% 时限 × 0.85，< 75% 时限 × 1.2；调整后至少再做 5 题才会再调。
- 新时限从下一题生效，保存在 settings 表 `'adaptive'`。

### 网页里的练习（`features/practice`）

- `PracticeController`：出题 → 实时和弦尝试驱动 `stepTrial` → 评分 → 写日志、更新卡片进度、自适应 → 下一题（答对 650 ms 后，否则 900 ms 后）→ 轮次总结。计时器可注入（测试用手动推进的计时器，fake-indexeddb 与 vi.useFakeTimers 不兼容）。
- 专注模式：路由 `staticData: { focus: true }`，`AppShell` 不渲染导航。Esc 结束这一轮；总结页 Esc 返回入口。
- 点击切换模式的屏幕键盘：看名弹和弦每题结束自动松开（切换题保留，作为下一题的"从"和弦）。
- IndexedDB 不可用时照常练习，提示无法保存。
- 规格 6.7"反馈逐渐减少"、隐式重复、XP、防乱按在 M3 做。

## 知识图谱、课程与每日任务（M3）

### 卡片类型（新增）

- 认音名 `note:<音名>`（例如 note:eb、note:fs）：弹出任意八度的这个音，宽松判定。示范位置在 C4–B4。练习类型 `name-to-note`。
- 音程 `interval:<根音>:<m2|M2|m3|M3|P4|P5>`：同时按下根音和上方的音，低音判定（最低音必须是根音）。练习类型 `interval`。
- 85% 规则初始时限：认音名 4 秒（1–10 秒）、音程 5 秒（1.5–12 秒）。

### 主题进度与状态（`graph/topic-progress.ts`）

主题日志 = `cardKind: 'topic'`、`cardId: topic:<id>` 的 ReviewLog：
- `drillType 'lesson'`（rating null）：开始课程 → 学习中。
- `drillType 'mastery-check'`：掌握检查。通过时 rating = 主题评分（至少 Hard），作为主题 FSRS 的第一次复习，记 `masteredAt`；没通过不影响记忆。
- `drillType 'topic-review'`：每日复习里这个主题的成绩。掌握后**隔天**再通过一次记 `confirmedAt`（规格 6.6"间隔一天后仍能通过"）。
- `evidence 'implicit'`（drillType 'implicit'）：隐式重复的信用，`weight` 0–1，`correct` 表示正/负。
- 状态：locked（有先修没掌握）/ available / learning（开始了课程）/ mastered（通过掌握检查）/ review（已掌握且主题记忆到期）。**解锁只要求先修通过掌握检查**，不要求隔天确认。
- 主题 FSRS 同样每个练习日只用第一次评分。

### 主题评分（`grading/topic.ts`）

一轮里某主题卡片的成绩 → 正确率 < 75% Again；< 90% Hard；≥ 90% 且平均评分 ≥ 3.5 Easy，否则 Good。Hard 及以上算"通过"（记住了，只是有点吃力），Again 算失败。掌握检查：正确率 ≥ 课程的 `minAccuracy` 且完整做完。

### 隐式重复（`scheduler/implicit.ts` + `applyTopicLog`）

- 主题练习成功 → 沿包含关系向下，被包含的主题得到正信用，权重沿路径相乘（多条路径取最大，< 0.05 忽略）；失败 → 沿包含关系向上，包含它的主题得到负信用。只给已掌握的主题。
- 正信用 × 提前折扣（距上次复习天数 / 当前间隔，最低 0.1）累积，满 1 记一次 Good 复习；负信用累积满 1 记一次 Hard。显式复习时清零。
- 掌握检查通过、每日复习之后都会写隐式信用日志。

### 每日任务编排（`scheduler/daily.ts`，参数 `DEFAULT_PLAN`）

1. 热身：上一个练习日（今天之前最近一个有作答的日子）练过的卡片，最多 8 张，按 3 分钟估计。
2. 到期复习：主题记忆在今天结束前到期的。贪心选择：优先能顺带覆盖更多其他到期主题的（它包含的到期主题权重 ≥ 0.5 就不再单独复习，记在任务的 `covers`，靠隐式信用）。每个任务混合最多 3 个主题、每个主题最多 5 张卡，卡片按"到期最早 → 回忆概率低 → 没练过"挑选并交错排列；每题按 15 秒估计。
3. 新课：先继续"学习中"的，再按图谱顺序开始可学的；每天最多 `newTopicsPerDay`（默认 2）节；同一干扰组一天只引入一个；放不进预算的进 `spareLessons`（"换一个"用）。至少安排一节课（除非复习已经占满时长）。
4. 总时长按设置的每天时长（默认 30 分钟）。测验和针对性补救在 M6。
- 任务在当天第一次打开"今天"时生成并保存；当天可以跳过、恢复、替换新课。新课在别处（例如从图谱进入）通过了掌握检查，读取任务时自动标记完成。
- 今天的任务做完后，"今天"页列出已解锁的其他主题，可以继续学（不强制）。

### 课程（`features/learn/LessonPage.tsx` + `specs.ts`）

讲解与示范（文字 + 键盘标记 + 播放；可"直接检查"）→ 引导练习（从主题卡片里均匀挑 `guided.count` 张，按顺序、每题显示键位、不限时）→ 独立练习（打乱、首次见到的卡先示范、答错/超时显示提示，首次答对 `requiredCorrect` 题结束）→ 掌握检查（`questions` 题、固定时限、不能看提示、答错展示 1.4 秒后继续、不重做）。中途离开显示"先停在这里"，可以接着做当前阶段。

### 练习会话（`SessionSpec`）

`PracticeController.start(spec)`：`kind`、`cards`、`length`、`order: phased|mixed|sequential`、`hints: auto|always|never`、`fixedTimeLimitMs?`、`targetCorrect?`、`retryWrong`、`requireCorrection`。自由练习、热身、复习、课程各阶段都用它。结束时 `onFinish(result)` 回调（`completed` 表示是否做完），`dispose()`/`start()` 会清掉旧回调，所以**先 start 再订阅 onFinish**。
- 日志在一题完成时写入（评分在第一次判定时就算好），补上这一题的 XP 和乱按标记。

### XP 与防乱按（`grading/xp.ts`）

- 每题 XP = 出题到完成的时间（单题最多 20 秒）/ 60 秒；约 1 XP = 1 分钟专注练习。乱按的题 0 XP（仍然评分）。
- 乱按：一道题里按过超过 6 个不同的非目标音，或任意 1 秒内按下超过 10 个音。
- 今日 XP、最近 7 天来自练习记录（sessions.xp）；连续天数：从今天（今天还没练则从昨天）往前数 XP ≥ 1 的天。每日 XP 目标默认 20。

### 反馈逐渐减少（规格 6.7）

`feedbackLevelFor(cardProgress)`：mixed 阶段之前 full；mixed 阶段 reduced（判定前不显示按下的键，点击切换模式除外）；mixed 且稳定性 ≥ 7 天 minimal（连着 MIDI 时判定前连键盘也先收起）。

## 听觉与读谱（M5）

### 题面（规格 6.3 的 cue）与练习类型

| cue | 题面 | 练习类型 drillType | 判定 |
|---|---|---|---|
| name | 和弦名 | name-to-chord | 宽松 / 严格 / 斜杠看低音 |
| spelled | 文字名称"E♭ 小三和弦"（12 调构建，规格已加这个 cue） | build-chord | 同上（任意转位） |
| roman | 级数（日本流行乐写法 VIm、V7）+ "C 调" | roman-to-chord | 同上 |
| staff | 大谱表（参考键位的左右手） | staff-to-chord | 卡片为 reference → 严格（八度也要对） |
| audio | 听声音 | ear-to-chord | 宽松；也可以点选答案 |

- 每个 cue 一个练习类型：个人反应时间中位数、85% 时限分开（初始：build/ear/staff 8 秒，roman 6 秒）。卡片 ID 含 cue（与 key），同一和弦的不同题面是不同卡片。
- **听辨**（`audio/cues.ts`）：卡片有 key 时先播放这个调的 I–IV–V–I（密集排列，每个 0.7 秒，停 0.45 秒），再播放目标和弦的参考键位。播放期间 `view.listening = true`：不判定、不计时；**目标和弦响起时重新开始这一题（从这一刻计时）**。声音放不出来时直接开始。可以"重听"（只放目标和弦）或"连调性一起重听"，不算提示。
- **点选答案** `controller.answer(chordId)`：当作用手动输入（source 'manual'）弹出了所选和弦的参考键位，走同一套判定和评分（inputSource 记 manual，齐整度 null）。点错后显示正确答案（题面上出现和弦名与级数），点对或弹对再继续；对比配对时说明两者差在哪个音。
- **听音挑战**（自由练习"听和弦"，用户提议）：只播放和弦（不给调），选项 = 这条进行的和弦。"全部和弦"不能选（选项太多）。
- **五线谱提示**：VexFlow 大谱表（懒加载），宽度约 30rem。
- **对比配对**：大三/小三、7/M7、m7/m7♭5 三个主题；7/M7 与 m7/m7♭5 在干扰组 seventh-quality（不和七和弦公式同一天引入）。
- 新主题（9 个）：12 调构建（三和弦、七和弦）、C 调的级数、听辨 C 调里的和弦、三个对比配对、看五线谱（C 调三和弦、七和弦）。

## 节奏与进行（M4）

### 时间基准（规格 4.3）

- 输入事件：`performance.now()` 域（MIDI 的 timeStamp）。节拍器：AudioContext 时钟。
- 换算：`AudioContext.getOutputTimestamp()` 给出 `{contextTime, performanceTime}`（这个采样实际从扬声器发出的时刻），`audioToPerf()` 把节拍器的音频时刻换到 performance.now() 域。浏览器不支持或返回 0 时用 `currentTime + outputLatency + baseLatency` 估计（`fallbackStamp`）。
- `audio/tone.ts`：第一次发声时懒加载 Tone.js，并用 `new Tone.Context(原生 AudioContext)` 让钢琴音源和节拍器共用一个原生 context（要拿到原生的 getOutputTimestamp）。
- 节拍器（`audio/metronome.ts`）：`Tone.Clock` 按音频时钟调度，合成短促的三角波（强拍 1760 Hz、其他 1175 Hz）。预备拍总是每拍响；正式部分按设置（每拍 / 只响 2、4 拍 / 关），强拍重音可关。返回节拍网格 `{startT（第 0 拍，performance.now() 域）, beatMs, beatsPerBar}`。

### 延迟校准（设置页"延迟校准"）

- 90 BPM，4 拍预备后跟着每一拍按任意键共 16 拍。`estimateLatency`：每次按下相对最近拍点的偏差，去掉前 4 下（热身），以中位数为中心去掉离群值（> max(3×MAD, 40 ms)），取中位数为偏移；有效 ≥ 8 下且标准差 ≤ 35 ms 才可以采用。
- 偏移存在 settings（`latencyOffsetMs`，全局一个值）。所有节拍偏差 = 按下时刻 − 拍点 − 偏移。没校准时进行练习器页面提示去校准。
- 包括音频输出延迟、MIDI 输入延迟和个人习惯；用户在琴上听的是琴本身的声音，校准的是"听到节拍器 → 按下"的整体偏差。**JUNO-D7 上的实际偏移待用户实测。**

### 跟拍判定（`drill/progression-run.ts`）

- 第 k 步（跨循环连续编号）的拍点 t_k = 第 0 拍 + 之前所有步的拍数 × beatMs − 先行切分（第一遍的第一个和弦不提前）。
- 窗口：从 t_k 前 min(半拍, 与前一步间隔的一半) 开始，到下一步的窗口开始为止（最后一步到弹满它的拍数）。一次和弦尝试属于哪一步，看**这次新按下的音的平均按下时间**落在哪个窗口（共同音一直按着也可以）。
- 每步第一次判定决定成绩：弹对 correct；只按了一部分（没多按、低音没错）等补全，窗口结束仍没补全记 wrong；其他 wrong；窗口里什么都没弹 missed（窗口关闭由每 40 ms 的 runTick 定下）。判错之后在同一步里改对记 `corrected`（成绩不变）。预备拍里按的不算。
- 判定方式：宽松（音级）/ 严格（参考键位）；斜杠和弦宽松时也要求最低音。
- **在拍上**：|偏差| ≤ 16 分音符时值的 45%，限制在 40–100 ms（72 BPM ≈ 94 ms，100 BPM ≈ 68 ms），能区分 16 分音符的先行切分。
- **干净** = 弹对 + 在拍上 + 同时落下（齐整度 ≤ 判定窗口，只对 MIDI 输入）。规格第 11 节过关标准：`runPassed` = 没有漏弹且干净的比例 ≥ 阈值。
- 证据（规格 6.3）：每步写和弦卡 `chord:<id>:name:<mode>` 和切换卡 `transition:<from>><to>:<mode>`（第一遍第一个和弦、同一和弦重复时没有切换卡）。drillType `'progression'`，`reactionMs` 为 null，记 `beatOffsetMs`、`spreadMs`；XP 只记在和弦卡那条上（每步时长 / 60 秒，单步最多 20 秒）。
- 评分 `gradeRunEvidence`：错或漏弹 Again；干净 Good；不在拍上、没同时落下或显示键位 Hard；不给 Easy（节奏里没有可靠的"反应快"信号）。同样每个练习日只用第一次评分更新 FSRS。
- BPM 的 85% 规则（`adaptBpm`）：结束时看最近 20 步（至少 10 步）的干净率，> 90% 建议 ×1.05，< 75% 建议 ×0.9（40–200）；用户点"下次用 X"才保存到这条进行的 BPM。

### 进行练习器（`/practice/progression`，自由练习页的第二个标签）

- 内置进行或自定义序列（和弦名用空格、逗号、短横线、竖线分隔；内容包里有的和弦用参考键位，没有的用 `closeVoicing` 自动排列）。
- 选项：BPM（每条进行各记一个，默认 72）、每个和弦几拍（按进行 / 1 / 2 / 4）、节拍器（每拍 / 2、4 拍 / 关）、强拍重音、判定、循环（2/4/8/一直弹）、隐藏键位、自动调整速度。
- 弹奏界面：拍点指示、预备拍倒数、大字当前和弦 + 下一个、每步的结果（在拍上 ±ms / 早了 / 晚了 / 弹错 / 漏了）、这一遍的进度条、声部进行图 + 键位（隐藏键位时都不显示，弹错时仍显示多按/少按）。Esc 结束。
- 总结：干净率、弹对、在拍上、平均齐整度、平均偏差、稳定性（标准差）、偏差分布直方图（−200…+200 ms，每格 20 ms）、各切换的干净次数、85% 规则的速度建议。

### 声部进行可视化（`VoiceLeading`）

- 左右手分别用 `voiceLeading()`（移动总量最小的配对）配对；上排当前和弦、下排下一个和弦，与同音域的键盘对齐（`keyCenterX`）。
- 共同音：灰色竖直虚线；移动 1–2 个半音：实线（手的颜色）并标 ±半音数；更远的移动：长虚线；新增/消失的声部：虚线圆圈。

### 跟拍主题的课程（`RhythmLesson`）

讲解示范 → 引导（目标速度 × 0.8，显示键位和声部进行，弹 2 遍）→ 独立（目标速度、隐藏键位，干净地弹对 `independent.requiredCorrect` 个和弦就结束）→ 掌握检查（目标速度、隐藏键位，弹满 `mastery.questions` 个和弦所需的遍数；没有漏弹且干净率 ≥ `mastery.minAccuracy` 通过；干净率 ≥ 95% 记 Good，否则 Hard）。`mastery.timeLimitMs`、`guided.count` 对跟拍主题不用。

## 统计、测验、诊断与发布（M6）

### 备份与迁移（`storage/backup.ts`，设置页"数据"）

- 导出 JSON：`{ kind: 'mayochord-backup', formatVersion: 1, exportedAt, dbVersion, appVersion, tables: { reviewLogs, settings, calibrations, cardStates, sessions, dailyPlans, userPacks } }`。作答日志去掉本地自增的 `seq`，导入时按时间重新生成。
- 导入会**替换**全部数据（一个事务，失败不改动），之后重新加载页面。Zod 校验，错误分 json / kind / format 三种提示。
- CSV：作答日志每条一行，带 ISO 时间列，数组用空格连接，开头加 BOM（Excel 打开中文不乱码）。
- 业务代码通过仓储接口 `repos.backup`（export / import / allLogs）访问。

### 统计页（`/stats`，`core/stats`）

- 总体（作答次数、正确率、练习天数、连续天数）、主题掌握进度、最近 30 天每天的 XP（柱状图）、看名弹和弦练得最多的 6 个和弦的反应时间中位数（折线图，只算正确且没看提示的）、和弦切换热力图（切换练习的平均用时，单一色相浅→深 = 快→慢）、跟拍练习的节拍偏差分布与每天的标准差。
- ECharts 6.1（Apache-2.0）按需引入（line / bar / heatmap + SVG 渲染），只在统计页懒加载；颜色在渲染时读取主题令牌，切换深浅色时重画。
- 分类色：dataviz 参考色板前 6 个（`--chart-1…6`，深浅两套），已用校验脚本对 `--card` 校验（色弱分离、正常视觉）。浅色下 3 个颜色对比度不足 3:1 → 每个图表都有"查看数据表"。
- 桌面导航有"统计"；手机底栏放不下，从"今天"的"最近 7 天"旁边的"查看统计"进入。

### 测验与针对性补救（规格 6.6，`scheduler/daily.ts` + `LearningService.recordQuiz`）

- 测验：最近 14 天掌握了 ≥ 3 个主题、离上次测验 ≥ 4 天、且上次测验之后又掌握了新主题时排一次。最近掌握的在前，最多 6 个主题，每个 2 张卡（回忆概率最低的），交错；按顺序、不能看提示、答错不重做、时限取这些卡所属主题掌握检查时限中最长的。
- 成绩按主题记为主题日志 `'quiz'`（与复习一样更新主题记忆、传递隐式信用）。答错的卡片存在 settings 键 `'remediation'`（`{ at, cardIds }`）。
- 针对性补救：编排时把上次测验答错、之后还没答对过的卡片（最多 8 张）排在热身之后；每张卡至少练两遍、答错马上看提示改正。测验结束页也可以"马上补练"。

### 诊断测试（`/diagnostic`，`graph/diagnostic.ts`）

- 每次测一个主题 4 题（均匀挑卡），限时、不能看提示，答对 3 题算会；最多测 10 个主题，可以随时停下。跟拍主题不参与（由先修推断）；已经掌握的主题不测。
- 选题：还不确定的主题里，不确定先修数与不确定后继数中较小的一个最大（二分）。通过 → 它和全部先修推断为已掌握；没通过 → 全部后继推断为还要学（已推断为掌握的不变）。
- 结束时：直接通过的主题记主题日志 `'diagnostic'`（Good），推断的记 Hard；今天的任务都还没开始时重新编排今天。
- "今天"在还没开始任何主题时显示诊断测试入口；图谱页也有入口。
- **跳级**：图谱上未解锁的主题可以直接进入课程（"已经会了？直接学这一课"）；通过任何主题的掌握检查后，它还没掌握的先修主题都记 `'diagnostic'`（Hard）推断为已掌握。

### 英文界面

- 设置 → 外观里切换（每种语言用自己的名字显示）。内容包全部主题的标题、简介、讲解都有英文；进行名称、说明也有英文。
- 12 调构建的文字题在英文下是"E♭ minor"这样的说法。

### PWA

- `vite-plugin-pwa` 2.0（MIT）+ `workbox-window` 7.4.1（MIT）：自动更新；预缓存 js/css/html/svg/png（约 100 个文件、3 MB，含 VexFlow）；字体（woff2）和钢琴采样运行时缓存（CacheFirst）。导航回退到 `index.html`。只在正式版本注册 Service Worker。
- 图标：`public/icon-192.png`、`icon-512.png`、`icon-maskable-512.png`（安全区 80%）、`apple-touch-icon.png`，由 favicon.svg 渲染。
- 端到端测试：缓存后断网，和弦库、统计页照常打开。

### Lighthouse（2026-10-15，生产构建本地预览）

- 桌面预设：今天 92 / 100 / 100 / 100（性能 / 无障碍 / 最佳实践 / SEO），统计 89 / 100 / 100 / 100，图谱 97 / 100 / 100 / 100。
- 移动预设（慢速 4G 模拟）性能只有约 44：中文字体子集（约 850 KB）和路由 chunk 的串行加载。应用面向电脑上的 Chrome + USB 键盘，暂不优化；以后可以考虑减少首屏字体、预加载首页路由。
- 为此修过的无障碍问题：`--subtle-foreground` 加深/提亮到对比度 ≥ 4.5:1，"今天"右侧统计改成列表、任务标题改为 h2。

## 曲谱跟弹（M7）

### 导入与乐谱模型（`packages/core/src/score/`，纯函数）

- 格式按文件内容判断（`detectScoreFormat`）：`MThd` → MIDI，`PK` → .mxl（fflate 0.8.3 解压，读 `META-INF/container.xml` 的 rootfile），否则当作 MusicXML 文本（UTF-8，或带 BOM 的 UTF-16）。
- XML 解析自己写（`xml.ts`）：core 不能用 DOMParser。只支持 score-partwise；timewise 给出提示。
- 统一模型 `Score`（tick，四分音符 = `TPQ` = 960）：
  - `notes`：演奏用的音（连音线已合并），`hand` 由谱表决定（谱表 1 右手、2 左手；只有一行低音谱表时是左手）；
  - `elements`：记谱用的音符/和弦/休止符（时值类型、附点、连音、连音线、临时记号），五线谱用；
  - `measures`：拍号、调号、每行的谱号；`tempo` 取谱上第一个速度标记（没有时 120）。
- MusicXML 选声部：第一个有两行谱表的声部（钢琴）；否则前两个有音的声部当作右手、左手，其余写进 `warnings`（parts-ignored）。第 3 行以后的谱表并到第 2 行。装饰音（grace）、cue 音不要。弱起小节按实际长度。
- 临时记号自己算（`assignAccidentals`）：小节开始按调号，同一小节、同一谱表、同一八度的同一字母沿用；连音线延续过来的音不画。
- MIDI：格式 0/1，按四分音符计时（SMPTE 不支持）；打击乐（通道 10）不要；恰好两条有音的轨道时平均音高高的是右手，否则以中央 C 为界。按 16 分音符对齐；记谱时每只手一个声部，同时开始的音合成和弦，时值到下一个起音为止（演奏用的音保留原长），跨小节用连音线。音名按调号拼写（升号调用升号，降号调用降号，C 调用默认写法）。
- 第一版的限制（规格已写）：跟拍模式按一个固定速度（曲中变速时 `tempo-changes`）；装饰音不显示。
- 示例曲谱：`packages/content/src/scores/example.ts`，贝多芬《欢乐颂》主题（旋律公有领域）的自编简易版，16 小节，C 大调，♩ = 96。

### 跟弹判定（`score/follow.ts`）

- `buildFollowPlan(score, hands, from, to)`：按起音分组，每组 `notes`（自己弹）和 `auto`（另一只手：网页弹或静音）。
- **等待模式**（`startWait` / `waitNoteOn`）：逐音判定（直接用 noteOn，不等和弦"弹稳"），这一组的音都按到了（可以一个一个按，不要求同时按住）才往下走；不在这一组里的音记为按错，这一组记"有错"（重复按同一个错音只记一次）。只有另一只手的组由控制器按谱上时值等一会儿自动跳过（`waitSkipAuto`），不记成绩。
- **跟拍模式**（`startTempo` / `tempoNoteOn` / `tempoTick`）：第 k 组的时刻 = 段落开始 + 跨循环的 tick × 每 tick 毫秒。按下的音（扣除延迟校准）与时间最近、音高相同、还没配对、距离在配对窗口内的谱上音配对，记偏差；配不上的算多按，记在时间最近的组上。窗口过了（+30 ms 余量）还没配上的算漏弹。配对窗口 = 半拍，限制在 120–250 ms；"在拍上"的容差与跟拍弹进行相同（`onBeatToleranceMs`）。预备拍里按的不算。手动结束时，窗口还没关但已经全部弹到的组也算上。
- 总结 `summarizeWait` / `summarizeTempo`，按小节 `MeasureStat { total, errors, offBeat }`（等待模式按组计，跟拍模式按音计；错误 = 漏弹 + 多按）。错误率 `measureErrorRate` = (错误 + 0.5 × 不在拍上) / 总数。`worstMeasures` 把多次练习合起来，至少练过 3 次、有错误的小节按错误率排序。

### 网页（`features/scores/`）

- `/scores`：本地乐谱库（导入文件、拖放、添加示例、删除）。桌面导航有"曲谱"；手机从"自由练习"的第三个标签进入。文件最大 10 MB。
- `/scores/$scoreId`（专注模式）：选项（视图、模式、手、另一只手、小节范围、速度 25–150%、遍数、节拍器、键盘提示）存在这首曲子的 `prefs`（Zod 校验，每个字段损坏时单独回退默认值）。点五线谱上的小节设为起点，Shift 点设为终点。
- 三种模式：等待、跟拍（预备一小节，节拍器可关）、试听（网页弹出两只手，不判定）。另一只手"网页弹"时开始前先加载钢琴音源（加载期间显示"准备中…"，不接收输入）。跟拍、试听时网页的音用音频时钟提前 400 ms 安排（`AudioOutput.playAt` + `perfToContextTime`），与节拍器对齐。
- 五线谱视图（`render-score.ts`，VexFlow 5，懒加载）：小节宽度按音符数估计后拉伸填满一行；连音、附点、符杠（`Beam.generateBeams` 按拍号分组）、多声部（第一个声部符干向上）、跨行连音线。**排版前要等 Bravura 字体加载完**（`fontsReady()`），否则量出来的符头宽度不对，符头和符干错开。VexFlow 的符干写死 `stroke="black"`，用 CSS 改成 currentColor。当前组高亮、弹对/弹错着色（只改 class），当前小节不在视野里时自动滚动。
- 瀑布流（`WaterfallView`，canvas）：与下方同音域的键盘对齐，一屏 8 拍；每帧直接读控制器状态。另一只手的音画淡，范围外的更淡。
- 点击切换模式的屏幕键盘：每到下一组自动松开。
- 结果：每个小节一格（颜色 + 文字说明），点一格就只循环练这个小节；"以前最容易出错的小节"来自所有跟弹记录。练习记录写进 sessions（`config.kind: 'score'`，XP：等待模式每组最多算 20 秒，跟拍模式按弹奏时长），所以计入今天的 XP 和连续天数；不写作答日志（没有卡片）。

## 反复记号与自动标和弦（M8）

### 反复记号（`score/repeats.ts`）

- MusicXML 每个小节读出 `MeasureFlow`：前反复、后反复（`times`，默认 2 遍）、跳房子结尾编号（`<ending>` 从 start 到 stop/discontinue，编号 "1, 2" 这样的写法也认）、segno、coda、D.C.（`sound dacapo="yes"`）、D.S.（`dalsegno`）、To Coda（`tocoda`）、Fine（`fine`）。**只认 `<sound>` 属性和 `<segno/>`、`<coda/>` 记号**，只写成文字的跳转认不出来。
- `playbackOrder`：后反复跳回最近的前反复（没有时回到开头或上一个反复结束之后）；第 n 遍只弹包含 n 的结尾；D.C./D.S. 只跳一次，跳转之后不再反复、走每段跳房子里编号最大的结尾，遇到 Fine 结束、To Coda 跳到它后面的 coda。最多 8 × 小节数 + 16 个小节（防止死循环）。结果存在 `Score.playback`（MIDI 和没有反复的谱就是 0…n-1，`hasRepeats` 判断）。
- `practiceSequence`：练一段小节时，按演奏顺序从 from 第一次出现到 to 最后一次出现（to 是最后一个小节时一直到演奏结束，包括 D.S. 之后），只留这段里的小节；只选一个小节时弹一遍；关掉"按反复记号弹"时按谱面顺序。
- `buildFollowPlan` 的步按这个顺序排在**演奏时间轴**上（从 0 开始，`plan.segments` 记每个小节在时间轴上的开始），`step.measure` 仍是谱面小节，所以五线谱高亮、按小节统计照旧（同一小节弹两遍的错误合在一起）。瀑布流也按 plan 画（循环时把下一遍的开头也画出来）。

### 自动标和弦（`score/chords.ts`）

- 每小节先整小节判断；拍数为偶数时也分两半判断，**两半根音不同**、都够可信、且分开更好时分成两个（低音在小节中间换了时门槛更低）。
- 打分：音级权重 = 响的时长（四分音符 = 1），段落开头就响着 × 1.3、左手 × 1.3。和弦音权重 − 0.6 × 非和弦音权重；缺三音扣 8%；低音是根音加 15%，转位扣 5%，低音不是和弦音扣 8%；复杂的和弦稍微扣分。根音至少占 12%；七音、九音、六音、sus、减五、增五这些特征音至少占 12% 才选；sus 和弦只在根音是低音时考虑；只有一个音不标；可信度（和弦音比例）< 0.45 不标。
- 候选：maj、m、7、M7、m7、m7♭5、dim、dim7、aug、sus4、sus2、add9、7(9)、M7(9)、m7(9)、6、m6。根音按调号拼写（调内音按音阶，调外音按调号方向）。
- 示例《欢乐颂》的结果与编配完全一致（`content.test.ts`）。真实乐谱的准确度待用户测试。
- 网页：五线谱上方、瀑布流右边显示（同一小节里相同的不重复标），可以关掉（`prefs.chords`）。"用这段的和弦练跟拍"把这一段（按演奏顺序，相邻相同的合并）的和弦写进进行练习器的自定义序列（上限放宽到 600 字）并跳过去；每个和弦的拍数用进行练习器自己的设置，不保留原曲的时值。

## 课程扩展：和弦词汇、调性与进行（M9）

- 内容包 0.6.0：和弦 108 个（新增 sus4/sus2、add9、6/m6、dim/aug、dim7、九和弦，以及七和弦转位的斜杠和弦）、进行 23 条、主题 48 个（新增 18 个）。内容由 `scratchpad` 里的脚本生成后手工核对，不在仓库里。
- 新主题：sus、add9、六和弦、九和弦（干扰组 color-tones）；减与增三和弦（triad-quality）；减七（seventh-quality）；七和弦转位；对比配对 sus4/大三、dim/aug、add9/M7(9)；降号调与升号调的 II–V–I、1625、小室进行、卡农进行、副属和弦、借用和弦、经过减七（切换练习，宽松判定）。
- **进行的步可以不写键位**（`voicingId` 可选）：`voiceLeadProgression()` 在加载时推出——第一个和弦用参考键位（复制一份，ID `<进行>-<序号>`，status generated），之后右手取 `rankRightHandVoicings` 的第一名（三音组合找不到时用 4 个音），左手 `nearestBass`。生成的键位不进 `voicingById`。`content.test.ts` 检查：只用和弦音、最低音是低音/根音、右手最高音每步不超过 5 个半音。

## 课程（2026-10-17 用户要求：像 Math Academy 那样分开、可以选择）

- 内容包 `courses`（0.8.0）：和弦课程 `chords`（48 个主题）、五线谱课程 `reading`（11 个）。校验：给了课程就要覆盖全部主题，每个主题恰好一门。加载后 `courses`（主题按图谱顺序）、`courseById`、`courseOfTopic`；内容包没给课程时整个图谱是一门（id `all`）。
- 设置 `activeCourse`（默认 chords）。`LearningService.currentCourse()`（设置的课程不存在时用第一门）、`lessonTopicsFor(course, statuses?)`：课程主题 + 递归的别的课程里的先修；**给了状态且课程里已有能学的主题时，不加别的课程的先修**（需要时才补，例如五线谱课程一开始先学"认识键盘与音名"）。
- `planDay` 新参数 `lessonTopics`：新课只从这里安排；复习、测验、热身照常覆盖所有学过的主题。
- `switchCourse()`（`service.ts`）：保存设置后 `applyCourseChange()`——今天还没开始的新课换成新课程的（ID `<日期>:lesson:<课程>-<n>`），做完、跳过的任务和复习、测验不动。
- 界面：`CourseSwitcher`（"今天"和图谱页顶部，每门显示已掌握 / 全部和进度条）。图谱只画当前课程（`lessonTopicsFor` 不带状态，别的课程的先修淡显，标"先修 · 和弦课程"）；"今天"右侧的已掌握数、"继续学"列表也按当前课程。

## 五线谱显示改进（2026-10-17，用户导入官方 .mxl 后反馈"少了很多信息、重叠了"）

- MusicXML 现在还读：`<stem>`、第一层 `<beam>`、`<notations>` 里的奏法（accent、staccato、tenuto、strong-accent、staccatissimo）、`<fermata>`、`<arpeggiate>`、`<slur>`；`<direction>` 里的力度、文字、排练号、`<wedge>`、`<pedal>`、`<octave-shift>`（存在 `Score.directions`，tick 含 `<offset>`）。和弦里每个音的记号合并到这个音符上。
- **8va/8vb**：MusicXML 的 pitch 是实际音高；`octave-shift type="down"`（8va）范围里的音显示低一个八度（`NotationElement.octaveShift = -1`），`up`（8vb）高一个八度；演奏用的音不变。
- 排版（`features/scores/score-layout.ts`，纯函数有测试）：每行按实际最高、最低的音（加线、符干 35 px、奏法）和记号行算每个谱表上下的空间，谱表之间至少 40 px；和弦名在最上面一行（`MeasureBox.labelY`）；每行开头标小节号。
- 画法（`render-score.ts`）：谱上有符杠连法时按它画（否则自动分组），有符干方向时照着画；连线用 `Curve`（跨行分两段）；力度、文字、Ped./* 用文字；渐强渐弱画发夹；8va 画虚线括号；排练号画方框。
- 还不支持：跨谱表的符杠、颤音等装饰记号、谱里自带的和弦标记。
- 测试用的谱放在 `local-packs/`（不提交）。用户的官谱是 PDF（`E:\piano\ztmy\`），用 **Audiveris** 识别成 .mxl：识谱结果没有标题、作者、速度、排练号（这些在文件里就没有），速度默认 120。

### 第二轮（2026-10-18，用户："后面的五线谱加载失败、还是少信息、没有当前位置的标记、看起来廉价"）

- **加载失败**：VexFlow 的琶音 `Stroke` 画的时候会读取同一时刻**所有**音（包括另一个谱表上还没排好的音）的 y，报 NoYValues，整首谱都画不出来。琶音改成自己画（`drawArpeggio`，和弦左边的竖波浪线）。另外每个小节单独 try/catch：画不出来的小节空着，不影响后面（`console.warn` 记下是第几小节）。
- **MusicXML 新读的**（`score/musicxml.ts`）：`<print new-system/new-page>` → `ScoreMeasure.systemBreak`；`<time symbol>` → `timeSymbol`；右侧 `<bar-style>` → `barRight`；`<clef>` 记下在小节里的位置 → 小节开头的谱号 `clefs`、小节中间的 `clefChanges`，每个音符带 `clef`（之后的音按新谱号画、排版）；装饰音挂在同谱表同声部的下一个音符上（`graces`，含写出的临时记号、斜线，不进演奏的音）；休止符的 `display-step/octave` → `restAt`。
- **排版**（`render-score.ts`）：原谱有换行就照着换（放不下时允许挤到 115%，再不行自动换行）；小节中间换谱号用 `ClefNote`（小号），上一小节末尾换了谱号时这一小节开头画小号谱号；反复记号、跳房子括号（`setVoltaType`）、双小节线、终止线（两行谱表的连线也跟着变）。
- **页面**（`ScorePlayerPage.tsx`）：顶部标题 + ♩/拍号/小节数；工具栏只放模式、手、速度、小节范围和开始，其余（视图、另一只手、遍数、原速、开关、送和弦到进行练习器）收在"更多选项"；谱面是白纸（局部 `data-theme="light"`，深色模式也是），纸上有衬线字体的标题；弹奏时有播放光标（`score-cursor`，罩住当前这组音的符头，跨两个谱表），当前小节有底色。
- **原速** `prefs.baseBpm`：谱上没速度时提示去改；开始弹时用改过速度的 score 副本。

## 五线谱教程（M10）

- **新卡片**：
  - 看谱认音 `staffnote:<treble|bass>:<音>[@<调>]`（`StaffNoteCard`，cardKind `staff-note`，练习类型 `staff-to-note`）：严格判定，**八度也要对**；走普通的出题、评分、复习流程（85% 时限初始 6 秒）。同一个中央 C 在两种谱表里是两张卡。
  - 节奏读谱 `rhythm:<节奏型>`（`RhythmCard`，cardKind `rhythm`，练习类型 `rhythm-reading`）：不走 PracticeController，有自己的控制器 `features/reading/rhythm-session.ts`（单例 `rhythm.ts`，界面 `RhythmRunner.tsx`）。结束时给出同样的 `SessionResult`，课程、每日复习照常记录。
- **单音题不再检测"整体平移"**（`trial.ts`）：目标只有一个音时，弹错任何音都"像"平移，以前会显示"OCTAVE/TRANSPOSE 可能被改动"而不判错（认音名题也是）。现在只对两个音以上的目标检测。e2e 测试发现的。
- **节奏读谱的流程**：每张卡先停 0.9 秒（引导练习、第一次见到的卡先放示范：节拍器 + 每个起点敲一下，记为看了提示）→ 预备一小节（节拍器按四分音符响，6/8 一小节 3 下）→ 自己按一小节 → 判定：每个起点与时间最近、距离在窗口内（相邻起点间隔的一半，60–250 ms）的按键配对，扣延迟校准；`|偏差| ≤ onBeatToleranceMs` 算在拍上；预备拍里、小节外 250 ms 以上的按键不算；多按、漏按算错。评分：错 Again，全部在拍上 Good，否则 Hard（看了示范最多 Hard）。日志记平均偏差 `beatOffsetMs`。答错的卡 2 张之后再来（retryWrong）。
- **每日任务**：`TopicPlanInfo.separate`（节奏主题为 true）→ 复习单独成为任务（`TaskPage` 看到全是节奏卡就用节奏读谱的界面），热身、针对性补救、测验不包含节奏卡；诊断测试不测节奏主题（由先修推断）。
- **谱表绘制**（`design/staff/render-staff.ts`，VexFlow 懒加载）：`renderStaffLine`（一行谱表或大谱表上几个全音符，调号里的音不画升降号、调号升降过的字母写成本位时画还原号，可以标音名）、`renderRhythm`（打击乐谱号，音符都在第三线、符干向上，符杠按拍号分组，三连音、连音线、附点、休止符）。排版前等 Bravura 字体（`staffFontsReady`）。VexFlow 给 SVG 写的固定 style 要去掉，否则不缩放。React 组件 `design/staff/StaffLine.tsx`（`StaffLine`、`RhythmStaff`，最多放大到自然大小的 2 倍）。
- **内容**：11 个主题——认识五线谱 → 高音谱表 / 低音谱表认音 → 加线与中央 C；升降号与还原号 → 调号；音符时值与休止符 → 拍号与数拍 → 切分、十六分音符与三连音；谱上的其他记号与综合认音（反复、D.S.、踏板、力度、8va 只讲解，练习是两种谱表混合认音）；看五线谱弹和弦：F 调与 G 调。26 个节奏型（自编）。讲解文字都是自己写的。
- 屏幕键盘的高度上限改用 `width: min(100%, …)`（不再用 inline `max-width`，否则会盖掉调用方的 `max-w-*` 类）。

## 设计系统

- **视觉方向：真夜中**（M0 由用户选定，其余两套已删除）。墨蓝黑底 + 钠灯琥珀主色，左手冷青色、右手琥珀色。和弦名 Bricolage Grotesque，界面 Instrument Sans + Noto Sans SC，等宽数字 JetBrains Mono。
- 只有**白天（light）和夜间（dark）**两种模式，外加"跟随系统"。用户要求：任何界面都只做这两种模式，不再提供其他风格切换。
- 令牌定义在 `apps/web/src/design/tokens.css`：`:root` 放与深浅色无关的令牌，`[data-theme="dark"]` / `[data-theme="light"]` 放颜色。`<html>` 上的 `data-theme` 由 `stores/appearance.ts` 和 `index.html` 首屏脚本设置；任意子元素也可以设置 `data-theme` 局部覆盖（`/design` 并排对比、Select 弹层）。
- 命名沿用 shadcn（background、foreground、card、primary、muted …），另有 `surface-2`、`subtle-foreground`、`border-strong`、`success`、`warning`、键盘令牌（`key-*`）、左右手（`hand-left/right`）、判定标记（`mark-correct/extra/missing`）、动效时长（`dur-*`，`prefers-reduced-motion` 时为 0）。
- **组件不使用 `dark:` 变体**：深浅色只通过令牌切换，这样才能在深色页面里嵌套浅色区域。
- 键盘标记除颜色外用形状区分：目标=实心圆（左右手不同色）+指法数字；按对=圆+对勾+琴键染色；多按=方块+叉+斜线纹理；少按=虚线圆环+琴键虚线描边呼吸闪动。
- 和弦名用 `ChordName` 组件：♭ ♯ 使用 `Noto Music`（只引入 music 子集，仅覆盖音乐符号的 unicode-range），扩展音（♭5、(9)、add9）用小字号上移。
- `/design` 是组件展示页，集中展示所有组件的白天/夜间效果，新增组件时也加到这里。
- **平板与矮屏幕**（2026-10-17 用户在平板上要缩放到 60% 才能用）：屏幕键盘按宽度等比放大，横屏时会把页面撑出屏幕。现在：
  - `Keyboard` 的最大宽度 = `--kb-max-h` × 宽高比（`keyboardMaxWidth()`），默认 `max(9rem, 36dvh)`；与键盘对齐的图层（声部进行、瀑布流）的外框用同一个宽度。
  - 和弦名字号 `--text-chord-stage/lg` 也按屏幕高度缩小。
  - 专注模式（练习、跟拍弹进行）用 `design/focus-layout.ts`：横屏且高度 < 900 px、宽度 ≥ 900 px（Tailwind 变体 `split:`）时改为**左边键盘和按钮、右边题目**（用户的提议），整页不滚动；题目栏是容器，字号按栏宽（`cqi`）。

## JUNO-D7 实测行为

> 只记录用户在琴上实测、由 `/monitor` 导出 JSON 证实的结果。"待测"的项目在代码里不做任何假设。

### 第 1 次实测（2026-10-14，Windows 11，Chrome 154，USB）

数据：170 条消息、约 108 秒。弹了 C5–G5 单音、C 大三和弦，以及第 11 节的全部 11 个参考键位。
其中和弦部分已抽出为回归测试夹具 `packages/core/src/recognition/fixtures/juno-d7-reference-chords.json`
（`juno-d7.test.ts` 重放后 14 个和弦全部识别正确）。

| 项目 | 实测结果 |
|---|---|
| Web MIDI 输入端口名 | **`JUNO-D`**（不含 7），manufacturer `Roland Corp.`，只有 1 个输入端口 |
| 输出端口（有无、名称） | 有，1 个，名称同样是 `JUNO-D` |
| 键盘发送的 MIDI 通道 | 通道 1（只出现过通道 1） |
| 最低键 / 最高键 MIDI 号（octave 默认） | **28（E1）– 103（G7）**，已验证 |
| 力度范围 | 本次 1–89；第 2 次实测 8–126 |
| note off 形式 | **0x8n note off**（85 次），没有出现 0x9n velocity 0；note off 带非零的松键力度（0–94） |
| CC64 踏板值 | **用户目前没有延音踏板**，等有踏板后再测。踏板相关代码按规格保留，但未经真机验证 |
| active sensing | 约 108 秒内 **0 条** |
| 节奏型播放时是否发 MIDI clock / start / stop | 不发送（第 2 次实测，当前设置下） |
| OCTAVE / TRANSPOSE 按钮效果 | 会改变发出的音符号，具体规律未确定（见第 2 次实测） |
| SPLIT / DUAL 时的通道 | 见第 2 次实测 |
| Windows 上端口被 DAW 占用时的报错 | 待测 |
| 时间戳分辨率 | `MIDIMessageEvent.timeStamp` 基本是整毫秒（约 1 ms 分辨率） |
| 时间戳→回调延迟（`recv - t`） | 平均 4.4 ms，最大 59 ms。和弦里后到的音回调延迟更大，而时间戳仍贴近真实按键时间 → **计时一律用 timeStamp，不用回调时刻** |
| 实测齐整度（同一和弦最早到最晚按下） | 14 个和弦为 13–62 ms（E7 最大 62 ms），都在 80 ms 判定窗口内 |

导出 JSON 已列入 `.gitignore`（`mayochord-midi-capture-*.json`），只把抽出的夹具提交到仓库。

### 第 2 次实测（2026-10-14，同一环境）

数据：974 条原始消息，但**每条都被记录了两次**（时间戳、内容完全相同）。原因是监视页的 bug，不是琴的行为，见下方"已修复的问题"。去重后 487 条。这次没有点测试清单的步骤标记，以下按时间段推断：

| 项目 | 实测结果 |
|---|---|
| 音域（0–36 s 从最低键逐个弹到最高键） | **最低 28（E1），最高 103（G7）**，正好 76 个键。用户确认当时 OCTAVE/TRANSPOSE 为默认状态 → **已验证** |
| 力度范围 | 8–126 |
| SPLIT（约 85–95 s） | 下半部分用 **通道 2** 发送（出现过 33–48），上半部分仍是通道 1。分割点待确认 |
| DUAL（约 99 s 起） | **每个音同时在通道 1 和通道 2 各发一次**，力度相同、时间戳相同。→ 输入层必须按音符号跨通道合并，否则 DUAL 时会把一个音算成两次（M1 的 InputHub 实现，并写测试） |
| 通道 16 的控制消息（约 80–82 s） | `CC0=85`、`CC32=64`（Bank Select）+ Program Change 1–8，都在**通道 16**。用户不记得按的是哪个按钮。练习逻辑忽略这些消息即可 |
| active sensing、MIDI clock、start/stop | 都没有出现。用户确认这次测过节奏型 → **以当前设置播放节奏型时，USB 上不发送 MIDI clock / start / stop**（琴上是否有开启的设置项未查证，与节奏型同步属于“之后”的功能） |
| OCTAVE / TRANSPOSE | 用户确认这次测过。41.6 s 按中央 C 得到 60（默认状态）；55–71 s 出现 74、76、69、71、67 等，说明**OCTAVE/TRANSPOSE 会改变发出的 MIDI 音符号**（不是只改琴内部音源）。但没有步骤标记，无法确定每个音对应哪种设置，具体偏移规律**未确定**。M1 的八度校准（按中央 C 记录偏移）不依赖这个规律；做校准功能时顺便用步骤标记再确认一次 |
| 时间戳→回调延迟 | 平均 2.7 ms，最大 39 ms |

### 耳机里的滋滋声（2026-10-17 用户反馈，原因待确认）

| 测试 | 结果 |
|---|---|
| 杂音从哪里出来 | JUNO-D7 的耳机 |
| 插着 USB、不打开网站 | 没有杂音 |
| 打开 MIDI 监视页（网页完全不发声）弹琴 | 有杂音 |
| 连平板（不是电脑）| 也有杂音（所以不只是这台电脑的问题） |

- 网页只打开所选的**输入**端口（`input.open()` + `onmidimessage`），不打开输出端口、不发送任何 MIDI，MIDI 键盘弹奏时网页也不发声。
- 推测：输入端口打开后电脑开始读取琴的 USB MIDI 数据，按键时的 USB 数据传输经地线/电源串进琴的音频（接地环路一类的硬件问题）。**未证实**，还需要：拔掉充电器用电池供电时是否还有；换 USB 口/不用集线器/换线；用别的 MIDI 软件打开这个端口时是否也有。

### 已修复的问题

- **监视页每条消息分发两次**（第 2 次实测）：页面已有 MIDI 权限时，进入监视页会自动连接；开发模式下 React StrictMode 让这个 effect 执行两次，并发调用了两次 `requestMIDIAccess`，得到两个 MIDIAccess，两个端口对象各自挂了回调。修复：`WebMidiService.request()` 并发调用共用同一个 Promise；`attach()` 用代数计数器丢弃过期的挂载。回归测试 `apps/web/src/input/webmidi.test.ts`。
- 第 1 次实测前"按键没反应、刷新后正常"：未能复现，原因不确定。如果再出现，请导出 JSON（即使是空的，也会记录端口状态）。

