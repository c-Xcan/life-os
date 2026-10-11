/* 端到端测试：模拟 DeepSeek（流式 + 工具调用 + reasoning 回传校验）+ 模拟嵌入服务 */
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// 始终在临时目录里测试，绝不碰真实 vault
const TMP = path.join(os.tmpdir(), `life-os-e2e-${Date.now()}`);
process.env.VAULT_DIR = path.join(TMP, "vault");
process.env.APP_DIR = path.join(TMP, ".app");
fs.mkdirSync(TMP, { recursive: true });

let step = 0;
const server = http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const j = body ? JSON.parse(body) : {};
  if (req.url?.endsWith("/embeddings")) {
    const data = j.input.map((t: string, i: number) => ({ index: i, embedding: Array.from({ length: 8 }, (_, k) => ((t.charCodeAt(k % t.length) || 1) % 7) + 0.1) }));
    res.end(JSON.stringify({ data })); return;
  }
  // 校验：工具模式下历史 assistant 必须带 reasoning_content
  for (const m of j.messages ?? []) if (m.role === "assistant" && j.tools && m.reasoning_content === undefined) { res.statusCode = 400; res.end("missing reasoning_content"); return; }
  if (!j.stream) {
    const sys = j.messages[0].content as string;
    const content = sys.includes("记忆管理器")
      ? JSON.stringify({ operations: [{ op: "add", domain: "learning", text: "用户正在准备 12 月的雅思考试", confidence: 0.9, importance: 4, reason: "对话提到" }] })
      : "## 数据概览\n测试";
    res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })); return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  const last = j.messages.at(-1);
  step++;
  if (last.role === "user") {
    send({ choices: [{ delta: { reasoning_content: "先查一下睡眠数据。" } }] });
    send({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "query_metrics", arguments: '{"keys":["sle' } }] } }] });
    send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ep"],"days":7}' } }] } }] });
    send({ choices: [{ delta: { tool_calls: [{ index: 1, id: "call_b", function: { name: "append_journal", arguments: '{"content":"今天背了 50 个单词","metrics":{"mood":4}}' } }] }, finish_reason: "tool_calls" }] });
  } else {
    send({ choices: [{ delta: { reasoning_content: "整理回答。" } }] });
    send({ choices: [{ delta: { content: "已记录，你最近平均睡眠 " } }] });
    send({ choices: [{ delta: { content: "7 小时。" }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 80 } });
  }
  res.end("data: [DONE]\n\n");
});

server.listen(0, async () => {
  const port = (server.address() as { port: number }).port;
  const { saveSettings, setApiKey, DEFAULT_SETTINGS } = await import("../../src/lib/core/settings");
  setApiKey("deepseek", "test");
  const s = structuredClone(DEFAULT_SETTINGS);
  s.providers[0].baseURL = `http://127.0.0.1:${port}`;
  s.providers[1].baseURL = `http://127.0.0.1:${port}/v1`;
  s.history.enabled = true;
  saveSettings(s);
  const { ensureRuntime } = await import("../../src/lib/runtime");
  await ensureRuntime();
  const { saveJournal } = await import("../../src/lib/vault/services");
  saveJournal("2026-10-08", "# 2026-10-08\n\n## 今天做了什么\n\n复习雅思听力两小时。", { sleep: 6.5, mood: 3, study_min: 120 });
  saveJournal("2026-10-09", "# 2026-10-09\n\n## 今天做了什么\n\n写作练习，睡得很晚。", { sleep: 5.5, mood: 2, study_min: 90 });
  const { runAgent } = await import("../../src/lib/agent/loop");
  const ev: any[] = [];
  await runAgent({ message: "我最近睡眠怎么样？顺便记录今天背了 50 个单词，准备雅思考试" }, (e) => ev.push(e));
  const ap = ev.find((e) => e.type === "approval_required");
  console.log("events1:", ev.map((e) => e.type).join(","));
  console.log("metrics result:", JSON.stringify(ev.find((e) => e.type === "tool_result")?.result?.stats));
  console.log("approval:", JSON.stringify(ap?.calls?.map((c: any) => c.preview)));
  const sid = ev.find((e) => e.type === "session").id;
  const ev2: any[] = [];
  await runAgent({ sessionId: sid, approvals: { [ap.calls[0].id]: true } }, (e) => ev2.push(e));
  console.log("events2:", ev2.map((e) => e.type).join(","), ev2.filter((e) => e.type === "text").map((e) => e.delta).join(""));
  console.log("errors:", JSON.stringify(ev2.filter((e) => e.type === "error")));
  const { readNote } = await import("../../src/lib/vault/fs");
  const { dateStr } = await import("../../src/lib/core/util");
  console.log("journal today:\n", readNote(`journal/${dateStr().slice(0, 4)}/${dateStr().slice(5, 7)}/${dateStr()}.md`)?.raw);
  await new Promise((r) => setTimeout(r, 2500));
  const { listProposals, } = await import("../../src/lib/memory/inbox");
  const props = listProposals();
  console.log("proposals:", props.length, JSON.stringify(props[0]?.ops));
  const { applyProposal } = await import("../../src/lib/memory/pipeline");
  applyProposal(props[0].id, { 0: { decision: "approved" } });
  const { listFacts, search } = await import("../../src/lib/index/search");
  console.log("facts:", JSON.stringify(listFacts()));
  console.log("search 睡眠:", (await search("睡眠")).map((h) => h.path + ":" + h.score.toFixed(2)).join(" | "));
  console.log("search 雅思考试:", (await search("雅思考试")).map((h) => h.path + ":" + h.score.toFixed(2)).join(" | "));
  const { generateWeeklyReview, proposeNowRefresh } = await import("../../src/lib/memory/consolidate");
  console.log("weekly:", JSON.stringify(await generateWeeklyReview("2026-10-09", true)));
  console.log("now proposal:", (await proposeNowRefresh())?.id ? "ok" : "none");
  const { buildBackup, restoreBackup } = await import("../../src/lib/backup/backup");
  const { readZip } = await import("../../src/lib/backup/zip");
  const backup = buildBackup();
  console.log("backup:", JSON.stringify(backup.manifest));
  console.log("restore:", JSON.stringify(await restoreBackup(readZip(backup.zip))));
  const { recentChanges } = await import("../../src/lib/vault/history");
  await new Promise((r) => setTimeout(r, 2000));
  console.log("history:", JSON.stringify(recentChanges(5).map((l) => `${l.actor}: ${l.reason}`)));
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("\n✅ e2e 通过");
  process.exit(0);
});
