---
type: readme
title: 给 AI 的说明书
version: 1
---

# 给 AI 的说明书

你正在阅读的是一个人的**个人上下文库（vault）**。这里持续记录了他/她的学习、工作、健康、计划和想法，目的是让任何 AI 都能真正了解他/她的处境，并在此基础上提供有连续性的帮助。

## 阅读顺序（按优先级）

1. `now.md`：**当前处境快照**，最重要，代表"此刻的我"。
2. `profile/`：稳定的个人档案（身份、背景、价值观）。
3. `memory/preferences.md`：希望 AI 如何与自己沟通、如何做事。**必须遵守。**
4. `memory/facts/*.md`：系统整理的事实记忆。只看 `status: active` 的条目；`superseded` / `invalid` 是历史，可用来理解变化轨迹。
5. `domains/*.md`：各领域（学习 / 工作 / 健康 / 财务 / 关系 / 生活）的长期档案。
6. `plans/*.md`：目标与计划，`status` 为 todo / doing / done / dropped。
7. `reviews/`：周 / 月复盘，是对日记的压缩总结。
8. `journal/YYYY/MM/YYYY-MM-DD.md`：每日原始记录，需要细节时再查。
9. `sessions/`：与 AI 的历史对话记录。
10. `skills/*/SKILL.md`：特定场景（学习教练、健康、规划、复盘）的做事方法。

信息冲突时：**越新越可信**，`now.md` 优先于旧日记，`active` 事实优先于旧描述。

## 文件格式约定

- 每个文件开头是 YAML frontmatter，`type` 字段说明文件类型。
- 日记 frontmatter 中的数字是可统计的指标：
  - `mood`、`energy`：1–5 分
  - `sleep`：小时
  - `study_min` / `work_min` / `exercise_min`：分钟
  - `weight`：kg
- `private: true` 的文件属于隐私内容，不要在回答中主动引用原文。
- 日期格式统一 `YYYY-MM-DD`，时区默认 Asia/Shanghai。

## 你应该怎样帮助我

- 先结合 `now.md` 和相关领域档案理解背景，再回答；不要给脱离我处境的泛泛建议。
- 发现我的状态有明显变化（睡眠持续变差、计划长期停滞、目标改变）时，主动指出。
- 建议要具体、可执行，最好能落到 `plans/` 里的某个计划上。
- 不确定的事先问，不要编造关于我的事实。

## 如果你能写入这个文件夹

- 新的日记追加到当天的 `journal/` 文件里，不要覆盖已有内容。
- 更新 `now.md` 时只改相关小节，并更新 `updated` 日期。
- 新发现的关于我的事实，写进 `memory/facts/<领域>.md` 的 `facts` 列表：
  - 必填：`id`、`text`、`status`、`valid_from`、`source`
  - 旧事实不要删除，把 `status` 改为 `superseded` 并填写 `valid_to`
- 保持 Markdown + frontmatter 格式，方便人和其他 AI 继续使用。
