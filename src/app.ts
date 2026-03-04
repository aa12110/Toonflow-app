import "./logger";
import "./err";
import "./env";
import express, { Request, Response, NextFunction } from "express";
import expressWs from "express-ws";
import logger from "morgan";
import cors from "cors";
import buildRoute from "@/core";
import fs from "fs";
import path from "path";
import u from "@/utils";
import jwt from "jsonwebtoken";

const app = express();
let server: ReturnType<typeof app.listen> | null = null;
let appInitialized = false;

async function initApp(): Promise<void> {
  if (appInitialized) return;

  if (process.env.NODE_ENV == "dev") await buildRoute();

  expressWs(app);

  app.use(logger("dev"));
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));

  let rootDir: string;
  if (typeof process.versions?.electron !== "undefined") {
    const { app } = require("electron");
    const userDataDir: string = app.getPath("userData");
    rootDir = path.join(userDataDir, "uploads");
  } else {
    rootDir = path.join(process.cwd(), "uploads");
  }

  // 确保 uploads 目录存在
  if (!fs.existsSync(rootDir)) {
    fs.mkdirSync(rootDir, { recursive: true });
  }
  console.log("文件目录:", rootDir);

  app.use(express.static(rootDir));

  app.use(async (req, res, next) => {
    const setting = await u.db("t_setting").where("id", 1).select("tokenKey").first();
    if (!setting) return res.status(500).send({ message: "服务器未配置，请联系管理员" });
    const { tokenKey } = setting;
    // 从 header 或 query 参数获取 token
    const rawToken = req.headers.authorization || (req.query.token as string) || "";
    const token = rawToken.replace("Bearer ", "");
    // 白名单路径
    if (req.path === "/other/login") return next();

    if (!token) return res.status(401).send({ message: "未提供token" });
    try {
      const decoded = jwt.verify(token, tokenKey as string);
      (req as any).user = decoded;
      next();
    } catch (err) {
      return res.status(401).send({ message: "无效的token" });
    }
  });

  const router = await import("@/router");
  await router.default(app);

  // 404 处理
  app.use((_, res, next: NextFunction) => {
    return res.status(404).send({ message: "Not Found" });
  });

  // 错误处理
  app.use((err: any, _: Request, res: Response, __: NextFunction) => {
    res.locals.message = err.message;
    res.locals.error = err;
    console.error(err);
    res.status(err.status || 500).send(err);
  });

  appInitialized = true;
}

export default async function startServe(randomPort: boolean = false): Promise<number> {
  await initApp();

  const configuredPort = Number.parseInt(process.env.PORT || "60000", 10);
  const defaultPort = Number.isNaN(configuredPort) ? 60000 : configuredPort;
  const port = randomPort ? 0 : defaultPort;

  return await new Promise<number>((resolve, reject) => {
    let settled = false;
    let nextServer: ReturnType<typeof app.listen> | null = null;

    const cleanup = () => {
      if (!nextServer) return;
      nextServer.removeListener("error", onError);
      nextServer.removeListener("listening", onListening);
    };

    const safeReject = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (server === nextServer) server = null;
      reject(err);
    };

    const onError = (err: Error) => {
      safeReject(err);
    };

    const onListening = () => {
      if (!nextServer) {
        safeReject(new Error("服务启动对象不存在"));
        return;
      }

      const address = nextServer.address();
      const realPort = typeof address === "string" ? defaultPort : address?.port;

      if (typeof realPort !== "number" || Number.isNaN(realPort)) {
        safeReject(new Error("无法获取服务监听端口"));
        return;
      }

      if (settled) return;
      settled = true;
      cleanup();
      console.log(`[服务启动成功]: http://localhost:${realPort}`);
      resolve(realPort);
    };

    try {
      nextServer = app.listen(port);
      server = nextServer;
      nextServer.once("error", onError);
      nextServer.once("listening", onListening);
    } catch (err) {
      safeReject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// 支持await关闭
export function closeServe(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      server.close((err?: Error) => {
        if (err) {
          const serverError = err as NodeJS.ErrnoException;
          if (serverError.code !== "ERR_SERVER_NOT_RUNNING") {
            return reject(err);
          }
        }

        server = null;
        console.log("[服务已关闭]");
        resolve();
      });
    } else {
      resolve();
    }
  });
}

const isElectron = typeof process.versions?.electron !== "undefined";
if (!isElectron) {
  void startServe().catch((err) => {
    console.error("[服务启动失败]:", err);
  });
}
