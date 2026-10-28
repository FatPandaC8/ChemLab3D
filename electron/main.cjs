"use strict";

/**
 * Electron shell for the offline build.
 *
 * The renderer is the same Vite build used in a browser. It is served from a
 * loopback HTTP server instead of `file://` because Chromium only grants
 * camera access to secure origins; `http://127.0.0.1` qualifies.
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  app,
  BrowserWindow,
  dialog,
  Menu,
  session,
  shell,
} = require("electron");
const { startStaticServer } = require("./static-server.cjs");

const DIST_DIR = path.join(__dirname, "..", "dist");
const INDEX_FILE = path.join(DIST_DIR, "index.html");

let staticServer = null;
let mainWindow = null;

function isAppOrigin(value) {
  if (!staticServer || !value) {
    return false;
  }
  try {
    return new URL(value).origin === staticServer.origin;
  } catch {
    return false;
  }
}

function configurePermissions() {
  // Camera and microphone are the only capabilities the app needs. Keep the
  // grants scoped to the local renderer origin rather than to every page.
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const origin =
        details?.requestingUrl || webContents.getURL() || "";
      callback(permission === "media" && isAppOrigin(origin));
    },
  );

  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin) =>
      permission === "media" && isAppOrigin(requestingOrigin),
  );
}

function createWindow() {
  if (!fs.existsSync(INDEX_FILE)) {
    dialog.showErrorBox(
      "ChemLab 3D build missing",
      "The renderer build was not found in dist/. Run `npm run build` before starting the desktop app.",
    );
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 1000,
    minWidth: 920,
    minHeight: 700,
    show: false,
    backgroundColor: "#060b11",
    title: "ChemLab 3D",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAppOrigin(url)) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(staticServer.url);
}

app.whenReady().then(async () => {
  try {
    staticServer = await startStaticServer(DIST_DIR);
    configurePermissions();
    createWindow();
  } catch (error) {
    dialog.showErrorBox(
      "ChemLab 3D could not start",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void staticServer?.close();
  staticServer = null;
});
