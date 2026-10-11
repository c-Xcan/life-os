/* 验证 Electron 自带的 Node 能不能用 node:sqlite（桌面版的关键前提） */
const { spawnSync } = require("node:child_process");
const electron = require("electron"); // 在 Node 里 require 得到的是 Electron 可执行文件路径
const code = `
  const v = process.versions;
  console.log("Electron " + v.electron + " / Node " + v.node + " / Chrome " + v.chrome);
  try {
    const sqlite = process.getBuiltinModule("node:sqlite");
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec("CREATE VIRTUAL TABLE t USING fts5(x); INSERT INTO t VALUES ('hello life os');");
    const row = db.prepare("SELECT count(*) AS n FROM t WHERE t MATCH 'life'").get();
    console.log("[OK] node:sqlite + FTS5 available (matched " + row.n + " row)");
  } catch (e) {
    console.log("[FAIL] node:sqlite unavailable: " + e.message);
    process.exitCode = 1;
  }
`;
// 控制台输出用英文，避免 Windows PowerShell 代码页导致中文乱码
const r = spawnSync(electron, ["--disable-warning=ExperimentalWarning", "-e", code], { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
process.exit(r.status ?? 1);
