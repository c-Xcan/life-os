import { getSettings, getProvider, getApiKey, type Provider, type RoleName, type Settings } from "../core/settings";
import { trace } from "../agent/trace";

/* ============ OpenAI 兼容消息格式 ============ */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; reasoning_content?: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ResolvedModel { provider: Provider; model: string; thinking: boolean; apiKey?: string }

export function resolveRole(role: RoleName, settings: Settings = getSettings()): ResolvedModel {
  const r = settings.roles[role];
  const provider = getProvider(settings, r.provider);
  return { provider, model: r.model, thinking: r.thinking, apiKey: getApiKey(provider) };
}

function endpoint(p: Provider, path: string) {
  return p.baseURL.replace(/\/+$/, "") + path;
}

function headers(m: ResolvedModel) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (m.apiKey) h.Authorization = `Bearer ${m.apiKey}`;
  return h;
}

/** 按服务商整理消息：DeepSeek 在工具模式下必须回传 reasoning_content，其他服务商去掉该字段 */
function prepareMessages(m: ResolvedModel, messages: ChatMessage[]) {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    const out: Record<string, unknown> = { role: "assistant", content: msg.content ?? "" };
    if (msg.tool_calls?.length) out.tool_calls = msg.tool_calls;
    if (m.provider.kind === "deepseek") out.reasoning_content = msg.reasoning_content ?? "";
    return out;
  });
}

function buildBody(m: ResolvedModel, messages: ChatMessage[], extra: Record<string, unknown>) {
  const body: Record<string, unknown> = { model: m.model, messages: prepareMessages(m, messages), ...extra };
  if (m.provider.kind === "deepseek") body.thinking = { type: m.thinking ? "enabled" : "disabled" };
  return body;
}

async function assertOk(res: Response, m: ResolvedModel) {
  if (res.ok) return;
  let detail = "";
  try { detail = await res.text(); } catch { /* ignore */ }
  if (res.status === 401) throw new Error(`${m.provider.name} 认证失败：请在「设置」中检查 API Key`);
  throw new Error(`${m.provider.name} 请求失败 (${res.status})：${detail.slice(0, 500)}`);
}

/* ============ 流式对话（含工具调用） ============ */
export type StreamEvent =
  | { type: "reasoning"; delta: string }
  | { type: "text"; delta: string }
  | { type: "tool_call_start"; index: number; id: string; name: string }
  | { type: "finish"; message: Extract<ChatMessage, { role: "assistant" }>; usage?: Usage; finishReason?: string };

export interface Usage { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number }

export async function* chatStream(opts: {
  model: ResolvedModel;
  messages: ChatMessage[];
  tools?: ToolDef[];
  signal?: AbortSignal;
  label?: string;
}): AsyncGenerator<StreamEvent> {
  const { model: m } = opts;
  const started = Date.now();
  const body = buildBody(m, opts.messages, {
    stream: true,
    stream_options: { include_usage: true },
    ...(opts.tools?.length ? { tools: opts.tools } : {}),
  });
  const res = await fetch(endpoint(m.provider, "/chat/completions"), {
    method: "POST", headers: headers(m), body: JSON.stringify(body), signal: opts.signal,
  });
  await assertOk(res, m);
  if (!res.body) throw new Error("模型没有返回数据流");

  let content = "";
  let reasoning = "";
  const calls: { id: string; name: string; args: string }[] = [];
  let usage: Usage | undefined;
  let finishReason: string | undefined;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let json: {
          choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[];
          usage?: Usage;
        };
        try { json = JSON.parse(data); } catch { continue; }
        if (json.usage) usage = json.usage;
        const choice = json.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const d = choice.delta ?? {};
        const r = d.reasoning_content ?? d.reasoning;
        if (r) { reasoning += r; yield { type: "reasoning", delta: r }; }
        if (d.content) { content += d.content; yield { type: "text", delta: d.content }; }
        for (const tc of d.tool_calls ?? []) {
          const i = tc.index ?? 0;
          if (!calls[i]) {
            calls[i] = { id: tc.id ?? `call_${i}_${Date.now()}`, name: tc.function?.name ?? "", args: "" };
            if (calls[i].name) yield { type: "tool_call_start", index: i, id: calls[i].id, name: calls[i].name };
          } else if (tc.function?.name && !calls[i].name) {
            calls[i].name = tc.function.name;
          }
          if (tc.id && !calls[i].id) calls[i].id = tc.id;
          if (tc.function?.arguments) calls[i].args += tc.function.arguments;
        }
      }
    }
  } finally {
    trace({ kind: "llm", label: opts.label ?? "chat", provider: m.provider.id, model: m.model, ms: Date.now() - started, usage, tools: calls.map((c) => c.name) });
  }

  const tool_calls: ToolCall[] = calls.filter(Boolean).map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } }));
  yield {
    type: "finish",
    message: { role: "assistant", content, reasoning_content: reasoning || undefined, ...(tool_calls.length ? { tool_calls } : {}) },
    usage, finishReason,
  };
}

/* ============ 非流式：后台任务用（抽取记忆、摘要等） ============ */
export async function chatOnce(opts: { model: ResolvedModel; messages: ChatMessage[]; json?: boolean; label?: string; maxTokens?: number }) {
  const { model: m } = opts;
  const started = Date.now();
  const body = buildBody(m, opts.messages, {
    stream: false,
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  });
  const res = await fetch(endpoint(m.provider, "/chat/completions"), { method: "POST", headers: headers(m), body: JSON.stringify(body) });
  await assertOk(res, m);
  const json = (await res.json()) as { choices: { message: { content: string } }[]; usage?: Usage };
  trace({ kind: "llm", label: opts.label ?? "once", provider: m.provider.id, model: m.model, ms: Date.now() - started, usage: json.usage });
  return json.choices?.[0]?.message?.content ?? "";
}

export async function chatJSON<T>(opts: { role?: RoleName; system: string; user: string; label?: string; parse: (v: unknown) => T }): Promise<T> {
  const model = resolveRole(opts.role ?? "background");
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await chatOnce({
      model, json: true, label: opts.label,
      messages: [
        { role: "system", content: opts.system + "\n\n只输出一个合法的 JSON 对象，不要输出其他内容。" },
        { role: "user", content: opts.user },
      ],
    });
    try {
      const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
      return opts.parse(JSON.parse(cleaned));
    } catch (e) { lastErr = e; }
  }
  throw new Error(`模型返回的 JSON 无法解析：${String(lastErr)}`);
}

export async function chatText(opts: { role?: RoleName; system: string; user: string; label?: string }) {
  const model = resolveRole(opts.role ?? "background");
  return chatOnce({ model, label: opts.label, messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }] });
}

/* ============ 嵌入 ============ */
export async function embedTexts(texts: string[]): Promise<{ model: string; vectors: number[][] }> {
  const m = resolveRole("embedding");
  const res = await fetch(endpoint(m.provider, "/embeddings"), {
    method: "POST", headers: headers(m), body: JSON.stringify({ model: m.model, input: texts }),
    signal: AbortSignal.timeout(60000),
  });
  await assertOk(res, m);
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  const vectors = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  return { model: `${m.provider.id}:${m.model}`, vectors };
}

/* ============ 识图 ============ */
/** 用「识图」角色给图片写一句中文描述 + 几个标签（失败抛错，未启用返回 null） */
export async function describeImage(data: Buffer, mime = "image/webp"): Promise<{ caption: string; tags: string[] } | null> {
  const settings = getSettings();
  if (!settings.roles.vision?.enabled) return null;
  const m = resolveRole("vision", settings);
  const started = Date.now();
  const res = await fetch(endpoint(m.provider, "/chat/completions"), {
    method: "POST",
    headers: headers(m),
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model: m.model,
      // 只要简短结果：关掉思考，否则 token 全花在推理上、正文为空
      ...(m.provider.kind === "deepseek" ? { thinking: { type: m.thinking ? "enabled" : "disabled" } } : {}),
      max_tokens: m.thinking ? 1024 : 200,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: '这是我个人相册里的一张照片。请输出一个 JSON 对象：{"caption": "一句简短的中文描述，不超过 40 个字，写清主体、场景和正在发生的事", "tags": ["2 到 4 个中文分类标签，每个 2~4 个字，例如 风景、美食、宠物、人物、旅行、工作、截图、文档、运动、城市、自然"]}。只输出 JSON。' },
          { type: "image_url", image_url: { url: `data:${mime};base64,${data.toString("base64")}` } },
        ],
      }],
    }),
  });
  await assertOk(res, m);
  const json = (await res.json()) as { choices: { message: { content: string } }[]; usage?: Usage };
  trace({ kind: "llm", label: "vision", provider: m.provider.id, model: m.model, ms: Date.now() - started, usage: json.usage });
  const raw = (json.choices?.[0]?.message?.content ?? "").trim();
  const clean = (t: string) => t.trim().replace(/^["“'「]+|["”'」]+$/g, "").replace(/[[\]\n]/g, " ").trim();
  try {
    const obj = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "")) as { caption?: unknown; tags?: unknown };
    const caption = typeof obj.caption === "string" ? clean(obj.caption).slice(0, 80) : "";
    const tags = Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === "string").map((t) => clean(t).slice(0, 8)).filter(Boolean).slice(0, 4) : [];
    return caption || tags.length ? { caption, tags } : null;
  } catch {
    // 模型没按 JSON 输出：整段当描述
    const caption = clean(raw).slice(0, 80);
    return caption ? { caption, tags: [] } : null;
  }
}

/** 连通性测试 */
export async function testRole(role: RoleName) {
  const started = Date.now();
  if (role === "embedding") {
    const r = await embedTexts(["测试"]);
    return { ok: true, ms: Date.now() - started, info: `向量维度 ${r.vectors[0]?.length}` };
  }
  const m = resolveRole(role);
  const text = await chatOnce({ model: { ...m, thinking: false }, label: "test", maxTokens: 20, messages: [{ role: "user", content: "回复：ok" }] });
  return { ok: true, ms: Date.now() - started, info: text.slice(0, 50) };
}
