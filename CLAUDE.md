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
| M6 统计与发布 | 完成（用户 2026-10-15 确认） |
| M7 导入乐谱跟弹 | 进行中 |

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
  timing/       音频时钟↔performance.now() 换算（clock.ts）、节拍网格与"在拍上"容差（beat-grid.ts）、
                延迟校准（latency.ts）、统计（平均、标准差、直方图）
  drill/progression-run.ts  跟拍弹进行的判定（纯函数状态机）、证据、评分、总结、BPM 的 85% 规则
packages/content/src/
  schema/       Zod：内容包（含跨字段校验）、设备配置
  packs/        内置内容包 mayochord-core.json（第 11 节 + 课程用的和弦（共 72 个）+ 30 个主题）
  devices/      设备配置 JSON（JUNO-D7、通用 88 键）
  load.ts       校验 + 加载成 LoadedPack（ChordEntry、ProgressionEntry）
apps/web/src/
  app/          bootstrap.ts：启动时连接输入源、汇流、实时输入、音源、存储、校准
  routes/       /（今天）、/graph、/learn/$topicId（课程，专注模式）、/practice/progression、
                /practice/progression/run（专注模式）、/today/task/$taskId（热身/复习，专注模式）、
                /review/$topicId（从图谱进入的复习）、/practice、/practice/session（专注模式）、
                /chords、/chords/$chordId、/monitor、/settings、/design
  features/     shell、today（每日任务）、graph（知识图谱）、learn（LearningService、课程、每日任务运行）、
                practice（PracticeController、SessionRunner、ChordCues 题面、自由练习、轮次总结）、stats（统计页）、
                progression（进行练习器：ProgressionRunController、ProgressionRunner、总结、声部进行图 VoiceLeading）、
                chords（和弦库、详情、试弹）、midi（设备面板）、monitor、settings、design-gallery
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

`{ id, version(semver), schemaVersion, name, chords: [{ id, root, quality, bass? }], voicings: [{ id, chordId, reference, status, notes: [{ pitch, hand, finger? }], note? }], progressions: [{ id, name, key, steps: [{ chordId, voicingId, beats }], description? }], topics: [...] }`
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

### 本地数据库（Dexie，`MayoChordDB`，当前 version 2）

| 表 | 主键 / 索引 | 说明 |
|---|---|---|
| reviewLogs | `++seq, &id, ts, cardId, sessionId, [cardId+ts]` | 作答日志，只追加（仓储接口不提供修改、删除） |
| settings | `key` | 'app' → AppSettings（Zod 校验，每个字段损坏时单独回退默认值） |
| calibrations | `deviceKey` | 每个 MIDI 设备的音高偏移、实测音域 |
| cardStates | `cardId, due` | `{ cardId, due, progress: CardProgress }`。**缓存**，可由 reviewLogs 重放重建（`replayProgress`）。新卡 due = `Number.MAX_SAFE_INTEGER` |
| sessions | `id, startedAt` | 每轮练习：`{ id, startedAt, endedAt, kind: 'practice', config, summary }` |
| userPacks | `id` | 用户导入的内容包（M6） |
| dailyPlans（v2） | `date` | 每日任务：`{ date, createdAt, tasks: [{ id, kind, topicIds, cardIds, minutes, covers, status: pending/done/skipped, completedAt, xp, result }], dueTopics, spareLessons }` |

- 主题进度**不入库**：每次从主题日志（`cardId` 以 `topic:` 开头）重放得到（`replayTopicProgress`），日志不多，保证与日志一致。
- ReviewLog 新增可选字段 `xp`、`mashing`（M3 起写入；之前的日志没有）。sessions 记录新增 `xp`，`config.kind` 为练习类型（practice/warmup/review/guided/independent/mastery）。

AppSettings 新增（M4）：`latencyOffsetMs`、`latencyCalibrated`、`metronomeVolume`、`progression`（进行练习器上次的选项与每条进行的 BPM，`ProgressionPrefsSchema`）。
settings 表另有键 `'adaptive'`：`{ 'name-to-chord' | 'transition': { timeLimitMs, sinceAdjust } }`（85% 规则的当前时限）。
M3 新增 version 2（dailyPlans 表），`db.test.ts` 有 v1 数据升级测试。

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

- 设置 → 外观里切换（每种语言用自己的名字显示）。内容包 30 个主题的标题、简介、讲解都有英文；进行名称、说明也有英文。
- 12 调构建的文字题在英文下是"E♭ minor"这样的说法。

### PWA

- `vite-plugin-pwa` 2.0（MIT）+ `workbox-window` 7.4.1（MIT）：自动更新；预缓存 js/css/html/svg/png（约 100 个文件、3 MB，含 VexFlow）；字体（woff2）和钢琴采样运行时缓存（CacheFirst）。导航回退到 `index.html`。只在正式版本注册 Service Worker。
- 图标：`public/icon-192.png`、`icon-512.png`、`icon-maskable-512.png`（安全区 80%）、`apple-touch-icon.png`，由 favicon.svg 渲染。
- 端到端测试：缓存后断网，和弦库、统计页照常打开。

### Lighthouse（2026-10-15，生产构建本地预览）

- 桌面预设：今天 92 / 100 / 100 / 100（性能 / 无障碍 / 最佳实践 / SEO），统计 89 / 100 / 100 / 100，图谱 97 / 100 / 100 / 100。
- 移动预设（慢速 4G 模拟）性能只有约 44：中文字体子集（约 850 KB）和路由 chunk 的串行加载。应用面向电脑上的 Chrome + USB 键盘，暂不优化；以后可以考虑减少首屏字体、预加载首页路由。
- 为此修过的无障碍问题：`--subtle-foreground` 加深/提亮到对比度 ≥ 4.5:1，"今天"右侧统计改成列表、任务标题改为 h2。

## 设计系统

- **视觉方向：真夜中**（M0 由用户选定，其余两套已删除）。墨蓝黑底 + 钠灯琥珀主色，左手冷青色、右手琥珀色。和弦名 Bricolage Grotesque，界面 Instrument Sans + Noto Sans SC，等宽数字 JetBrains Mono。
- 只有**白天（light）和夜间（dark）**两种模式，外加"跟随系统"。用户要求：任何界面都只做这两种模式，不再提供其他风格切换。
- 令牌定义在 `apps/web/src/design/tokens.css`：`:root` 放与深浅色无关的令牌，`[data-theme="dark"]` / `[data-theme="light"]` 放颜色。`<html>` 上的 `data-theme` 由 `stores/appearance.ts` 和 `index.html` 首屏脚本设置；任意子元素也可以设置 `data-theme` 局部覆盖（`/design` 并排对比、Select 弹层）。
- 命名沿用 shadcn（background、foreground、card、primary、muted …），另有 `surface-2`、`subtle-foreground`、`border-strong`、`success`、`warning`、键盘令牌（`key-*`）、左右手（`hand-left/right`）、判定标记（`mark-correct/extra/missing`）、动效时长（`dur-*`，`prefers-reduced-motion` 时为 0）。
- **组件不使用 `dark:` 变体**：深浅色只通过令牌切换，这样才能在深色页面里嵌套浅色区域。
- 键盘标记除颜色外用形状区分：目标=实心圆（左右手不同色）+指法数字；按对=圆+对勾+琴键染色；多按=方块+叉+斜线纹理；少按=虚线圆环+琴键虚线描边呼吸闪动。
- 和弦名用 `ChordName` 组件：♭ ♯ 使用 `Noto Music`（只引入 music 子集，仅覆盖音乐符号的 unicode-range），扩展音（♭5、(9)、add9）用小字号上移。
- `/design` 是组件展示页，集中展示所有组件的白天/夜间效果，新增组件时也加到这里。

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

### 已修复的问题

- **监视页每条消息分发两次**（第 2 次实测）：页面已有 MIDI 权限时，进入监视页会自动连接；开发模式下 React StrictMode 让这个 effect 执行两次，并发调用了两次 `requestMIDIAccess`，得到两个 MIDIAccess，两个端口对象各自挂了回调。修复：`WebMidiService.request()` 并发调用共用同一个 Promise；`attach()` 用代数计数器丢弃过期的挂载。回归测试 `apps/web/src/input/webmidi.test.ts`。
- 第 1 次实测前"按键没反应、刷新后正常"：未能复现，原因不确定。如果再出现，请导出 JSON（即使是空的，也会记录端口状态）。

