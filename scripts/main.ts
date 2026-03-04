import { app, BrowserWindow, ipcMain } from "electron";
import net from "net";
import path from "path";
import startServe, { closeServe } from "src/app";

// 默认端口配置
const defaultPort = 60000;

type BackendRuntimeConfig = {
  baseUrl: string;
  wsBaseUrl: string;
};

const toBackendRuntimeConfig = (port: number): BackendRuntimeConfig => ({
  baseUrl: `http://localhost:${port}`,
  wsBaseUrl: `ws://localhost:${port}`,
});

let backendRuntimeConfig: BackendRuntimeConfig = toBackendRuntimeConfig(defaultPort);

const getIsDev = (): boolean => process.env.NODE_ENV === "dev" || !app.isPackaged;

const getHtmlPath = (): string => {
  if (getIsDev()) {
    return path.join(process.cwd(), "scripts", "web", "index.html");
  }
  return path.join(app.getAppPath(), "scripts", "web", "index.html");
};

const getPreloadPath = (): string => {
  if (getIsDev()) {
    return path.join(process.cwd(), "scripts", "preload.js");
  }
  return path.join(app.getAppPath(), "scripts", "preload.js");
};

const isPortOccupied = async (port: number): Promise<boolean> => {
  return await new Promise((resolve) => {
    const tester = net.createServer();

    tester.once("error", () => {
      resolve(true);
    });

    tester.once("listening", () => {
      tester.close(() => resolve(false));
    });

    tester.listen(port);
  });
};

function createMainWindow(config: BackendRuntimeConfig): void {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath(),
    },
  });

  const htmlPath = getHtmlPath();
  const url = new URL(`file://${htmlPath}`);
  // 保留 query 兜底兼容，主通道改为 preload + contextIsolation
  url.searchParams.set("baseUrl", config.baseUrl);
  url.searchParams.set("wsBaseUrl", config.wsBaseUrl);

  void win.loadURL(url.toString());
}

const startBackendWithFallback = async (): Promise<BackendRuntimeConfig> => {
  const occupied = await isPortOccupied(defaultPort);
  if (occupied) {
    console.warn(`[固定端口 ${defaultPort} 已占用，回退随机端口]`);
    const randomPort = await startServe(true);
    return toBackendRuntimeConfig(randomPort);
  }

  try {
    const fixedPort = await startServe(false);
    return toBackendRuntimeConfig(fixedPort);
  } catch (fixedPortError) {
    console.warn("[固定端口启动失败，回退随机端口]:", fixedPortError);
    const randomPort = await startServe(true);
    return toBackendRuntimeConfig(randomPort);
  }
};

app.whenReady().then(async () => {
  ipcMain.handle("app:get-backend-config", async () => ({ ...backendRuntimeConfig }));

  try {
    backendRuntimeConfig = await startBackendWithFallback();
  } catch (err) {
    console.error("[服务启动失败]:", err);
    backendRuntimeConfig = toBackendRuntimeConfig(defaultPort);
  }

  createMainWindow(backendRuntimeConfig);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow(backendRuntimeConfig);
  }
});

app.on("before-quit", async () => {
  ipcMain.removeHandler("app:get-backend-config");
  try {
    await closeServe();
  } catch (err) {
    console.warn("[服务关闭失败]:", err);
  }
});
