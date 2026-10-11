/* 预加载：只暴露极少的桌面能力，页面仍然是普通网页 */
const { contextBridge, ipcRenderer } = require("electron");

const platform = process.platform;

contextBridge.exposeInMainWorld("lifeosDesktop", {
  platform,
  /** 页面主题切换时通知主进程（Windows 标题栏按钮跟着变色） */
  setTheme: (theme) => ipcRenderer.send("lifeos:theme", theme === "dark" ? "dark" : "light"),
  /** 托盘 / 快捷键 / 通知点击后跳转到某个页面 */
  onNavigate: (cb) => {
    const h = (_e, route) => cb(route);
    ipcRenderer.on("lifeos:navigate", h);
    return () => ipcRenderer.removeListener("lifeos:navigate", h);
  },
  getSettings: () => ipcRenderer.invoke("lifeos:getSettings"),
  setSettings: (patch) => ipcRenderer.invoke("lifeos:setSettings", patch),
  changeDataDir: () => ipcRenderer.invoke("lifeos:changeDataDir"),
  openPath: (which) => ipcRenderer.invoke("lifeos:openPath", which),
  checkUpdate: () => ipcRenderer.invoke("lifeos:checkUpdate"),
  openExternal: (url) => ipcRenderer.invoke("lifeos:openExternal", url),
  testNotification: () => ipcRenderer.invoke("lifeos:testNotification"),
});

// 给 <html> 加平台标记，样式里据此留出红绿灯 / 窗口按钮的位置
window.addEventListener("DOMContentLoaded", () => {
  const c = document.documentElement.classList;
  c.add("desktop", platform === "darwin" ? "desktop-mac" : platform === "win32" ? "desktop-win" : "desktop-linux");
});
