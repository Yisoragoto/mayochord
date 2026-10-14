# CLAUDE.md — MayoChord 开发约定与实测记录

> 每次开发会话开始前先读 `MAYOCHORD_SPEC.md`（需求与设计依据）和本文件。规格变化时先改规格，再改代码。
> 本文件在每个里程碑结束时更新。

## 当前进度

| 里程碑 | 状态 |
|---|---|
| M0 骨架与真机验证 | 完成：视觉方向选定（真夜中），JUNO-D7 已实测两次。OCTAVE/TRANSPOSE 偏移规律、踏板（暂无）留待 M1 |
| M1–M6 | 未开始 |

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
- **shadcn/ui 组件**在 `apps/web/src/design/ui/`。用 CLI 添加后要做两件事：把 `from "cn"` 改成 `from "@/lib/utils"`（CLI 在 monorepo 里解析别名有误）；删除 `dark:` 变体并把 `accent` 悬停色改为 `surface-2`（见下方设计系统）。
- **路由**：TanStack Router 文件路由（`apps/web/src/routes/`），`routeTree.gen.ts` 由插件生成并提交到仓库。
- **GitHub Pages**：browser history + 构建时把 `index.html` 复制为 `404.html`（`vite.config.ts` 的 `spaFallback` 插件）。`base` 默认 `/mayochord/`，可用环境变量 `MAYOCHORD_BASE` 覆盖。
- **localStorage** 只存外观设置（`mayochord.appearance`，首屏脚本在 `index.html` 读取以避免闪烁）。业务数据一律走 Dexie（M1 起）。

## 目录结构

```
packages/core/src/
  input/        InputEvent 类型、MIDI 字节解析 parseMidiMessage、DeviceProfile 类型
  theory/       音名↔MIDI、和弦性质表 CHORD_QUALITIES、和弦符号格式化
  recognition/  按住音状态机 applyHeldEvent、自由识别 identifyChord
  （M1 起：voicing/ timing/ graph/ scheduler/ grading/ drill/ strategy/）
packages/content/src/
  devices.ts    内置 DeviceProfile（JUNO-D7、通用 88 键）
  （M1 起：Zod schema、内置内容包）
apps/web/src/
  routes/       页面路由（/、/monitor、/design）
  features/     页面级模块：shell、today、monitor、design-gallery
  input/        输入源适配器：webmidi.ts（WebMidiService 单例 + useMidi store）
  design/       tokens.css、ui/（shadcn）、keyboard/Keyboard、ChordName、Wordmark
  stores/       Zustand：appearance
  i18n/         i18next 初始化与语言资源
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

### 按住音（`recognition/held-notes.ts`）

- 状态记录每个按住音的按下时间、力度、通道和 `sustained` 标记（手指已松开、因踏板仍在发声）。
- 是否把 `sustained` 的音算作"按住"由查询参数 `sustainCountsAsHeld` 决定（设置项，默认 false）。

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

### 练习判定（M1 实现，规格第 8 节）

- 所有目标音在约 80 ms 窗口内按下、并保持稳定约 150 ms，判定为"弹出一个和弦"。阈值可调。
- 宽松模式比较音级集合；严格模式与参考键位逐音一致。给出多按、少按的音。

## 调度规则

M2 起记录（FSRS、自动评分、隐式重复等）。

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

