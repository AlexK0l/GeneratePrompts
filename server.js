import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { queue, createRedis } from "./src/queue.js";
import { buildWorkbookBuffer, safeFileName } from "./src/xlsx.js";
import { STEPS } from "./src/constants.js";

const app = express();
const redis = createRedis();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 10000);

app.use(express.json({ limit: "1mb" }));

function authorized(req) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return true;
  const supplied = String(req.get("x-app-password") || "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.use("/api", (req, res, next) => {
  if (req.path === "/config") return next();
  if (!authorized(req)) return res.status(401).json({ error: "Неверный код доступа" });
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sat-region-research" });
});

app.get("/api/config", (_req, res) => {
  res.json({
    authRequired: Boolean(process.env.APP_PASSWORD),
    steps: STEPS
  });
});

app.post("/api/jobs", async (req, res, next) => {
  try {
    const region = String(req.body?.region || "").trim();
    if (!region) return res.status(400).json({ error: "Регион обязателен" });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: "OPENAI_API_KEY не настроен на Render" });
    }

    const jobId = crypto.randomUUID();
    await redis.del(`cancel:${jobId}`);
    const job = await queue.add(
      "research",
      { region },
      {
        jobId,
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false
      }
    );

    res.status(202).json({ id: job.id, region });
  } catch (error) {
    next(error);
  }
});

app.get("/api/jobs/:id", async (req, res, next) => {
  try {
    const job = await queue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Задание не найдено" });

    const state = await job.getState();
    res.json({
      id: job.id,
      state,
      progress: job.progress || {},
      result: state === "completed" ? job.returnvalue : null,
      error: state === "failed" ? job.failedReason : null
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/jobs/:id/cancel", async (req, res, next) => {
  try {
    const job = await queue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Задание не найдено" });

    await redis.set(`cancel:${job.id}`, "1", "EX", 86400);
    const state = await job.getState();
    if (["waiting", "delayed", "paused"].includes(state)) {
      await job.remove().catch(() => {});
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/jobs/:id/download", async (req, res, next) => {
  try {
    const job = await queue.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Задание не найдено" });

    const state = await job.getState();
    if (state !== "completed") {
      return res.status(409).json({ error: "Итоговый файл ещё не готов" });
    }

    const resultKey = job.returnvalue?.resultKey;
    if (!resultKey) return res.status(500).json({ error: "Не найден ключ результата" });

    const raw = await redis.get(resultKey);
    if (!raw) return res.status(410).json({ error: "Срок хранения результата истёк" });

    const result = JSON.parse(raw);
    const buffer = buildWorkbookBuffer(result);
    const filename = safeFileName(job.returnvalue?.region || "result");

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  maxAge: process.env.NODE_ENV === "production" ? "5m" : 0
}));

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error?.message || "Внутренняя ошибка" });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`SAT research web service listening on ${port}`);
});

async function shutdown() {
  server.close(async () => {
    await Promise.allSettled([queue.close(), redis.quit()]);
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
