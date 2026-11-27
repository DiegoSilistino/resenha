// Resenha para Windows: o site numa janela própria. O que o navegador não dá, o app dá: push-to-talk
// com o jogo em foco, ícone na bandeja (fechar não derruba a chamada) e a janela aparecendo quando ligam.
const { app, BrowserWindow, Menu, Tray, desktopCapturer, ipcMain, nativeImage, screen, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

let uIOhook = null;
let UiohookKey = {};
try {
  ({ uIOhook, UiohookKey } = require("uiohook-napi"));
} catch {
  // sem o módulo nativo: o push-to-talk continua valendo com a janela do Resenha em foco
}

/** Endereço gravado no build (variável RESENHA_URL do GitHub); sem ele, o app pergunta na primeira vez. */
const BAKED_URL = require("./config.json").url || "";
const configFile = () => path.join(app.getPath("userData"), "endereco.json");

function savedUrl() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8")).url || "";
  } catch {
    return "";
  }
}
const siteUrl = () => BAKED_URL || savedUrl();

/** Só o próprio site ganha permissões, ponte e navegação dentro do app; o resto abre no navegador. */
function fromSite(url) {
  const site = siteUrl();
  if (!site || !url) return false;
  try {
    return new URL(url).origin === new URL(site).origin;
  } catch {
    return false;
  }
}

const iconPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, "icon.png") : path.join(__dirname, "../web/public/icon-192.png");

let win = null;
let tray = null;
let quitting = false;

/** Aberto com o Windows (escondido): maximiza só quando a pessoa abrir; maximizar antes mostraria a janela. */
let maximizeOnShow = false;

function show(focus = true) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (focus) {
    win.show();
    if (maximizeOnShow) win.maximize();
    maximizeOnShow = false;
    win.focus();
  } else if (!win.isVisible()) {
    win.showInactive();
  }
  if (!focus && !win.isFocused()) win.flashFrame(true);
}

/** Tamanho e posição em que a pessoa deixou a janela; na primeira vez, quase a tela toda. */
const boundsFile = () => path.join(app.getPath("userData"), "janela.json");

function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), "utf8"));
    // monitor que sumiu (notebook fora da dock): só vale se a janela ainda cabe em alguma tela
    const visible = screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
    return visible ? b : null;
  } catch {
    return null;
  }
}

function initialBounds() {
  const saved = savedBounds();
  if (saved) return saved;
  const { workArea: a } = screen.getPrimaryDisplay();
  const width = Math.round(a.width * 0.9);
  const height = Math.round(a.height * 0.9);
  return { x: a.x + Math.round((a.width - width) / 2), y: a.y + Math.round((a.height - height) / 2), width, height, maximized: false };
}

function rememberBounds() {
  if (!win) return;
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {
    // sem conseguir gravar, a próxima abertura usa o tamanho padrão
  }
}

function createWindow() {
  const { maximized, ...bounds } = initialBounds();
  win = new BrowserWindow({
    ...bounds,
    show: false,
    minWidth: 940,
    minHeight: 600,
    title: "Resenha",
    icon: iconPath(),
    backgroundColor: "#09090b",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      // escondido na bandeja continua tocando chamada, mantendo a conexão e a voz
      backgroundThrottling: false,
    },
  });
  if (process.argv.includes(LOGIN_ARG)) {
    maximizeOnShow = maximized; // ligou junto com o Windows: fica só na bandeja
  } else {
    if (maximized) win.maximize();
    win.show();
  }
  const url = siteUrl();
  if (url) void win.loadURL(url);
  else void win.loadFile(path.join(__dirname, "setup.html"));

  // fechar só esconde (a chamada continua, como no Discord); sair é pela bandeja
  win.on("close", (e) => {
    rememberBounds();
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on("focus", () => win.flashFrame(false));
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, target) => {
    if (fromSite(target)) return;
    e.preventDefault();
    if (/^https?:/i.test(target)) void shell.openExternal(target);
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }));
  tray.setToolTip("Resenha");
  const items = [{ label: "Abrir o Resenha", click: () => show(true) }];
  if (!BAKED_URL) {
    items.push({
      label: "Trocar o endereço do Resenha",
      click: () => {
        fs.rmSync(configFile(), { force: true });
        void win.loadFile(path.join(__dirname, "setup.html"));
        show(true);
      },
    });
  }
  items.push({ type: "separator" }, { label: "Sair", click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.on("click", () => show(true));
}

/** Escolha do que mostrar na chamada: telas primeiro, depois as janelas abertas. */
function pickSource(sources) {
  return new Promise((resolve) => {
    let picked = null;
    const item = (s) => ({ label: s.name.slice(0, 70) || "Sem nome", click: () => (picked = s) });
    const screens = sources.filter((s) => s.id.startsWith("screen:"));
    const windows = sources.filter((s) => s.id.startsWith("window:") && s.name !== "Resenha");
    const template = [{ label: "Tela inteira", enabled: false }, ...screens.map(item)];
    if (windows.length) template.push({ type: "separator" }, { label: "Só uma janela", enabled: false }, ...windows.map(item));
    // o clique chega logo depois de o menu fechar
    Menu.buildFromTemplate(template).popup({ window: win, callback: () => setTimeout(() => resolve(picked), 50) });
  });
}

/** O que o site escolheu na janela dele; vale só para o próximo pedido de transmissão. */
let chosenSourceId = null;

ipcMain.handle("screens:list", async (e) => {
  if (!fromSite(e.senderFrame?.url)) return [];
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  const own = win?.getMediaSourceId();
  // sobreposições e ajudantes invisíveis (NVIDIA, Epic…) chegam totalmente pretos: fora da lista, como no Discord
  const blank = (img) => img.isEmpty() || img.toBitmap().every((b, i) => i % 4 === 3 || b < 8);
  return sources
    .filter((s) => s.id !== own && (s.id.startsWith("screen:") || !blank(s.thumbnail)))
    .map((s) => ({
      id: s.id,
      name: s.name,
      screen: s.id.startsWith("screen:"),
      // JPEG: a lista se atualiza a cada poucos segundos, e PNG de cada janela pesaria
      thumbnail: s.thumbnail.isEmpty() ? null : `data:image/jpeg;base64,${s.thumbnail.toJPEG(70).toString("base64")}`,
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }));
});

ipcMain.handle("screens:choose", (e, id) => {
  if (fromSite(e.senderFrame?.url)) chosenSourceId = typeof id === "string" ? id : null;
});

function setupSession() {
  // display-capture: sem ela o Electron recusa o "Mostrar tela" antes de chegar à escolha abaixo
  const allowed = new Set(["media", "display-capture", "notifications", "fullscreen", "clipboard-sanitized-write", "speaker-selection"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) =>
    cb(allowed.has(permission) && fromSite(details.requestingUrl)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && fromSite(origin));

  // "Mostrar tela": o Electron não tem a janela de escolha do navegador. O site mostra a dele (como a
  // do Discord) e avisa aqui o que foi escolhido; site antigo, ou janela que fechou nesse meio-tempo, cai no menu.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!fromSite(request.securityOrigin)) return callback({});
    const wanted = chosenSourceId;
    chosenSourceId = null;
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
    const chosen = sources.find((s) => s.id === wanted) ?? (await pickSource(sources));
    if (!chosen) return callback({});
    // som do computador inteiro (Windows); inclui o que toca no próprio Resenha
    callback(request.audioRequested && process.platform === "win32" ? { video: chosen, audio: "loopback" } : { video: chosen });
  });
}

// ---------------------------------------------------------------- push-to-talk com outra janela em foco

/** KeyboardEvent.code (o que o site guarda) -> tecla do uiohook. */
const MODIFIERS = {
  ControlLeft: "Ctrl",
  ControlRight: "CtrlRight",
  AltLeft: "Alt",
  AltRight: "AltRight",
  ShiftLeft: "Shift",
  ShiftRight: "ShiftRight",
  MetaLeft: "Meta",
  MetaRight: "MetaRight",
};
const toUiohook = (code) => (code ? (UiohookKey[MODIFIERS[code] ?? code.replace(/^(Key|Digit)/, "")] ?? null) : null);

let pttKey = null;
let pttDown = false;

function sendPtt(down) {
  if (pttDown === down) return;
  pttDown = down;
  win?.webContents.send("ptt", down);
}

function setupPushToTalk() {
  if (!uIOhook) return;
  // com a janela do Resenha em foco quem cuida é o próprio site (ele ignora a tecla enquanto você digita)
  uIOhook.on("keydown", (e) => {
    if (pttKey !== null && e.keycode === pttKey && win && !win.isFocused()) sendPtt(true);
  });
  uIOhook.on("keyup", (e) => {
    if (pttKey !== null && e.keycode === pttKey) sendPtt(false);
  });
  uIOhook.start();
}

ipcMain.on("ptt:key", (e, code) => {
  if (!fromSite(e.senderFrame?.url)) return;
  pttKey = toUiohook(code);
  sendPtt(false);
});

ipcMain.on("win:show", (e, focus) => {
  if (fromSite(e.senderFrame?.url)) show(!!focus);
});

ipcMain.handle("setup:url", (e, raw) => {
  if (!e.senderFrame?.url.startsWith("file:")) return "Não permitido";
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return "Esse endereço não parece certo. Copie o que aparece no navegador.";
  }
  if (!/^https?:$/.test(url.protocol)) return "Use um endereço que comece com https://";
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify({ url: url.origin }));
  void win.loadURL(url.origin);
  return null;
});

// ---------------------------------------------------------------- iniciar com o Windows

/** Marca de quando o Windows abre o app no login: aí ele começa só na bandeja, como o Discord. */
const LOGIN_ARG = "--hidden";

// Fica no registro do Windows (HKCU\...\Run), não nas configurações do site: vale para este PC.
// executableWillLaunchAtLogin também enxerga quando a pessoa desligou pelo Gerenciador de Tarefas.
ipcMain.handle("login:get", (e) =>
  fromSite(e.senderFrame?.url) && app.isPackaged
    ? app.getLoginItemSettings({ args: [LOGIN_ARG] }).executableWillLaunchAtLogin
    : false,
);
ipcMain.handle("login:set", (e, on) => {
  // fora do instalador o caminho gravado seria o electron.exe de desenvolvimento
  if (fromSite(e.senderFrame?.url) && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!on, args: [LOGIN_ARG] });
});

// ---------------------------------------------------------------- atualização automática

// Baixa sozinho a versão nova (Release do GitHub, latest.yml) e instala por cima ao clicar em Atualizar
// ou ao sair pela bandeja. Endereço, janela, login e configurações ficam em userData (%APPDATA%),
// que a instalação não toca.
let updateReady = null;

function setupUpdates() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    return;
  }
  autoUpdater.on("update-downloaded", (info) => {
    updateReady = info.version;
    win?.webContents.send("update:ready", updateReady);
  });
  autoUpdater.on("error", () => undefined); // sem internet ou GitHub fora do ar: tenta de novo na próxima hora
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, 60 * 60 * 1000);
  ipcMain.on("update:install", (e) => {
    // silencioso e abrindo de novo no fim; o before-quit libera o fechamento da janela
    if (fromSite(e.senderFrame?.url) && updateReady) autoUpdater.quitAndInstall(true, true);
  });
}

ipcMain.handle("update:status", (e) => (fromSite(e.senderFrame?.url) ? { version: app.getVersion(), ready: updateReady } : null));

// ---------------------------------------------------------------- início

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => show(true));
  app.on("before-quit", () => {
    quitting = true;
    rememberBounds();
    uIOhook?.stop();
  });
  app.setAppUserModelId("br.resenha.desktop"); // notificações do Windows com o nome e o ícone do app
  app.whenReady().then(() => {
    setupSession();
    createWindow();
    createTray();
    setupPushToTalk();
    setupUpdates();
  });
}
