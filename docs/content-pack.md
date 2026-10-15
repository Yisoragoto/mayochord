# 内容包格式

内容包是一个 JSON 文件，包含和弦、键位、进行和知识图谱的主题（含课程）。内置内容包在 `packages/content/src/packs/mayochord-core.json`，加载时用 Zod 校验（`packages/content/src/schema/pack.ts`），校验失败会给出中文说明和出错的位置。

```json
{
  "id": "mayochord-core",
  "version": "0.5.0",
  "schemaVersion": 1,
  "name": { "zh-CN": "MayoChord 内置内容", "en": "MayoChord built-in content" },
  "chords": [],
  "voicings": [],
  "progressions": [],
  "topics": []
}
```

- `version`：semver。作答日志里会记下内容包版本（`contentVersion`），以后内容变化时可以迁移。
- `schemaVersion`：格式版本，当前为 1。新增可选字段时不升版本。
- 所有给人看的文字都是多语言对象：`{ "zh-CN": "…", "en": "…", "ja": "…" }`，`zh-CN` 必须有，其他可选（界面语言没有翻译时用中文）。

## 和弦 `chords`

```json
{ "id": "c-on-e", "root": "C", "quality": "maj", "bass": "E" }
```

- `id` 必须等于 `chordSlug(root, quality, bass)`：小写根音 + 升降（`s` / `b`）+ 性质 + `-on-` 低音，例如 `gm7`、`fmaj7`、`c7-9`、`bb`、`fsm7b5`、`c-on-e`。
- `quality`：`maj m dim aug sus2 sus4 6 m6 M7 7 m7 m7b5 dim7 mM7 add9 madd9 7(9) M7(9) m7(9)`。
- 音名保留拼写（`Bb`、`F#`），显示时换成 ♭ ♯。

## 键位 `voicings`

```json
{
  "id": "am7-ref",
  "chordId": "am7",
  "reference": true,
  "status": "confirmed",
  "notes": [
    { "pitch": "A3", "hand": "left", "finger": 5 },
    { "pitch": "G4", "hand": "right", "finger": 1 },
    { "pitch": "C5", "hand": "right", "finger": 3 },
    { "pitch": "E5", "hand": "right", "finger": 5 }
  ]
}
```

- 每个音必须是和弦音、拼写正确；除了可以省略的五音（七和弦、九和弦）外不能缺和弦音。
- 给了键位的和弦必须恰好有一个 `reference: true` 的参考键位。
- 没有给键位的和弦，加载时按公式自动生成参考键位（左手根音 C3–B3，右手从根音开始密集排列，`status: "generated"`）。
- `status`：`confirmed`（已确认）、`tentative`（待确认，和弦库里单独标出）、`generated`（自动生成）。

## 进行 `progressions`

```json
{
  "id": "c-g-am-f-push",
  "name": { "zh-CN": "C – G – Am – F（16 分音符先行）" },
  "key": "C",
  "steps": [{ "chordId": "c", "voicingId": "c-ref", "beats": 4, "anticipation": 1 }]
}
```

- `beats`：这个和弦占几拍（跟拍练习用）。
- `anticipation`：提前几个 16 分音符换到这个和弦（0–3，默认 0），用于先行切分。

## 主题 `topics`

```json
{
  "id": "thirds",
  "title": { "zh-CN": "大三度与小三度" },
  "summary": { "zh-CN": "大三度 = 4 个半音，小三度 = 3 个半音。" },
  "prerequisites": ["half-whole-steps"],
  "encompasses": [{ "topicId": "half-whole-steps", "weight": 0.6 }],
  "interferenceGroup": "triad-quality",
  "practice": { "kind": "intervals", "items": [{ "root": "C", "interval": "M3" }] },
  "lesson": {
    "explain": [{ "text": { "zh-CN": "…" }, "demo": { "notes": ["C4", "E4"], "labels": "semitones" } }],
    "guided": { "count": 6 },
    "independent": { "requiredCorrect": 8 },
    "mastery": { "questions": 8, "minAccuracy": 0.85, "timeLimitMs": 6000 },
    "minutes": 7
  }
}
```

- `prerequisites`：先修主题（解锁用）。图谱不能有环。
- `encompasses`：包含关系与权重 0–1（隐式重复：练这个主题时，被包含的主题按权重得到部分复习信用）。
- `interferenceGroup`：同组的新主题不在同一天引入（例如 M7 与 7）。

### 练习内容 `practice`

| kind | 字段 | 生成的卡片 |
|---|---|---|
| `notes` | `notes: ["C", "D", …]` | 认音名 |
| `intervals` | `items: [{ root, interval: m2/M2/m3/M3/P4/P5 }]` | 音程（最低音必须是根音） |
| `chords` | `chords`, `voicingMode: any/reference`, `cue`, `key` | 和弦卡。`cue`：`name`（和弦名）、`spelled`（文字名称）、`audio`（听声音，给了 `key` 就先播放终止式）、`staff`（五线谱）、`roman`（级数，必须有 `key`） |
| `transitions` | `progressions`, `voicingMode` | 进行里相邻和弦的切换卡（循环） |
| `contrast` | `pairs: [["c7", "cmaj7"], …]` | 对比配对：听声音，从一对里选 |
| `progression` | `progression`, `bpm`, `beatsPerChord?`, `voicingMode` | 跟拍主题：课程各阶段都是跟着节拍器弹这条进行；每日复习用它的切换卡 |

### 课程 `lesson`

- `explain`：讲解的每一步。`demo` 可以标出音（`notes`，带八度）或示范一个和弦（`chord`）；`labels`：`semitones`（数半音）/ `fingers`（指法）/ `none`；`play`：`together` / `arpeggio` / `cadence`（配合 `key`，先弹终止式）/ `none`；`show`：`keyboard` / `staff` / `both`。
- `guided.count`：引导练习的题数（每题显示键位）。
- `independent.requiredCorrect`：独立练习首次答对多少题完成（跟拍主题：干净地弹对多少个和弦）。
- `mastery`：掌握检查的题数、正确率门槛、每题时限（跟拍主题：和弦数与干净率门槛，不用时限）。
- `minutes`：预计时长，每日任务编排用。

## 用户自己的内容包

用户自己做的曲目拆解作为本地内容包导入，只存在浏览器里，不提交到仓库（`local-packs/` 已加入 `.gitignore`）。

导入的乐谱（M7 曲谱跟弹）不是内容包：MusicXML / MIDI 文件直接存进本地乐谱库（IndexedDB 的 `scores` 表），同样只在浏览器里，不进仓库。
