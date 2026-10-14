# CLAUDE.md — MayoChord 开发约定与实测记录

> 每次开发会话开始前先读 `MAYOCHORD_SPEC.md`（需求与设计依据）和本文件。规格变化时先改规格，再改代码。
> 本文件在每个里程碑结束时更新。

## 当前进度

| 里程碑 | 状态 |
|---|---|
| M0 骨架与真机验证 | 完成（commit a790c25） |
| M1 核心与数据层 | 完成（commit da0e0ab；用户采纳就近转位的推荐键位） |
| M2 学习系统核心 | 完成（用户确认） |
| M3–M6 | 未开始 |

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

- **工作方式**：每个里程碑结束停下，列出需要在琴上/浏览器里测试的内容；用户确认后再 commit。只 commit 不 push，除非用户要求。
- **JUNO-D7 相关行为不要猜**：只根据用户在琴上实测、导出的数据实现，并记录到本文件「JUNO-D7 实测行为」。
- **依赖**：安装前用 `npm view <pkg> version license time` 核对版本、许可证（只接受 MIT/Apache/BSD/ISC 等宽松许可证；字体可接受 OFL-1.1），`package.json` 写精确版本。pnpm 12 默认有 `minimumReleaseAge`（约 1 天），刚发布的版本会被拒绝：选更早的稳定版，**不要**往 `pnpm-workspace.yaml` 加 `minimumReleaseAgeExclude`。
- **TypeScript**：strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`。禁止 `any`（Biome `noExplicitAny: error`）；确需时用 `biome-ignore` 写明原因。
- **core 包**（`packages/core`）：纯 TypeScript，不依赖 React 和浏览器 API（tsconfig 的 `lib` 不含 DOM 来强制）。判定、评分、调度、时间分析都写成纯函数并测试。
- **内部包不预构建**：`exports` 直接指向 `src/*.ts`，由 Vite/Vitest 编译。
- **i18n**：界面文字放在 `apps/web/src/i18n/locales/`，默认 `zh-CN`，通过 `t()` 使用。`/design` 页面是开发用的组件展示页，说明文字不进 i18n。
- **shadcn/ui 组件**在 `apps/web/src/design/ui/`。用 CLI 添加后要做两件事：把 `from "cn"` 改成 `from "@/lib/utils"`（CLI 在 monorepo 里解析别名有误），并检查 CLI 有没有往 `package.json` 加一个无用的 `cn` 依赖（M0 时加过，M2 已删除）；删除 `dark:` 变体并把 `accent` 悬停色改为 `surface-2`（见下方设计系统）。
- **路由**：TanStack Router 文件路由（`apps/web/src/routes/`），`routeTree.gen.ts` 由插件生成并提交到仓库。
- **GitHub Pages**：browser history + 构建时把 `index.html` 复制为 `404.html`（`vite.config.ts` 的 `spaFallback` 插件）。`base` 默认 `/mayochord/`，可用环境变量 `MAYOCHORD_BASE` 覆盖。
- **localStorage** 只存外观设置（`mayochord.appearance`，首屏脚本在 `index.html` 读取以避免闪烁）。业务数据一律走 Dexie。
- **音乐理论自行实现**（规格第 3 节已改）：Tonal 自 2026-09-28 起各子包发布入口错误，已移除。不要再引入 Tonal。
- **拼写**：音名一律保留拼写（'Bb4' 不写成 'A#4'），由字母+度数推出（`spellInterval`）。显示时用 `prettyAccidentals` 换成 ♭ ♯。
- **和弦 ID**（URL 安全）：`chordSlug(root, quality, bass)`，例如 gm7、fmaj7、c7-9、bb、fsm7b5、c-on-e。内容包校验会检查 ID 与和弦一致。
- **大文件懒加载**：Tone.js 与钢琴采样在第一次发声时加载（`audio/piano.ts`）；VexFlow 在第一次显示五线谱时加载（`design/staff`）。不要在首屏代码里静态 import 它们。
- **在 Git Bash 里用 Python 改文件**：写文件时加 `newline='
'`，否则在 Windows 上会写成 CRLF。长脚本先写到临时文件再执行（直接放在 heredoc 里，bash 可能解析失败）。

## 目录结构

```
packages/core/src/
  input/        InputEvent、MIDI 解析、DeviceProfile 类型；merge.ts 跨通道/跨输入源合并、整体移调
  theory/       音名解析与拼写（spellInterval）、和弦性质表、和弦符号解析/格式化/ID、级数（key.ts）
  voicing/      Voicing 类型、声部进行配对、就近转位搜索、右手转位描述
  recognition/  按住音、自由识别、判定（judgeNotes、findUniformShift）、和弦尝试检测（AttemptTracker）
  log/          ReviewLog 类型（作答日志）
  drill/        卡片（cards.ts）、一道题的判定流程（trial.ts，纯函数）、Drill 接口与注册表（drill.ts）
  grading/      自动评分、个人反应时间中位数
  scheduler/    FSRS 封装（memory.ts）、卡片进度与新卡三阶段（progress.ts）、练习内出题顺序（session.ts）、
                85% 自适应（adaptive.ts）、轮次总结（summary.ts）
  strategy/     调度策略对象：各项参数集中在这里（createDefaultStrategy）
  （M3 起：graph/；M4 起：timing/）
packages/content/src/
  schema/       Zod：内容包（含跨字段校验）、设备配置
  packs/        内置内容包 mayochord-core.json（第 11 节）
  devices/      设备配置 JSON（JUNO-D7、通用 88 键）
  load.ts       校验 + 加载成 LoadedPack（ChordEntry、ProgressionEntry）
apps/web/src/
  app/          bootstrap.ts：启动时连接输入源、汇流、实时输入、音源、存储、校准
  routes/       /、/practice、/practice/session（专注模式）、/chords、/chords/$chordId、/monitor、/settings、/design
  features/     shell、today、practice（练习入口、专注模式、轮次总结、PracticeController）、
                chords（和弦库、详情、试弹）、midi（设备面板）、monitor、settings、design-gallery
  input/        webmidi.ts、hub.ts（输入汇流）、live.ts（实时按住音 + 和弦尝试）、calibration.ts、
                computer-keyboard.ts、PlayableKeyboard.tsx（屏幕键盘）
  audio/        piano.ts（Tone.js + Salamander 采样，懒加载）、live-sound.ts、feedback-sound.ts（答对/答错提示音）
  storage/      Dexie 数据库 db.ts、仓储接口与实现 repositories.ts
  design/       tokens.css、ui/（shadcn）、keyboard/、staff/（VexFlow，懒加载）、ChordName、Wordmark
  stores/       Zustand：appearance、settings
apps/web/public/samples/salamander/   钢琴采样（CC-BY 3.0，见 NOTICE）
apps/web/e2e/   Playwright；fake-midi.ts 注入假的 navigator.requestMIDIAccess
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

`{ id, version(semver), schemaVersion, name, chords: [{ id, root, quality, bass? }], voicings: [{ id, chordId, reference, status, notes: [{ pitch, hand, finger? }], note? }], progressions: [{ id, name, key, steps: [{ chordId, voicingId, beats }], description? }] }`
校验规则：ID 唯一且符合 chordSlug；键位的音必须是和弦音且拼写正确；除可省略的五音外不能缺和弦音；每个和弦恰好一个参考键位；进行引用的和弦、键位存在且对应。

### 本地数据库（Dexie，`MayoChordDB`，当前 version 1）

| 表 | 主键 / 索引 | 说明 |
|---|---|---|
| reviewLogs | `++seq, &id, ts, cardId, sessionId, [cardId+ts]` | 作答日志，只追加（仓储接口不提供修改、删除） |
| settings | `key` | 'app' → AppSettings（Zod 校验，每个字段损坏时单独回退默认值） |
| calibrations | `deviceKey` | 每个 MIDI 设备的音高偏移、实测音域 |
| cardStates | `cardId, due` | `{ cardId, due, progress: CardProgress }`。**缓存**，可由 reviewLogs 重放重建（`replayProgress`）。新卡 due = `Number.MAX_SAFE_INTEGER` |
| sessions | `id, startedAt` | 每轮练习：`{ id, startedAt, endedAt, kind: 'practice', config, summary }` |
| userPacks | `id` | 用户导入的内容包（M6） |

settings 表另有键 `'adaptive'`：`{ 'name-to-chord' | 'transition': { timeLimitMs, sinceAdjust } }`（85% 规则的当前时限）。
M2 没有改表结构（新字段都不是索引），仍是 version 1。

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
- 齐整度 `spreadMs` 只算这次新按下的音（从上一个和弦保持下来的共同音不算）；`together = spreadMs <= onsetWindowMs`（默认 80）。
- 两个阈值和踏板选项都在设置页可调。屏幕键盘、电脑键盘的齐整度没有意义，界面上不显示。

### 判定（`judgeNotes`）

- 宽松 loose：比较音级集合，忽略八度和转位；多按 = 按住音中不在目标音级里的；少按 = 参考键位中音级没被按到的（标在参考键位的位置上）。
- 严格 strict：与参考键位逐音一致。
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

