# 学习原理与参考资料

MayoChord 的每个功能都对应一条有研究支持的学习原理。这里列出原理、在应用里的做法和参考资料。

## 间隔重复与 FSRS

**原理**：在快要忘记的时候复习，记忆保持得最久，花的时间最少（间隔效应，Ebbinghaus 以来反复验证）。FSRS 用记忆的稳定性、难度和可提取性建模，按目标保持率（这里是 90%）安排下一次复习。

**做法**：每张卡（例如"看 Am 弹 Am"、"从 C 换到 G"）有自己的 FSRS 状态。成绩由 MIDI 测量自动得出，不用自评；同一天只用第一次作答更新记忆。主题也有自己的记忆状态，决定什么时候进入每日复习。

- Ye, J., Su, J., & Cao, Y. (2022). A stochastic shortest path algorithm for optimizing spaced repetition scheduling. *KDD 2022*.
- Cepeda, N. J., et al. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin*, 132(3).
- open-spaced-repetition/ts-fsrs（本项目使用的实现）。

## 知识图谱与隐式重复（Math Academy）

**原理**：把内容拆成有先修关系的小主题，掌握了前面的才学后面的；高层主题的练习里本来就包含低层技能，所以复习高层主题时可以给低层主题"隐式"的复习信用，减少重复练习。

**做法**：30 个主题组成图谱（先修 + 包含关系与权重）。复习成功时，信用沿包含关系向下传递（按权重相乘、早到打折）；失败时，负信用向上传递。每日编排优先选能顺带覆盖其他到期主题的复习。

- Skycak, J. (2024). *The Math Academy Way: Using the Power of Science to Supercharge Student Learning*.

## 提取练习（先回忆后提示）

**原理**：主动从记忆里提取比反复看答案记得牢（测试效应）。

**做法**：练习时默认不显示键位，答错或超时后才显示，并标出多按、少按的音。第一次见到的卡先示范一次。掌握检查和测验不能看提示。

- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science*, 17(3).

## 交错练习（情境干扰效应）

**原理**：把不同类型的题混在一起练，当下表现差一些，但长期保持和迁移更好。

**做法**：新卡集中练几次后按顺序出现，熟悉后随机打乱；每日复习把 2–3 个主题的卡交错排列；测验覆盖最近学过的多个主题。

- Shea, J. B., & Morgan, R. L. (1979). Contextual interference effects on the acquisition, retention, and transfer of a motor skill. *Journal of Experimental Psychology: Human Learning and Memory*, 5(2).
- Rohrer, D., & Taylor, K. (2007). The shuffling of mathematics problems improves learning. *Instructional Science*, 35.

## 避免相似干扰、对比配对

**原理**：相似的内容同时学容易互相干扰；分开建立之后，再专门对比区分。

**做法**：同一干扰组（例如 M7 与 7）的新主题不在同一天引入；两者都掌握后，"对比配对"主题专门练只差一个音的和弦（C/Cm、C7/CM7、Am7/Am7♭5），答完说明差在哪个音。

## 85% 规则

**原理**：对于用梯度学习的系统，错误率约 15.87% 时学习最快；直觉上就是"有点难但大多能做到"。

**做法**：每种练习有自己的时限，最近 20 题正确率高于 90% 时收紧，低于 75% 时放宽；跟拍练习结束后按同样的规则建议下次的速度。

- Wilson, R. C., Shenhav, A., Straccia, M., & Cohen, J. D. (2019). The Eighty Five Percent Rule for optimal learning. *Nature Communications*, 10, 4646.

## 图式理论（变化练习）

**原理**：在变化的条件下练习，形成更通用的"图式"，更容易迁移到新情境。

**做法**：同一个和弦以不同题面出现（和弦名、文字名称、级数、五线谱、声音），在不同调里构建，在不同进行里切换；宽松判定允许任意转位。

- Schmidt, R. A. (1975). A schema theory of discrete motor skill learning. *Psychological Review*, 82(4).

## 调性层级（Krumhansl）

**原理**：听者是在调性语境里感知和弦的：同一个和弦在不同调里功能不同、听感不同。

**做法**：听辨先播放终止式（I–IV–V–I）确立调性，再播放目标和弦，回答的是级数（功能），而不是孤立的和弦名。

- Krumhansl, C. L., & Kessler, E. J. (1982). Tracing the dynamic changes in perceived tonal organization in a spatial representation of musical keys. *Psychological Review*, 89(4).
- Krumhansl, C. L. (1990). *Cognitive Foundations of Musical Pitch*. Oxford University Press.

## 预期理论（Huron）

**原理**：音乐理解很大程度上是预测接下来会发生什么；熟悉的进行模式让预测变快、变准。

**做法**：练常见进行（王道进行、丸サ進行、II–V–I）的切换与跟拍，而不只是孤立的和弦；进行练习器总是显示"下一个"和弦，训练提前准备。以后的"预测下一个和弦"练习也基于这一点。

- Huron, D. (2006). *Sweet Anticipation: Music and the Psychology of Expectation*. MIT Press.

## 反馈的指导假说（反馈逐渐减少）

**原理**：练习时反馈太多、太及时，学习者会依赖反馈，撤掉后表现下降；随着熟练度提高应逐渐减少反馈。

**做法**：卡片进入随机阶段后，判定前不再显示按下的键；很熟练（稳定性 ≥ 7 天）且连着 MIDI 时，判定前连键盘图也收起来。跟拍练习可以隐藏键位，显示键位时成绩最多记为"有点吃力"。

- Salmoni, A. W., Schmidt, R. A., & Walter, C. B. (1984). Knowledge of results and motor learning: A review and critical reappraisal. *Psychological Bulletin*, 95(3).

## 动作技能的客观测量

**原理**：键盘技能不只是"知道哪些音"，还包括同时落下、跟住拍子。能测量的才好改进。

**做法**：MIDI 时间戳测量反应时间、齐整度（和弦里最早和最晚按下的音之差）和相对拍点的偏差（扣除延迟校准）；统计页显示反应时间曲线、切换热力图和节拍偏差分布，告诉你先练哪里。
