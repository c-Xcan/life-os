import { readNote } from "./fs";
import { domainLabels } from "./domains";

/** 把写入原因 / 提交信息翻译成中文描述（旧的英文提交也能显示成中文；已是中文的原样返回） */
const ACTOR: Record<string, string> = { user: "我", agent: "搭档", system: "系统" };

function planTitle(slug: string) {
  try { const t = readNote(`plans/${slug}.md`)?.fm.title; return typeof t === "string" ? t : slug; } catch { return slug; }
}

export function friendlyPath(p: string): string {
  const labels = (() => { try { return domainLabels(); } catch { return {} as Record<string, string>; } })();
  const fixed: Record<string, string> = {
    "now.md": "当前处境", "profile/identity.md": "我是谁", "profile/background.md": "经历",
    "memory/preferences.md": "搭档偏好", "README.ai.md": "给 AI 的说明",
  };
  if (fixed[p]) return fixed[p];
  let m: RegExpExecArray | null;
  if ((m = /^domains\/(.+)\.md$/.exec(p))) return `领域档案·${labels[m[1]] ?? m[1]}`;
  if ((m = /^memory\/facts\/(.+)\.md$/.exec(p))) return `事实记忆·${labels[m[1]] ?? m[1]}`;
  if ((m = /^plans\/(.+)\.md$/.exec(p))) return `计划「${planTitle(m[1])}」`;
  if ((m = /^journal\/.*?(\d{4}-\d{2}-\d{2})\.md$/.exec(p))) return `${m[1]} 的日记`;
  if ((m = /^reviews\/weekly\/(.+)\.md$/.exec(p))) return `周复盘 ${m[1]}`;
  if ((m = /^reviews\/monthly\/(.+)\.md$/.exec(p))) return `月复盘 ${m[1]}`;
  if (p.startsWith("sessions/")) return "对话记录";
  if (p.startsWith("exports/")) return "导出文件";
  return p.replace(/\.md$/, "");
}

/** 单条原因（不含操作者前缀） */
function describeReason(r: string): string {
  const labels = (() => { try { return domainLabels(); } catch { return {} as Record<string, string>; } })();
  let m: RegExpExecArray | null;
  if (r === "init vault") return "初始化资料库";
  if (r === "export context pack") return "导出上下文包";
  if ((m = /^journal (\S+): append$/.exec(r))) return `补充 ${m[1]} 的日记`;
  if ((m = /^journal (\S+)$/.exec(r))) return `写 ${m[1]} 的日记`;
  if ((m = /^plan (\S+)$/.exec(r))) return `更新计划「${planTitle(m[1])}」`;
  if ((m = /^session (\S+)$/.exec(r))) return "保存对话记录";
  if ((m = /^memory: (.+)$/.exec(r))) return `采纳记忆：${m[1]}`;
  if ((m = /^memory (\S+)$/.exec(r))) return `更新事实记忆·${labels[m[1]] ?? m[1]}`;
  if ((m = /^invalidate (\S+)$/.exec(r))) return "作废一条记忆";
  if ((m = /^review: (.+)$/.exec(r))) return `采纳更新建议：${m[1]}`;
  if ((m = /^review (\S+) \(draft\)$/.exec(r))) return `生成周复盘草稿 ${m[1]}`;
  if (r === "review final") return "复盘定稿";
  if (r === "review draft") return "复盘改回草稿";
  if ((m = /^create domain (\S+)$/.exec(r))) return `新增领域「${labels[m[1]] ?? m[1]}」`;
  if ((m = /^delete domain (\S+)$/.exec(r))) return `删除领域「${m[1]}」`;
  if ((m = /^edit (.+)$/.exec(r))) return `编辑${friendlyPath(m[1])}`;
  if ((m = /^update (.+)$/.exec(r))) return `更新${friendlyPath(m[1])}`;
  if ((m = /^delete (.+)$/.exec(r))) return `删除${friendlyPath(m[1])}`;
  if ((m = /^restore (.+)$/.exec(r))) return `恢复${friendlyPath(m[1])}`;
  if ((m = /^remove photos from (.+)$/.exec(r))) return `从 ${m[1].replace(/\.md$/, "")} 的日记里移除照片`;
  if ((m = /^(.+\.md) › (.+)$/.exec(r))) return `更新${friendlyPath(m[1])}·${m[2]}`;
  return r;
}

/** "user: plan xxx" → "我 · 更新计划「…」" */
export function describeCommit(subject: string): string {
  const s = subject.trim();
  let m: RegExpExecArray | null;
  if ((m = /^(\d+) changes$/.exec(s))) return `${m[1]} 处修改`;
  if ((m = /^(user|agent|system): (.+)$/.exec(s))) return `${ACTOR[m[1]]} · ${describeReason(m[2])}`;
  return describeReason(s);
}
