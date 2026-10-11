import fs from "node:fs";
import path from "node:path";
import { ROOT, VAULT_DIR, APP_DIR, ensureDir } from "../core/paths";

const TEMPLATE_DIR = path.join(/*turbopackIgnore: true*/ ROOT, "vault-template");

/** 首次运行：用 vault-template 初始化 vault（只补缺失文件，绝不覆盖） */
export async function bootstrapVault() {
  ensureDir(VAULT_DIR);
  ensureDir(APP_DIR);
  if (fs.existsSync(TEMPLATE_DIR)) {
    const firstRun = !fs.existsSync(path.join(VAULT_DIR, "README.ai.md"));
    if (firstRun) copyMissing(TEMPLATE_DIR, VAULT_DIR);
    else {
      // 之后只补充系统自带的模板与技能（新版本可能新增），不动你的内容
      for (const sub of ["_templates", "skills"]) {
        const s = path.join(/*turbopackIgnore: true*/ TEMPLATE_DIR, sub);
        const d = path.join(/*turbopackIgnore: true*/ VAULT_DIR, sub);
        if (fs.existsSync(/*turbopackIgnore: true*/ s)) { ensureDir(d); copyMissing(s, d); }
      }
    }
  }

}

function copyMissing(src: string, dst: string) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      ensureDir(d);
      copyMissing(s, d);
    } else if (!fs.existsSync(d)) {
      fs.copyFileSync(s, d);
    }
  }
}
