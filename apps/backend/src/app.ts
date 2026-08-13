import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import Redis from "ioredis";
import { z } from "zod";
import { AuthRequest, requireAuth, requireWorker, signToken } from "./auth";
import { config } from "./config";
import { pool, query, transaction } from "./db";
import { publishRenderJob } from "./queue";
import { createDownloadUrl, createUploadUrl } from "./storage";
import { sendVideoReadyEmail } from "./email";

const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const asyncRoute = (fn: (req: any, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => void fn(req, res, next).catch(next);

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  displayName: z.string().min(2).max(80),
});
const loginSchema = z.object({ email: z.email(), password: z.string().min(1) });
const projectSchema = z.object({ title: z.string().min(2).max(160), topic: z.string().max(120).optional() });
const presignSchema = z.object({
  projectId: z.uuid(),
  fileName: z.string().min(1).max(255),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});
const assetSchema = z.object({
  objectKey: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().max(25 * 1024 * 1024),
});
const renderSchema = z.object({
  topic: z.string().max(120).default("Storytelling"),
  voice: z.string().max(80).default("vi-VN-HoaiMyNeural"),
  imageDuration: z.number().min(1).max(10).default(3),
  resolution: z.enum(["720p", "1080p"]).default("720p"),
});
const progressSchema = z.object({
  status: z.enum(["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "CANCELED"]),
  progress: z.number().int().min(0).max(100),
  stage: z.string().min(1).max(80),
  message: z.string().max(500).optional(),
  outputKey: z.string().optional(),
  errorCode: z.string().max(120).optional(),
});

function safeFileName(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
}

async function ownedProject(projectId: string, userId: string) {
  const result = await query("SELECT * FROM projects WHERE id = $1 AND user_id = $2", [projectId, userId]);
  return result.rows[0];
}

export function createApp() {
  const app = express();
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", asyncRoute(async (_req, res) => {
    await pool.query("SELECT 1");
    await redis.ping();
    res.json({ status: "ok", service: "backend" });
  }));

  app.post("/api/auth/register", asyncRoute(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    try {
      const result = await query<{ id: string; email: string; display_name: string; role: string; credits: number }>(
        `INSERT INTO users(email, password_hash, display_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, display_name, role, credits`,
        [input.email.toLowerCase(), passwordHash, input.displayName],
      );
      const user = result.rows[0];
      const token = signToken({ id: user.id, email: user.email, role: user.role });
      res.status(201).json({ token, user });
    } catch (error: any) {
      if (error.code === "23505") return res.status(409).json({ error: "EMAIL_EXISTS" });
      throw error;
    }
  }));

  app.post("/api/auth/login", asyncRoute(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await query<{ id: string; email: string; password_hash: string; display_name: string; role: string; credits: number }>(
      "SELECT id, email, password_hash, display_name, role, credits FROM users WHERE email = $1",
      [input.email.toLowerCase()],
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS" });
    }
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({ token, user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role, credits: user.credits } });
  }));

  app.post("/api/auth/google", asyncRoute(async (req, res) => {
    const { email, displayName } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "INVALID_EMAIL" });
    }
    const cleanEmail = email.toLowerCase().trim();
    const name = displayName || cleanEmail.split("@")[0];
    
    let result = await query<{ id: string; email: string; display_name: string; role: string; credits: number }>(
      "SELECT id, email, display_name, role, credits FROM users WHERE email = $1",
      [cleanEmail]
    );
    let user = result.rows[0];
    if (!user) {
      const dummyHash = await bcrypt.hash(crypto.randomUUID(), 10);
      const inserted = await query<{ id: string; email: string; display_name: string; role: string; credits: number }>(
        `INSERT INTO users(email, password_hash, display_name, credits)
         VALUES ($1, $2, $3, 10)
         RETURNING id, email, display_name, role, credits`,
        [cleanEmail, dummyHash, name]
      );
      user = inserted.rows[0];
    }
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({ token, user });
  }));

  app.get("/api/auth/me", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const result = await query("SELECT id, email, display_name, role, credits, created_at FROM users WHERE id = $1", [req.user!.id]);
    res.json({ user: result.rows[0] });
  }));

  app.get("/api/projects", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const result = await query(
      `SELECT p.*,
        (SELECT count(*)::int FROM project_assets a WHERE a.project_id = p.id) AS asset_count,
        (SELECT row_to_json(j) FROM (
          SELECT id, status, progress, stage, created_at FROM render_jobs
          WHERE project_id = p.id ORDER BY created_at DESC LIMIT 1
        ) j) AS latest_job
       FROM projects p WHERE p.user_id = $1 ORDER BY p.updated_at DESC`,
      [req.user!.id],
    );
    res.json({ projects: result.rows });
  }));

  app.post("/api/projects", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const input = projectSchema.parse(req.body);
    const result = await query(
      "INSERT INTO projects(user_id, title, topic) VALUES ($1, $2, $3) RETURNING *",
      [req.user!.id, input.title, input.topic ?? null],
    );
    res.status(201).json({ project: result.rows[0] });
  }));

  app.get("/api/projects/:projectId", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const project = await ownedProject(String(req.params.projectId), req.user!.id);
    if (!project) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });
    const [assets, jobs] = await Promise.all([
      query("SELECT * FROM project_assets WHERE project_id = $1 ORDER BY sequence_order, created_at", [project.id]),
      query("SELECT * FROM render_jobs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 20", [project.id]),
    ]);
    res.json({ project, assets: assets.rows, jobs: jobs.rows });
  }));

  app.post("/api/uploads/presign", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const input = presignSchema.parse(req.body);
    if (!(await ownedProject(input.projectId, req.user!.id))) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });
    const objectKey = `users/${req.user!.id}/projects/${input.projectId}/${crypto.randomUUID()}-${safeFileName(input.fileName)}`;
    const uploadUrl = await createUploadUrl(objectKey, input.contentType);
    res.json({ uploadUrl, objectKey, expiresIn: 900 });
  }));

  app.post("/api/projects/:projectId/assets", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const input = assetSchema.parse(req.body);
    const project = await ownedProject(String(req.params.projectId), req.user!.id);
    if (!project) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });
    if (!input.objectKey.startsWith(`users/${req.user!.id}/projects/${project.id}/`)) {
      return res.status(400).json({ error: "INVALID_OBJECT_KEY" });
    }
    const order = await query<{ next: number }>("SELECT count(*)::int AS next FROM project_assets WHERE project_id = $1", [project.id]);
    const result = await query(
      `INSERT INTO project_assets(project_id, object_key, file_name, content_type, size_bytes, sequence_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [project.id, input.objectKey, input.fileName, input.contentType, input.sizeBytes, order.rows[0].next],
    );
    await query("UPDATE projects SET updated_at = now() WHERE id = $1", [project.id]);
    res.status(201).json({ asset: result.rows[0] });
  }));

  app.post("/api/projects/:projectId/render", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const input = renderSchema.parse(req.body);
    const idempotencyKey = req.header("idempotency-key") ?? crypto.randomUUID();
    const result = await transaction(async (client) => {
      const projectResult = await client.query("SELECT * FROM projects WHERE id = $1 AND user_id = $2 FOR UPDATE", [req.params.projectId, req.user!.id]);
      const project = projectResult.rows[0];
      if (!project) throw Object.assign(new Error("PROJECT_NOT_FOUND"), { status: 404 });
      const existing = await client.query("SELECT * FROM render_jobs WHERE idempotency_key = $1", [idempotencyKey]);
      if (existing.rows[0]) return { job: existing.rows[0], assets: [], existing: true };
      const assets = await client.query("SELECT object_key, file_name, content_type FROM project_assets WHERE project_id = $1 ORDER BY sequence_order", [project.id]);
      if (!assets.rowCount) throw Object.assign(new Error("PROJECT_HAS_NO_ASSETS"), { status: 400 });
      const userResult = await client.query("SELECT credits FROM users WHERE id = $1 FOR UPDATE", [req.user!.id]);
      if (userResult.rows[0].credits < 1) throw Object.assign(new Error("INSUFFICIENT_CREDITS"), { status: 402 });
      await client.query("UPDATE users SET credits = credits - 1 WHERE id = $1", [req.user!.id]);
      const jobResult = await client.query(
        `INSERT INTO render_jobs(project_id, user_id, status, progress, stage, message, idempotency_key)
         VALUES ($1, $2, 'QUEUED', 2, 'queued', 'Đang chờ worker xử lý', $3) RETURNING *`,
        [project.id, req.user!.id, idempotencyKey],
      );
      const job = jobResult.rows[0];
      await client.query(
        "INSERT INTO transactions(user_id, job_id, kind, credits, description) VALUES ($1, $2, 'RENDER_DEBIT', -1, $3)",
        [req.user!.id, job.id, `Render project ${project.title}`],
      );
      await client.query("UPDATE projects SET status = 'RENDERING', config = $2, updated_at = now() WHERE id = $1", [project.id, JSON.stringify(input)]);
      return { job, project, assets: assets.rows, existing: false };
    });

    if (!result.existing) {
      try {
        await publishRenderJob({
          job_id: result.job.id,
          project_id: result.job.project_id,
          user_id: req.user!.id,
          assets: result.assets,
          config: input,
          trace_id: crypto.randomUUID(),
        });
        await redis.publish(`job:${result.job.id}`, JSON.stringify(result.job));
      } catch (error) {
        await failAndRefund(result.job.id, "QUEUE_UNAVAILABLE", "Không thể gửi tác vụ vào hàng đợi");
        throw error;
      }
    }
    res.status(result.existing ? 200 : 202).json({ job: result.job });
  }));

  app.get("/api/jobs/:jobId", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const result = await query("SELECT * FROM render_jobs WHERE id = $1 AND user_id = $2", [req.params.jobId, req.user!.id]);
    const job = result.rows[0];
    if (!job) return res.status(404).json({ error: "JOB_NOT_FOUND" });
    const downloadUrl = job.output_key ? await createDownloadUrl(job.output_key) : null;
    res.json({ job: { ...job, download_url: downloadUrl } });
  }));

  app.get("/api/jobs/:jobId/events", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const result = await query("SELECT * FROM render_jobs WHERE id = $1 AND user_id = $2", [req.params.jobId, req.user!.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "JOB_NOT_FOUND" });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(`data: ${JSON.stringify(result.rows[0])}\n\n`);
    const subscriber = redis.duplicate();
    await subscriber.subscribe(`job:${req.params.jobId}`);
    subscriber.on("message", (_channel, message) => res.write(`data: ${message}\n\n`));
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15000);
    req.on("close", () => {
      clearInterval(keepAlive);
      void subscriber.quit();
    });
  }));

  app.post("/internal/jobs/:jobId/progress", requireWorker, asyncRoute(async (req, res) => {
    const input = progressSchema.parse(req.body);
    const job = await transaction(async (client) => {
      const currentResult = await client.query("SELECT * FROM render_jobs WHERE id = $1 FOR UPDATE", [req.params.jobId]);
      const current = currentResult.rows[0];
      if (!current) throw Object.assign(new Error("JOB_NOT_FOUND"), { status: 404 });
      const terminal = ["COMPLETED", "FAILED", "CANCELED"].includes(current.status);
      if (terminal && current.status !== input.status) return current;
      const updated = await client.query(
        `UPDATE render_jobs SET status = $2::job_status, progress = $3, stage = $4, message = $5,
          output_key = COALESCE($6, output_key), error_code = COALESCE($7, error_code),
          started_at = CASE WHEN $2::job_status = 'PROCESSING'::job_status AND started_at IS NULL THEN now() ELSE started_at END,
          completed_at = CASE WHEN $2::job_status IN ('COMPLETED'::job_status,'FAILED'::job_status,'CANCELED'::job_status) THEN now() ELSE completed_at END,
          updated_at = now() WHERE id = $1 RETURNING *`,
        [req.params.jobId, input.status, input.progress, input.stage, input.message ?? null, input.outputKey ?? null, input.errorCode ?? null],
      );
      if (input.status === "FAILED" && !current.refunded_at) {
        await client.query("UPDATE users SET credits = credits + 1 WHERE id = $1", [current.user_id]);
        await client.query("UPDATE render_jobs SET refunded_at = now() WHERE id = $1", [current.id]);
        await client.query(
          "INSERT INTO transactions(user_id, job_id, kind, credits, description) VALUES ($1, $2, 'RENDER_REFUND', 1, $3)",
          [current.user_id, current.id, input.errorCode ?? "Render failed"],
        );
      }
      await client.query("UPDATE projects SET status = $2, updated_at = now() WHERE id = $1", [
        current.project_id,
        input.status === "COMPLETED" ? "COMPLETED" : input.status === "FAILED" ? "FAILED" : "RENDERING",
      ]);
      return updated.rows[0];
    });
    await redis.publish(`job:${job.id}`, JSON.stringify(job));
    if (job.status === "COMPLETED" && job.output_key) {
      void (async () => {
        try {
          const userRes = await query<{ email: string }>("SELECT email FROM users WHERE id = $1", [job.user_id]);
          const projectRes = await query<{ title: string }>("SELECT title FROM projects WHERE id = $1", [job.project_id]);
          const userEmail = userRes.rows[0]?.email;
          const projectTitle = projectRes.rows[0]?.title || "Dự án AI Video";
          if (userEmail) {
            const dlUrl = await createDownloadUrl(job.output_key);
            await sendVideoReadyEmail(userEmail, projectTitle, dlUrl);
          }
        } catch (err) {
          console.error("Failed to send video ready email:", err);
        }
      })();
    }
    res.json({ job });
  }));

  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "VALIDATION_ERROR", details: error.issues });
    const status = error.status ?? 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: error.message ?? "INTERNAL_ERROR" });
  });

  return app;
}

async function failAndRefund(jobId: string, errorCode: string, message: string) {
  await transaction(async (client) => {
    const current = await client.query("SELECT * FROM render_jobs WHERE id = $1 FOR UPDATE", [jobId]);
    const job = current.rows[0];
    if (!job || job.refunded_at) return;
    await client.query(
      "UPDATE render_jobs SET status = 'FAILED', progress = 100, stage = 'failed', message = $2, error_code = $3, refunded_at = now(), completed_at = now() WHERE id = $1",
      [jobId, message, errorCode],
    );
    await client.query("UPDATE users SET credits = credits + 1 WHERE id = $1", [job.user_id]);
    await client.query(
      "INSERT INTO transactions(user_id, job_id, kind, credits, description) VALUES ($1, $2, 'RENDER_REFUND', 1, $3)",
      [job.user_id, jobId, errorCode],
    );
  });
}

export async function closeAppResources() {
  await redis.quit();
}
