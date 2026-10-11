import fs from "node:fs";
import { appPath, ensureDir } from "../core/paths";
import { dateStr, shortId } from "../core/util";
import type { ChatMessage, ToolCall } from "../llm/client";
import { writeNote, P } from "../vault/fs";
import { indexFile } from "../index/indexer";

export type StoredMessage = ChatMessage & {
  /** 仅供界面使用的附加信息，发送给模型前会去掉 */
  ui?: { display?: string; retrieved?: { path: string; title: string; date: string | null }[]; skills?: string[]; at?: string; error?: string };
};

export interface Session {
  id: string;
  title: string;
  created: string;
  updated: string;
  date: string;
  messages: StoredMessage[];
  /** 等待用户确认的写操作 */
  pending?: { calls: (ToolCall & { preview: string })[] } | null;
}

const DIR = () => appPath("sessions");

export function newSession(): Session {
  const now = new Date().toISOString();
  return { id: `${dateStr().replace(/-/g, "")}-${shortId(6)}`, title: "新对话", created: now, updated: now, date: dateStr(), messages: [], pending: null };
}

export function loadSession(id: string): Session | null {
  try { return JSON.parse(fs.readFileSync(`${DIR()}/${id.replace(/[^\w-]/g, "")}.json`, "utf8")); } catch { return null; }
}

export function saveSession(s: Session) {
  ensureDir(DIR());
  s.updated = new Date().toISOString();
  fs.writeFileSync(`${DIR()}/${s.id}.json`, JSON.stringify(s), "utf8");
}

export function deleteSession(id: string) {
  try { fs.unlinkSync(`${DIR()}/${id.replace(/[^\w-]/g, "")}.json`); } catch { /* ignore */ }
}

export function listSessions() {
  ensureDir(DIR());
  return fs.readdirSync(DIR()).filter((f) => f.endsWith(".json")).map((f) => {
    try {
      const s = JSON.parse(fs.readFileSync(`${DIR()}/${f}`, "utf8")) as Session;
      return { id: s.id, title: s.title, updated: s.updated, count: s.messages.filter((m) => m.role === "user").length };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => b!.updated.localeCompare(a!.updated)) as { id: string; title: string; updated: string; count: number }[];
}

/** 去掉界面字段，得到发给模型的消息 */
export function toApiMessages(msgs: StoredMessage[]): ChatMessage[] {
  return msgs.map((m) => {
    const { ui: _ui, ...rest } = m;
    void _ui;
    return rest as ChatMessage;
  });
}

/** 把对话写成 Markdown，存进 vault/sessions（情景记忆，任何 AI 都能读） */
export function writeTranscript(s: Session) {
  const lines: string[] = [`# ${s.title}`, ""];
  for (const m of s.messages) {
    if (m.role === "user") lines.push(`**我**：${m.ui?.display ?? m.content}`, "");
    else if (m.role === "assistant") {
      if (m.tool_calls?.length) lines.push(`> 调用工具：${m.tool_calls.map((c) => c.function.name).join("、")}`, "");
      if (m.content) lines.push(`**AI**：${m.content}`, "");
    }
  }
  const rel = P.session(s.date, s.id);
  writeNote(rel, { type: "session", title: s.title, date: s.date, session_id: s.id }, lines.join("\n"), { reason: `session ${s.id}`, actor: "system" });
  try { indexFile(rel); } catch { /* ignore */ }
  return rel;
}

/** 本轮新增的对话文本（用于记忆抽取） */
export function turnText(msgs: StoredMessage[], fromIndex: number) {
  return msgs.slice(fromIndex)
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => `${m.role === "user" ? "用户" : "AI"}：${m.role === "user" ? (m.ui?.display ?? m.content) : m.content}`)
    .join("\n\n");
}
