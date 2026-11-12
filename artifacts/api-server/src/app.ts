import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const localWebRoot = process.env.LOCAL_APP_STATIC_DIR
  ? path.resolve(process.env.LOCAL_APP_STATIC_DIR)
  : null;

if (localWebRoot) {
  app.use(express.static(localWebRoot, { index: false }));
}

app.use("/api", router);

if (localWebRoot) {
  app.use((req, res, next) => {
    if (
      req.method !== "GET" ||
      req.path === "/api" ||
      req.path.startsWith("/api/")
    ) {
      next();
      return;
    }
    res.sendFile(path.join(localWebRoot, "index.html"));
  });
}

export default app;
