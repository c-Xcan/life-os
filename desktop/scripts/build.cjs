/* 打包桌面版：
 *   1. 以 standalone 模式构建 Next（只在打包时开启，不影响 npm run dev / build）
 *   2. 白名单清理 standalone：只保留服务需要的文件，再复制 public、.next/static、vault-template
 *   3. 安全检查：发现个人数据（vault、.app、.git、密钥）直接中止，绝不打进安装包
 *   4. electron-builder 生成安装包（Windows: --win，Mac: --mac，需在对应系统上执行）
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const sa = path.join(root, ".next", "standalone");
const stage = path.join(root, ".next", "desktop", "server");
const run = (cmd, args, env = {}) => {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  if (r.status !== 0) { console.error(`\n✗ 命令失败（退出码 ${r.status}）`); process.exit(r.status ?? 1); }
};
/** 逐个文件复制（跟随链接）。不用 fs.cpSync：它在 Windows 上遇到目录联接会让 Node 直接崩溃退出 */
const copyTree = (from, to, depth = 0) => {
  if (depth > 40) throw new Error("目录层级过深，可能存在循环链接：" + from);
  const st = fs.statSync(from); // statSync 会跟随链接，拿到真实文件 / 目录
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyTree(path.join(from, name), path.join(to, name), depth + 1);
  } else {
    fs.copyFileSync(from, to);
  }
};
const copy = (from, to) => { if (fs.existsSync(from)) copyTree(from, to); };
/** 只删除链接本身，绝不跟随进去删目标 */
const unlinkOnly = (p) => { try { fs.unlinkSync(p); } catch { fs.rmdirSync(p); } };
process.on("exit", (code) => { if (code) console.error(`\n✗ 打包脚本退出（代码 ${code}）`); });

fs.rmSync(sa, { recursive: true, force: true });
run("npx", ["next", "build"], { LIFEOS_STANDALONE: "1" });
if (!fs.existsSync(path.join(sa, "server.js"))) { console.error("✗ 没有找到 .next/standalone/server.js，构建失败"); process.exit(1); }

// ---- 白名单：只保留这些，其余全部删除 ----
console.log("\n[1/4] 清理 standalone（只保留服务需要的文件）");
const KEEP = new Set(["server.js", "package.json", "node_modules", ".next"]);
for (const name of fs.readdirSync(sa)) {
  if (KEEP.has(name)) continue;
  const p = path.join(sa, name);
  // 是链接就只删链接，避免误删链接指向的真实数据
  if (fs.lstatSync(p).isSymbolicLink()) unlinkOnly(p); else fs.rmSync(p, { recursive: true, force: true });
  console.log("  - 移除", name);
}
// .next 里只需要服务端产物
console.log("\n[2/4] 整理服务端文件");
for (const name of ["cache", "trace", "standalone"]) fs.rmSync(path.join(sa, ".next", name), { recursive: true, force: true });

// 把符号链接 / 目录联接换成真实文件：Windows 上它们指向本项目的绝对路径，装到别处就会失效
const materialize = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      const rel = path.relative(sa, p).split(path.sep).join("/");
      let target;
      try { target = fs.realpathSync(p); } catch { console.warn("  ! 无法解析链接，已删除：", rel); unlinkOnly(p); continue; }
      unlinkOnly(p);
      copyTree(target, p);
      console.log("  ~ 链接换成实体：", rel, "←", target);
    } else if (e.isDirectory()) materialize(p);
  }
};
materialize(sa);

console.log("\n[3/4] 复制静态资源和模板");
copy(path.join(root, "public"), path.join(sa, "public"));
copy(path.join(root, ".next", "static"), path.join(sa, ".next", "static"));
copy(path.join(root, "vault-template"), path.join(sa, "vault-template"));

// ---- 安全检查：不能带上任何个人数据 ----
const bad = [];
const walk = (dir, depth = 0) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(sa, p).split(path.sep).join("/");
    if (e.isDirectory()) {
      const isVault = e.name === "vault" && (fs.existsSync(path.join(p, "journal")) || fs.existsSync(path.join(p, "README.ai.md")));
      if ((isVault || e.name === ".app" || e.name === ".git") && !rel.startsWith("node_modules/")) bad.push(rel);
      else if (depth < 6) walk(p, depth + 1);
    } else if (/^(secrets\.json|settings\.json|index\.db.*|\.env.*)$/.test(e.name) && !rel.startsWith("node_modules/")) bad.push(rel);
  }
};
walk(sa);
if (bad.length) {
  console.error("\n✗ 安全检查失败：standalone 里发现个人数据，已中止打包：\n  " + bad.join("\n  "));
  process.exit(1);
}
const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`\n✓ standalone 已准备好（${(size(sa) / 1048576).toFixed(1)} MB），安全检查通过`);

fs.rmSync(path.dirname(stage), { recursive: true, force: true });
copyTree(sa, stage);

const args = process.argv.slice(2);
console.log("\n[4/4] 生成安装包（首次会下载打包工具，可能需要几分钟）");
run("npx", ["electron-builder", "--config", "desktop/electron-builder.yml", ...args], {
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/",
  ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR || "https://npmmirror.com/mirrors/electron-builder-binaries/",
});
console.log("\n✓ 打包完成，安装包在 dist-desktop/");
