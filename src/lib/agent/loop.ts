import { getSettings, getProvider } from "../core/settings";
import { chatStream, resolveRole, type ChatMessage, type ToolCall } from "../llm/client";
import { TOOL_MAP, toolDefs, type ToolCtx } from "./tools";
import { buildSystemPrompt, buildTurnContext } from "./context";
import { loadSession, newSession, saveSession, toApiMessages, writeTranscript, turnText, type Session, type StoredMessage } from "./sessions";
import { extractMemory } from "../memory/pipeline";
import { trace } from "./trace";

export type AgentEvent =
  | { type: "session"; id: string; title: string }
  | { type: "user"; display: string; retrieved: { path: string; title: string; date: string | null }[]; skills: string[] }
  | { type: "assistant_start" }
  | { type: "reasoning"; delta: string }
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; result: unknown }
  | { type: "approval_required"; calls: { id: string; name: string; args: unknown; preview: string }[] }
  | { type: "error"; message: string }
  | { type: "done" };

export interface RunInput {
  sessionId?: string;
  message?: string;
  /** 对待确认写操作的决定：tool_call_id → 是否批准 */
  approvals?: Record<string, boolean>;
  /** 临时覆盖：是否开启思考 */
  thinking?: boolean;
  /** 隐私模式：使用本地模型，可读取 private 内容 */
  privateMode?: boolean;
  signal?: AbortSignal;
}

function safeParse(s: string) {
  try { return JSON.parse(s || "{}"); } catch { return null; }
}

async function execTool(call: ToolCall, ctx: ToolCtx): Promise<{ ok: boolean; result: unknown }> {
  const tool = TOOL_MAP.get(call.function.name);
  if (!tool) return { ok: false, result: { error: `未知工具 ${call.function.name}` } };
  const raw = safeParse(call.function.arguments);
  if (raw === null) return { ok: false, result: { error: "参数不是合法 JSON" } };
  const parsed = tool.schema.safeParse(raw);
  if (!parsed.success) return { ok: false, result: { error: "参数校验失败", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) } };
  const started = Date.now();
  try {
    const result = await tool.run(parsed.data, ctx);
    trace({ kind: "tool", name: tool.name, ms: Date.now() - started, ok: true, session: ctx.sessionId });
    return { ok: true, result };
  } catch (e) {
    trace({ kind: "tool", name: tool.name, ms: Date.now() - started, ok: false, error: String(e), session: ctx.sessionId });
    return { ok: false, result: { error: e instanceof Error ? e.message : String(e) } };
  }
}

function toolMessage(id: string, result: unknown): StoredMessage {
  const content = typeof result === "string" ? result : JSON.stringify(result);
  return { role: "tool", tool_call_id: id, content: content.length > 24000 ? content.slice(0, 24000) + "…（已截断）" : content };
}

/**
 * Agent 主循环：组装上下文 → 模型推理 ⇄ 工具调用 → 流式输出。
 * 写操作在需要确认时暂停，等前端带着 approvals 再次调用以继续。
 */
export async function runAgent(input: RunInput, emit: (e: AgentEvent) => void) {
  const settings = getSettings();
  let session: Session = (input.sessionId && loadSession(input.sessionId)) || newSession();
  emit({ type: "session", id: session.id, title: session.title });

  const usePrivate = !!input.privateMode && settings.roles.private.enabled;
  const model = resolveRole(usePrivate ? "private" : "chat", settings);
  if (input.thinking !== undefined) model.thinking = input.thinking;
  const isLocal = getProvider(settings, model.provider.id).local;
  const allowPrivate = isLocal || settings.privacy.sendPrivateToCloud;
  const ctx: ToolCtx = { allowPrivate, sessionId: session.id };
  if (!model.apiKey && !isLocal) {
    emit({ type: "error", message: `还没有配置 ${model.provider.name} 的 API Key，请到「设置」页填写。` });
    emit({ type: "done" });
    return;
  }

  const turnStart = session.messages.length;
  let proposedThisTurn = false;

  // 1) 处理待确认的写操作
  if (session.pending?.calls.length) {
    const approvals = input.approvals ?? {};
    for (const call of session.pending.calls) {
      const approved = approvals[call.id] === true;
      if (approved) {
        const r = await execTool(call, ctx);
        session.messages.push(toolMessage(call.id, r.result));
        emit({ type: "tool_result", id: call.id, name: call.function.name, ok: r.ok, result: r.result });
      } else {
        const result = { rejected: true, note: "用户拒绝了这个操作，不要重复尝试，可以询问用户想怎么调整。" };
        session.messages.push(toolMessage(call.id, result));
        emit({ type: "tool_result", id: call.id, name: call.function.name, ok: false, result });
      }
    }
    session.pending = null;
    if (input.message) {
      // 用户没点确认而是直接发了新消息：视为全部拒绝（上面已处理），继续正常流程
    }
  }

  // 2) 新的用户消息：附加检索上下文与技能
  if (input.message?.trim()) {
    const text = input.message.trim();
    const turn = await buildTurnContext(text, settings, allowPrivate);
    session.messages.push({ role: "user", content: turn.content, ui: { display: text, retrieved: turn.retrieved, skills: turn.skills, at: new Date().toISOString() } });
    if (session.title === "新对话") session.title = text.replace(/\s+/g, " ").slice(0, 30);
    emit({ type: "session", id: session.id, title: session.title });
    emit({ type: "user", display: text, retrieved: turn.retrieved, skills: turn.skills });
  }

  const system: ChatMessage = { role: "system", content: buildSystemPrompt(settings, allowPrivate) };
  const tools = toolDefs();

  try {
    for (let step = 0; step < settings.agent.maxSteps; step++) {
      emit({ type: "assistant_start" });
      let finished: Extract<ChatMessage, { role: "assistant" }> | null = null;
      for await (const ev of chatStream({ model, messages: [system, ...toApiMessages(session.messages)], tools, signal: input.signal, label: "agent" })) {
        if (ev.type === "reasoning") emit({ type: "reasoning", delta: ev.delta });
        else if (ev.type === "text") emit({ type: "text", delta: ev.delta });
        else if (ev.type === "finish") finished = ev.message;
      }
      if (!finished) throw new Error("模型没有返回结果");
      session.messages.push(finished);
      saveSession(session);

      const calls = finished.tool_calls ?? [];
      if (!calls.length) break;

      const needApproval: (ToolCall & { preview: string })[] = [];
      for (const call of calls) {
        const tool = TOOL_MAP.get(call.function.name);
        const args = safeParse(call.function.arguments);
        emit({ type: "tool_call", id: call.id, name: call.function.name, args });
        if (call.function.name === "propose_memory") proposedThisTurn = true;
        if (tool?.write && settings.agent.requireApprovalForWrites) {
          let preview = tool.name;
          try { const p = tool.schema.safeParse(args); if (p.success && tool.preview) preview = tool.preview(p.data); } catch { /* ignore */ }
          needApproval.push({ ...call, preview });
          continue;
        }
        const r = await execTool(call, ctx);
        session.messages.push(toolMessage(call.id, r.result));
        emit({ type: "tool_result", id: call.id, name: call.function.name, ok: r.ok, result: r.result });
      }

      if (needApproval.length) {
        session.pending = { calls: needApproval };
        saveSession(session);
        emit({ type: "approval_required", calls: needApproval.map((c) => ({ id: c.id, name: c.function.name, args: safeParse(c.function.arguments), preview: c.preview })) });
        return finalize(session, turnStart, proposedThisTurn, settings.agent.autoExtractMemory, emit, true);
      }
    }
  } catch (e) {
    const message = (e as Error)?.name === "AbortError" ? "已停止" : e instanceof Error ? e.message : String(e);
    emit({ type: "error", message });
    // 保证消息序列合法：如果最后一条是带工具调用的 assistant 但缺少结果，补上错误结果
    const last = session.messages.at(-1);
    if (last?.role === "assistant" && last.tool_calls?.length) {
      const answered = new Set(session.messages.filter((m) => m.role === "tool").map((m) => (m as { tool_call_id: string }).tool_call_id));
      for (const c of last.tool_calls) if (!answered.has(c.id)) session.messages.push(toolMessage(c.id, { error: message }));
    }
  }
  return finalize(session, turnStart, proposedThisTurn, settings.agent.autoExtractMemory, emit, false);
}

function finalize(session: Session, turnStart: number, proposed: boolean, autoExtract: boolean, emit: (e: AgentEvent) => void, paused: boolean) {
  saveSession(session);
  let transcript: string | null = null;
  try { transcript = writeTranscript(session); } catch { /* ignore */ }
  emit({ type: "done" });
  // 后台抽取记忆（不阻塞响应）：本轮已主动提交过记忆候选就跳过
  if (!paused && autoExtract && !proposed) {
    // 从本轮最后一条用户消息开始（中途因确认暂停过的轮次也能完整覆盖）
    let from = turnStart;
    for (let i = session.messages.length - 1; i >= 0; i--) if (session.messages[i].role === "user") { from = Math.min(from, i); break; }
    const text = turnText(session.messages, from);
    if (text.length > 30) void extractMemory(text, transcript ?? `session ${session.id}`, `对话「${session.title}」中发现的记忆`).catch((e) => trace({ kind: "memory.extract.error", error: String(e) }));
  }
}
