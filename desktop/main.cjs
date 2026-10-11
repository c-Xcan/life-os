/* Life OS 桌面版主进程（v1）
 * 开发：先 `npm run dev`，再 `npm run desktop:dev`，窗口直接打开 http://localhost:3721
 * 打包：在 Electron 自带的 Node 里启动 Next standalone 服务（127.0.0.1 + 随机端口），窗口加载它
 * v1：托盘 / 关闭到托盘、全局快捷键写日记、系统通知、开机自启、数据目录管理、检查更新
 */
const {
  app, BrowserWindow, Menu, Tray, Notification, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, session, shell, utilityProcess,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
const DEV = !app.isPackaged || process.argv.includes("--dev");
const DEV_URL = process.env.LIFEOS_DEV_URL || "http://localhost:3721";
const TITLEBAR_H = 48; // 与页面顶栏 h-12 对齐
const STARTED_HIDDEN = process.argv.includes("--hidden") || app.getLoginItemSettings().wasOpenedAsHidden;
const REPO = "c-Xcan/life-os"; // 检查更新用的 GitHub 仓库

app.setName("Life OS");
if (isWin) app.setAppUserModelId("app.lifeos.desktop"); // Windows 通知需要

/* ---------------- 单实例 ---------------- */
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.on("second-instance", () => showWindow());

/* ---------------- 本地配置 ---------------- */
const CONFIG = path.join(app.getPath("userData"), "config.json");
const DEFAULTS = {
  closeToTray: true,
  shortcut: "CommandOrControl+Shift+J",
  notify: { memory: true, review: true, journal: true, journalTime: "21:30" },
  checkUpdates: true,
};
function readConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { /* 首次运行 */ }
  return { ...DEFAULTS, ...c, notify: { ...DEFAULTS.notify, ...(c.notify ?? {}) } };
}
function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(next, null, 2));
  return next;
}

/* ---------------- 数据目录 ---------------- */
const hasData = (dir) => fs.existsSync(path.join(dir, "vault", "README.ai.md"));

/** 首次启动选择数据目录。目录下：vault/（你的 Markdown 数据）+ .app/（索引、设置、密钥） */
async function ensureDataDir() {
  const cfg = readConfig();
  if (cfg.dataDir && fs.existsSync(cfg.dataDir)) return cfg.dataDir;
  const def = path.join(app.getPath("documents"), "Life OS");
  const r = await dialog.showMessageBox({
    type: "question",
    title: "Life OS",
    message: "选择数据保存位置",
    detail: `日记、档案、计划都以 Markdown 文件保存在这个文件夹里。\n\n默认：${def}\n\n如果你之前用网页版，可以直接选择原来的项目文件夹（里面有 vault），数据会原样沿用。`,
    buttons: ["使用默认位置", "选择文件夹…", "退出"],
    defaultId: 0, cancelId: 2, noLink: true,
  });
  if (r.response === 2) { app.quit(); return null; }
  let dir = def;
  if (r.response === 1) {
    const pick = await dialog.showOpenDialog({ title: "选择 Life OS 数据文件夹", defaultPath: app.getPath("documents"), properties: ["openDirectory", "createDirectory"] });
    if (pick.canceled || !pick.filePaths[0]) return ensureDataDir();
    dir = pick.filePaths[0];
  }
  fs.mkdirSync(dir, { recursive: true });
  writeConfig({ dataDir: dir });
  return dir;
}

/** 逐个文件复制（fs.cpSync 在 Windows 遇到目录联接会崩溃），跳过链接循环 */
function copyTree(from, to, depth = 0) {
  if (depth > 40) return;
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyTree(path.join(from, name), path.join(to, name), depth + 1);
  } else if (!fs.existsSync(to)) fs.copyFileSync(from, to);
}

/** 设置页「更改数据目录」：可选把当前数据复制过去，然后重启 */
async function changeDataDir() {
  const cur = readConfig().dataDir;
  const pick = await dialog.showOpenDialog(win ?? undefined, { title: "选择新的数据文件夹", defaultPath: cur || app.getPath("documents"), properties: ["openDirectory", "createDirectory"] });
  const dir = pick.filePaths?.[0];
  if (pick.canceled || !dir || dir === cur) return { changed: false };
  let copyCurrent = false;
  if (hasData(dir)) {
    const r = await dialog.showMessageBox(win ?? undefined, { type: "question", message: "这个文件夹里已经有 Life OS 数据", detail: "切换后将使用它里面的日记和设置，当前文件夹的数据不会被改动。", buttons: ["切换并重启", "取消"], defaultId: 0, cancelId: 1, noLink: true });
    if (r.response !== 0) return { changed: false };
  } else if (cur && hasData(cur)) {
    const r = await dialog.showMessageBox(win ?? undefined, { type: "question", message: "把当前数据复制到新位置？", detail: `从：${cur}\n到：${dir}\n\n复制后原文件夹保留不动，你可以确认无误后自己删除。`, buttons: ["复制并切换", "只切换（新位置从空白开始）", "取消"], defaultId: 0, cancelId: 2, noLink: true });
    if (r.response === 2) return { changed: false };
    copyCurrent = r.response === 0;
  }
  if (copyCurrent) {
    await stopServer(); // 先停服务，避免数据库文件被占用
    for (const sub of ["vault", ".app"]) { const s = path.join(cur, sub); if (fs.existsSync(s)) copyTree(s, path.join(dir, sub)); }
  }
  writeConfig({ dataDir: dir });
  app.relaunch();
  quitting = true;
  app.exit(0);
  return { changed: true };
}

/* ---------------- 本地服务 ---------------- */
let server = null;
let quitting = false;
let baseUrl = DEV ? DEV_URL : "";
let token = "";

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** 轮询直到服务有响应（返回 401 也算启动成功） */
function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => { res.resume(); resolve(); });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("本地服务启动超时"));
        else setTimeout(tick, 250);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tick();
  });
}

async function startServer(dataDir) {
  const serverDir = path.join(process.resourcesPath, "server");
  const port = await freePort();
  const logDir = app.getPath("logs");
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.createWriteStream(path.join(logDir, "server.log"), { flags: "a" });
  log.write(`\n===== ${new Date().toISOString()} 启动，端口 ${port}，数据 ${dataDir} =====\n`);

  server = utilityProcess.fork(path.join(serverDir, "server.js"), [], {
    cwd: serverDir,
    serviceName: "Life OS Server",
    stdio: "pipe",
    execArgv: ["--disable-warning=ExperimentalWarning"], // node:sqlite 的实验性提示，不影响使用
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      VAULT_DIR: path.join(dataDir, "vault"),
      APP_DIR: path.join(dataDir, ".app"),
      LIFEOS_TOKEN: token,
      LIFEOS_DESKTOP: "1",
    },
  });
  server.stdout?.on("data", (d) => log.write(d));
  server.stderr?.on("data", (d) => log.write(d));
  server.on("exit", (code) => {
    log.write(`[exit] code=${code}\n`);
    server = null;
    if (!quitting) {
      dialog.showErrorBox("Life OS", `本地服务意外退出（代码 ${code}）。\n日志：${path.join(logDir, "server.log")}`);
      quitting = true;
      app.quit();
    }
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  return url;
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    quitting = true;
    const s = server;
    s.once("exit", () => resolve());
    s.kill();
    setTimeout(resolve, 3000);
  });
}

/** 主进程调用本地 API（带令牌 Cookie） */
function apiGet(p) {
  return new Promise((resolve, reject) => {
    if (!baseUrl) return reject(new Error("服务未就绪"));
    const req = http.get(baseUrl + p, { headers: token ? { Cookie: `lifeos_token=${token}` } : {} }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { buf += d; });
      res.on("end", () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("超时")));
  });
}

/* ---------------- 窗口 ---------------- */
let win = null;
const bg = () => (nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff");
const titleBarColors = (dark) => (dark ? { color: "#0a0a0a", symbolColor: "#e5e5e5", height: TITLEBAR_H } : { color: "#ffffff", symbolColor: "#171717", height: TITLEBAR_H });

function createWindow() {
  const bounds = readConfig().bounds ?? {};
  win = new BrowserWindow({
    width: bounds.width ?? 1280,
    height: bounds.height ?? 820,
    x: bounds.x, y: bounds.y,
    minWidth: 380, minHeight: 560,
    show: false,
    title: "Life OS",
    backgroundColor: bg(),
    icon: path.join(__dirname, "build", "icon.png"),
    titleBarStyle: "hidden",
    ...(isMac ? { trafficLightPosition: { x: 16, y: 17 } } : {}),
    ...(isWin ? { titleBarOverlay: titleBarColors(nativeTheme.shouldUseDarkColors) } : {}),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  if (bounds.maximized) win.maximize();
  win.once("ready-to-show", () => { if (!STARTED_HIDDEN) win.show(); });

  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    const cur = win.webContents.getURL();
    if (cur.startsWith("file:")) return;
    if (new URL(url).origin !== new URL(cur).origin) { e.preventDefault(); void shell.openExternal(url); }
  });

  const save = () => { if (!win || win.isDestroyed()) return; writeConfig({ bounds: { ...win.getNormalBounds(), maximized: win.isMaximized() } }); };
  win.on("close", (e) => {
    save();
    // 关闭到托盘：后台继续运行定时整理、提醒
    if (!quitting && readConfig().closeToTray) {
      e.preventDefault();
      win.hide();
      if (isWin && !readConfig().trayHintShown) {
        writeConfig({ trayHintShown: true });
        notify("Life OS 仍在后台运行", "可以在右下角托盘图标里打开或退出。设置里可以关闭这个行为。");
      }
    }
  });
  win.on("closed", () => { win = null; });
  return win;
}

function showWindow(route) {
  if (!win) { void boot(route); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (route) win.webContents.send("lifeos:navigate", route);
}

/* ---------------- 托盘 ---------------- */
let tray = null;
function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, "build", "icon.png"));
  return img.resize({ width: isMac ? 18 : 16, height: isMac ? 18 : 16 });
}
function buildTrayMenu() {
  const cfg = readConfig();
  const login = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: "打开 Life OS", click: () => showWindow() },
    { type: "separator" },
    { label: "写今天的日记", accelerator: cfg.shortcut, click: () => showWindow("/journal?write=1") },
    { label: "和搭档对话", click: () => showWindow("/chat") },
    { label: "记忆审核", click: () => showWindow("/memory") },
    { type: "separator" },
    { label: "开机自动启动", type: "checkbox", checked: login, click: (m) => { setOpenAtLogin(m.checked); } },
    { label: "关闭窗口时留在托盘", type: "checkbox", checked: cfg.closeToTray, click: (m) => { writeConfig({ closeToTray: m.checked }); } },
    { type: "separator" },
    { label: "退出 Life OS", click: () => { quitting = true; app.quit(); } },
  ]);
}
function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip("Life OS");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => { if (!isMac) showWindow(); });
}
const refreshTray = () => tray?.setContextMenu(buildTrayMenu());

/* ---------------- 开机自启 ---------------- */
function setOpenAtLogin(on) {
  app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true, args: ["--hidden"] });
  refreshTray();
}

/* ---------------- 全局快捷键 ---------------- */
function registerShortcut() {
  globalShortcut.unregisterAll();
  const acc = readConfig().shortcut;
  if (!acc) return { ok: true };
  try {
    const ok = globalShortcut.register(acc, () => showWindow("/journal?write=1"));
    return ok ? { ok: true } : { ok: false, error: "快捷键被其他程序占用" };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
}

/* ---------------- 系统通知 ---------------- */
function notify(title, body, route) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, "build", "icon.png"), silent: false });
  if (route) n.on("click", () => showWindow(route));
  n.show();
}

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** 每 5 分钟看一次：新记忆待审核、新复盘、晚上提醒写日记 */
async function pollNotifications() {
  const cfg = readConfig();
  let d;
  try { d = await apiGet("/api/dashboard"); } catch { return; }
  const seen = cfg.seen ?? {};
  const next = { ...seen };

  if (typeof d.inbox === "number") {
    if (cfg.notify.memory && seen.inbox !== undefined && d.inbox > seen.inbox) {
      notify("有新的记忆待审核", `搭档从日记和对话里发现了 ${d.inbox - seen.inbox} 条新事实，确认后才会写入。`, "/memory");
    }
    next.inbox = d.inbox;
  }
  const latest = Array.isArray(d.reviews) && d.reviews[0] ? d.reviews[0].path : null;
  if (latest) {
    if (cfg.notify.review && seen.review && latest !== seen.review) notify("复盘草稿已生成", `${d.reviews[0].title}，去看看并修改定稿吧。`, "/reviews");
    next.review = latest;
  }
  const today = todayStr();
  const [hh, mm] = String(cfg.notify.journalTime || "21:30").split(":").map(Number);
  const now = new Date();
  const due = now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
  if (cfg.notify.journal && due && d.hasJournal === false && seen.journalReminded !== today) {
    notify("今天还没写日记", "花两分钟，记下今天的状态和一件小事。", "/journal?write=1");
    next.journalReminded = today;
  }
  if (JSON.stringify(next) !== JSON.stringify(seen)) writeConfig({ seen: next });
}

/* ---------------- 检查更新（GitHub Releases） ---------------- */
function cmpVer(a, b) {
  const pa = a.replace(/^v/, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = b.replace(/^v/, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0); }
  return 0;
}
function checkUpdate() {
  return new Promise((resolve) => {
    const req = https.get(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { "User-Agent": "LifeOS-Desktop", Accept: "application/vnd.github+json" } }, (res) => {
      let buf = "";
      res.on("data", (d) => { buf += d; });
      res.on("end", () => {
        if (res.statusCode !== 200) return resolve({ ok: false, error: res.statusCode === 404 ? "没有找到公开发布的版本" : `GitHub 返回 ${res.statusCode}` });
        try {
          const j = JSON.parse(buf);
          const latest = String(j.tag_name || "").replace(/^v/, "");
          resolve({ ok: true, current: app.getVersion(), latest, url: j.html_url, newer: !!latest && cmpVer(latest, app.getVersion()) > 0, notes: j.body?.slice(0, 500) ?? "" });
        } catch (e) { resolve({ ok: false, error: String(e) }); }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(10000, () => req.destroy(new Error("连接超时")));
  });
}
async function autoCheckUpdate() {
  const cfg = readConfig();
  if (DEV || !cfg.checkUpdates) return;
  if (cfg.lastUpdateCheck && Date.now() - cfg.lastUpdateCheck < 24 * 3600e3) return;
  writeConfig({ lastUpdateCheck: Date.now() });
  const r = await checkUpdate();
  if (r.ok && r.newer && cfg.skipVersion !== r.latest) {
    const n = new Notification({ title: `Life OS ${r.latest} 可以更新了`, body: "点击查看新版本并下载安装包。" });
    n.on("click", () => void shell.openExternal(r.url));
    n.show();
  }
}

/* ---------------- 渲染进程调用 ---------------- */
ipcMain.on("lifeos:theme", (e, theme) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (isWin && w && !w.isDestroyed()) w.setTitleBarOverlay(titleBarColors(theme === "dark"));
});
ipcMain.handle("lifeos:getSettings", () => {
  const cfg = readConfig();
  return {
    version: app.getVersion(),
    platform: process.platform,
    dev: DEV,
    dataDir: DEV ? "（开发模式：使用项目里的 vault）" : cfg.dataDir,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    closeToTray: cfg.closeToTray,
    shortcut: cfg.shortcut,
    notify: cfg.notify,
    checkUpdates: cfg.checkUpdates,
    logsDir: app.getPath("logs"),
  };
});
ipcMain.handle("lifeos:setSettings", (_e, patch) => {
  const res = {};
  if ("openAtLogin" in patch) setOpenAtLogin(!!patch.openAtLogin);
  const keep = {};
  if ("closeToTray" in patch) keep.closeToTray = !!patch.closeToTray;
  if ("checkUpdates" in patch) keep.checkUpdates = !!patch.checkUpdates;
  if ("notify" in patch) keep.notify = { ...readConfig().notify, ...patch.notify };
  if ("shortcut" in patch) keep.shortcut = String(patch.shortcut || "");
  if (Object.keys(keep).length) writeConfig(keep);
  if ("shortcut" in patch) Object.assign(res, registerShortcut());
  refreshTray();
  return res;
});
ipcMain.handle("lifeos:changeDataDir", () => (DEV ? { changed: false, error: "开发模式下数据目录由项目决定" } : changeDataDir()));
ipcMain.handle("lifeos:openPath", (_e, which) => {
  const cfg = readConfig();
  const p = which === "logs" ? app.getPath("logs") : which === "data" ? cfg.dataDir : null;
  if (p) void shell.openPath(p);
});
ipcMain.handle("lifeos:checkUpdate", () => checkUpdate());
ipcMain.handle("lifeos:openExternal", (_e, url) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); });
ipcMain.handle("lifeos:testNotification", () => notify("通知测试", "能看到这条，说明系统通知正常。", "/"));

/* ---------------- 菜单：Mac 需要「编辑」菜单才能复制粘贴 ---------------- */
function setMenu() {
  if (!isMac) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "editMenu" },
    { label: "视图", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
  ]));
}

/* ---------------- 启动 ---------------- */
let booted = false;
async function boot(route) {
  const w = createWindow();
  await w.loadFile(path.join(__dirname, "splash.html"));

  if (!booted) {
    booted = true;
    if (!DEV) {
      const dataDir = await ensureDataDir();
      if (!dataDir) return;
      token = crypto.randomBytes(24).toString("hex");
      try {
        baseUrl = await startServer(dataDir);
      } catch (e) {
        dialog.showErrorBox("Life OS 启动失败", String(e?.message ?? e));
        quitting = true;
        app.quit();
        return;
      }
      // 只有这个窗口带着令牌 Cookie：电脑上其他程序 / 网页访问这个端口都会被拒绝
      await session.defaultSession.cookies.set({ url: baseUrl, name: "lifeos_token", value: token, httpOnly: true, sameSite: "strict" });
    }
    createTray();
    const sc = registerShortcut();
    if (!sc.ok) console.warn("[life-os] 快捷键注册失败：", sc.error);
    setTimeout(() => void pollNotifications(), 20 * 1000);
    setInterval(() => void pollNotifications(), 5 * 60 * 1000);
    setTimeout(() => void autoCheckUpdate(), 60 * 1000);
  }
  if (win && !win.isDestroyed()) await win.loadURL(baseUrl + (route ?? ""));
}

app.whenReady().then(() => { setMenu(); return boot(); });

// Mac：点 Dock 图标时重新显示窗口
app.on("activate", () => showWindow());
// 有托盘时窗口全关也不退出（托盘里「退出」才真正退出）
app.on("window-all-closed", () => { if (!isMac && (!tray || !readConfig().closeToTray)) { quitting = true; app.quit(); } });
app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => { globalShortcut.unregisterAll(); server?.kill(); });
