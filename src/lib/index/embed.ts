import { getDb } from "./db";
import { getSettings } from "../core/settings";
import { embedTexts } from "../llm/client";

const g = globalThis as unknown as { __lifeosEmbedding?: boolean; __lifeosEmbedStatus?: EmbedStatus };
export interface EmbedStatus { ok: boolean; model?: string; error?: string; at?: string; pending?: number }

export function embedStatus(): EmbedStatus {
  return g.__lifeosEmbedStatus ?? { ok: false, error: "尚未运行" };
}

export function embeddingModelKey() {
  const s = getSettings();
  const r = s.roles.embedding;
  return r.enabled ? `${r.provider}:${r.model}` : null;
}

/** 给还没有向量的文本块补算向量（后台、可中断、失败不影响检索） */
export async function embedPending(batch = 16, maxBatches = 200) {
  const model = embeddingModelKey();
  if (!model || g.__lifeosEmbedding) return;
  g.__lifeosEmbedding = true;
  const db = getDb();
  try {
    for (let i = 0; i < maxBatches; i++) {
      const rows = db.prepare(`SELECT DISTINCT c.hash, c.text FROM chunks c
        LEFT JOIN embeddings e ON e.chunk_hash = c.hash AND e.model = ?
        WHERE e.chunk_hash IS NULL LIMIT ?`).all(model, batch) as { hash: string; text: string }[];
      if (!rows.length) break;
      const { vectors } = await embedTexts(rows.map((r) => r.text.slice(0, 2000)));
      const ins = db.prepare("INSERT OR REPLACE INTO embeddings(chunk_hash, model, dim, vec) VALUES (?,?,?,?)");
      rows.forEach((r, j) => {
        const v = vectors[j];
        if (!v) return;
        const f = normalize(Float32Array.from(v));
        ins.run(r.hash, model, f.length, new Uint8Array(f.buffer));
      });
    }
    const pending = (db.prepare(`SELECT COUNT(*) n FROM chunks c LEFT JOIN embeddings e ON e.chunk_hash=c.hash AND e.model=? WHERE e.chunk_hash IS NULL`).get(model) as { n: number }).n;
    g.__lifeosEmbedStatus = { ok: true, model, at: new Date().toISOString(), pending };
  } catch (e) {
    g.__lifeosEmbedStatus = { ok: false, model, error: e instanceof Error ? e.message : String(e), at: new Date().toISOString() };
  } finally {
    g.__lifeosEmbedding = false;
  }
}

export function normalize(v: Float32Array) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export function blobToVec(b: Uint8Array): Float32Array {
  const copy = new Uint8Array(b); // 保证 4 字节对齐
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

export function dot(a: Float32Array, b: Float32Array) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
