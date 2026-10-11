import { readNote, P } from "../vault/fs";
import { listFacts, search } from "../index/search";
import { listPlans } from "../vault/services";
import { listDomains } from "../vault/domains";
import { listSkills, matchSkills, readSkill } from "./skills";
import { estimateTokens, truncateTokens, nowLocal } from "../core/util";
import type { Settings } from "../core/settings";

const AGENT_RULES = `你是用户的个人搭档，运行在用户本机的 Life OS 中。你可以查阅并更新用户的档案、日记、计划和记忆，帮助用户记录生活、理清处境、推进计划。

## 工作原则
1. **先了解再回答**：凡是涉及用户自身情况的问题，先结合下面的档案；不够时用 search_memory / read_note / query_metrics / list_plans 查证，不要凭空假设。
2. **具体、贴合处境**：给出符合用户当前处境、能落地的建议，避免泛泛而谈。
3. **主动关注变化**：注意到状态变化（睡眠变差、计划停滞、目标改变）时主动指出。
4. **写入要克制**：
   - 只在用户明确表达意图，或内容明显值得记录时，才使用写入工具（append_journal / update_now / update_domain / upsert_plan）。这些工具需要用户确认才会执行。
   - 关于用户的新事实（处境、目标、偏好、健康等变化）用 propose_memory 提交到审核箱。
5. **技能**：遇到下方技能列表中的场景，先用 load_skill 加载对应方法再执行（已自动激活的技能无需再加载）。
6. **隐私**：标记为 private 的内容不在回答中主动复述原文。
7. 默认用中文，简洁直接，先给结论；需要时使用 Markdown。`;

function section(title: string, content: string | undefined | null) {
  const c = (content ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return c ? `\n\n<${title}>\n${c}\n</${title}>` : "";
}

function noteBody(rel: string, allowPrivate: boolean) {
  const n = readNote(rel);
  if (!n) return "";
  if (n.fm.private === true && !allowPrivate) return "";
  return n.body;
}

/**
 * 系统提示：按"稳定 → 较稳定"的顺序排列，最大化模型服务商的前缀缓存命中。
 * 每轮变化的检索结果不放这里，而是附在用户消息上。
 */
export function buildSystemPrompt(settings: Settings, allowPrivate: boolean) {
  const budget = settings.agent.contextBudgetTokens;
  const t = nowLocal(settings.user.timezone);
  const parts: string[] = [AGENT_RULES];

  parts.push(section("vault_readme", truncateTokens(noteBody(P.readme, true), Math.floor(budget * 0.08))));
  parts.push(section("user_preferences", truncateTokens(noteBody(P.preferences, true), Math.floor(budget * 0.06))));
  const profile = ["profile/identity.md", "profile/background.md"].map((p) => noteBody(p, allowPrivate)).join("\n\n");
  parts.push(section("profile", truncateTokens(profile, Math.floor(budget * 0.15))));

  parts.push(section("domains", listDomains().map((d) => `- ${d.key}：${d.label}${d.description ? `（${d.description}）` : ""}`).join("\n")));

  const skills = listSkills();
  if (skills.length) parts.push(section("skills", skills.map((s) => `- ${s.name}：${s.title}，${s.description}`).join("\n")));

  // 以下内容变化较频繁
  parts.push(section("now", truncateTokens(noteBody(P.now, allowPrivate), Math.floor(budget * 0.12))));

  const facts = listFacts({ status: "active" }).filter((f) => allowPrivate || f.domain !== "finance");
  if (facts.length) {
    let used = 0;
    const lines: string[] = [];
    for (const f of facts) {
      const line = `- [${f.id}] (${f.domain}) ${f.text}`;
      used += estimateTokens(line);
      if (used > budget * 0.15) break;
      lines.push(line);
    }
    parts.push(section("known_facts", lines.join("\n")));
  }

  const plans = listPlans().filter((p) => p.status === "doing" || (p.status === "todo" && p.priority === "high"));
  if (plans.length) parts.push(section("active_plans", plans.map((p) => `- [${p.status}] ${p.title}（slug: ${p.slug}，进度 ${p.progress}%${p.due ? `，截止 ${p.due}` : ""}）`).join("\n")));

  parts.push(`\n\n当前时间：${t.date} 星期${"日一二三四五六"[t.weekday]} ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}（${settings.user.timezone}）`);
  if (settings.user.name) parts.push(`\n用户称呼：${settings.user.name}`);
  return parts.join("");
}

/** 每轮附加到用户消息的上下文：自动检索 + 自动激活的技能 */
export async function buildTurnContext(userText: string, settings: Settings, allowPrivate: boolean) {
  const budget = settings.agent.contextBudgetTokens;
  const hits = await search(userText, { limit: 6, includePrivate: allowPrivate }).catch(() => []);
  const relevant = hits.filter((h) => !["now", "preferences", "readme", "skill"].includes(h.type));
  let ctx = "";
  if (relevant.length) {
    const lines = relevant.map((h, i) => `[${i + 1}] ${h.path}${h.date ? `（${h.date}）` : ""}\n${h.snippet}`);
    ctx += `<retrieved_context>\n以下是系统根据本条消息自动检索到的资料，可能不完整；需要更多细节请调用工具。\n\n${truncateTokens(lines.join("\n\n"), Math.floor(budget * 0.2))}\n</retrieved_context>\n\n`;
  }
  const skills = matchSkills(userText);
  for (const s of skills) {
    const full = readSkill(s.name);
    if (full) ctx += `<active_skill name="${s.name}">\n${full.instructions}\n</active_skill>\n\n`;
  }
  return {
    content: ctx ? `${ctx}<user_message>\n${userText}\n</user_message>` : userText,
    retrieved: relevant.map((h) => ({ path: h.path, title: h.title, date: h.date })),
    skills: skills.map((s) => s.name),
  };
}
