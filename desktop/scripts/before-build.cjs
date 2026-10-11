// 返回 false：告诉 electron-builder 不要收集 / 重建依赖。
// 桌面壳只用 electron 和 Node 内置模块；网页服务的依赖已在 resources/server/node_modules 里。
// 不加这个，它会找到项目根目录的 node_modules，把全部网页依赖打进 app.asar。
module.exports = () => false;
