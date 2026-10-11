import { listMarkdown, readNote } from "../vault/fs";

export interface SkillMeta { name: string; title: string; description: string; triggers: string[]; path: string }

/** 技能 = 程序记忆：vault/skills/<name>/SKILL.md，用户可以自己增删改 */
export function listSkills(): SkillMeta[] {
  return listMarkdown("skills")
    .filter((p) => p.endsWith("/SKILL.md"))
    .map((p) => {
      const n = readNote(p);
      if (!n) return null;
      const name = String(n.fm.name ?? p.split("/")[1]);
      return {
        name,
        title: String(n.fm.title ?? name),
        description: String(n.fm.description ?? ""),
        triggers: Array.isArray(n.fm.triggers) ? n.fm.triggers.map(String) : [],
        path: p,
      };
    })
    .filter((x): x is SkillMeta => !!x);
}

export function readSkill(name: string) {
  const s = listSkills().find((x) => x.name === name);
  if (!s) return null;
  const n = readNote(s.path)!;
  return { name: s.name, title: s.title, instructions: n.body.trim() };
}

/** 根据用户输入的关键词，自动激活相关技能（最多 2 个） */
export function matchSkills(text: string, max = 2) {
  const scored = listSkills()
    .map((s) => ({ s, score: s.triggers.filter((t) => text.includes(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((x) => x.s);
}
