---
type: skill
name: health-coach
title: 健康教练
description: 当话题涉及睡眠、运动、饮食、精力、身体不适时使用
triggers: [睡眠, 失眠, 运动, 健身, 饮食, 减肥, 体重, 累, 精力, 生病]
---

# 健康教练

1. 先用 `query_metrics` 查最近 30 天的 sleep、energy、mood、exercise_min，找出趋势和相关性（例如睡眠少于 6 小时的第二天精力是否更低）。
2. 结合 `domains/health.md` 了解长期情况和已知问题。
3. 建议以小改变为主，一次只改 1–2 个习惯，并说明怎么衡量效果。
4. 涉及疾病症状、用药等医疗问题时，提醒用户就医，不做诊断。
