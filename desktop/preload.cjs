// Ponte entre o site e o app (o site lê window.resenhaDesktop; veja web/src/lib/desktop.ts).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("resenhaDesktop", {
  setPushToTalkKey: (code) => ipcRenderer.send("ptt:key", typeof code === "string" ? code : null),
  onPushToTalk: (cb) => {
    const listener = (_event, down) => cb(!!down);
    ipcRenderer.on("ptt", listener);
    return () => ipcRenderer.removeListener("ptt", listener);
  },
  show: (focus) => ipcRenderer.send("win:show", !!focus),
  listScreenSources: () => ipcRenderer.invoke("screens:list"),
  chooseScreenSource: (id) => ipcRenderer.invoke("screens:choose", String(id)),
  appUpdateStatus: () => ipcRenderer.invoke("update:status"),
  onAppUpdateReady: (cb) => {
    const listener = (_event, version) => cb(String(version));
    ipcRenderer.on("update:ready", listener);
    return () => ipcRenderer.removeListener("update:ready", listener);
  },
  installAppUpdate: () => ipcRenderer.send("update:install"),
  // só a tela de primeira configuração usa
  saveUrl: (url) => ipcRenderer.invoke("setup:url", String(url)),
});
