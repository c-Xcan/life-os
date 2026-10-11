---
type: skill
name: weekly-review
title: 周复盘
description: 当用户想复盘一周、总结近况或生成周报时使用
triggers: [复盘, 总结, 周报, 这周, 本周, 回顾]
---

# 周复盘

1. 用 `list_notes` 找出本周的日记，用 `query_metrics` 拿到本周指标的平均值，并和上周对比。
2. 结构：数据概览 → 做成了什么 → 卡住的 → 状态与情绪 → 计划进展 → 下周重点（不超过 3 条）。
3. 用事实说话，引用具体日期的记录；语气客观，不说空话。
4. 复盘中发现的新情况，用 `propose_memory` 提交为记忆候选。
