import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import Redis from "ioredis";
import { z } from "zod";
import { AuthRequest, requireAdmin, requireAuth, requireWorker, signToken } from "./auth";
import { config } from "./config";
import { pool, query, transaction } from "./db";
import { publishRenderJob } from "./queue";
import { createDownloadUrl, createUploadUrl } from "./storage";
import { sendVideoReadyEmail } from "./email";
import {
  buildVietQRUrl,
  buildVietQRUrlWithBank,
  buildVNPayUrl,
  completePaymentOrder,
  generateOrderCode,
  getBankConfig,
  PaymentOrder,
  setBankConfig,
  verifyVNPayHash,
} from "./payments";

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
    let cleanEmail = "";
    let name = "";

    if (req.body.credential) {
      try {
        const decoded: any = jwt.decode(req.body.credential);
        if (decoded && decoded.email) {
          cleanEmail = decoded.email.toLowerCase().trim();
          name = decoded.name || cleanEmail.split("@")[0];
        }
      } catch (e) {
        console.error("Failed to decode Google JWT token", e);
      }
    }

    if (!cleanEmail) {
      const { email, displayName } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ error: "INVALID_EMAIL" });
      }
      cleanEmail = email.toLowerCase().trim();
      name = displayName || cleanEmail.split("@")[0];
    }

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

  // DELETE ASSET API
  app.delete("/api/projects/:projectId/assets/:assetId", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const project = await query("SELECT id FROM projects WHERE id = $1 AND user_id = $2", [req.params.projectId, req.user!.id]);
    if (!project.rows[0]) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });

    await query("DELETE FROM project_assets WHERE id = $1 AND project_id = $2", [req.params.assetId, req.params.projectId]);
    await query("UPDATE projects SET updated_at = now() WHERE id = $1", [req.params.projectId]);
    res.json({ ok: true });
  }));

  // REORDER ASSETS API
  app.post("/api/projects/:projectId/assets/reorder", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const { assetIds } = req.body;
    if (!Array.isArray(assetIds)) return res.status(400).json({ error: "INVALID_ASSET_IDS" });

    const project = await query("SELECT id FROM projects WHERE id = $1 AND user_id = $2", [req.params.projectId, req.user!.id]);
    if (!project.rows[0]) return res.status(404).json({ error: "PROJECT_NOT_FOUND" });

    for (let i = 0; i < assetIds.length; i++) {
      await query("UPDATE project_assets SET sequence_order = $1 WHERE id = $2 AND project_id = $3", [i, assetIds[i], req.params.projectId]);
    }
    res.json({ ok: true });
  }));

  // USER TRANSACTIONS HISTORY API
  app.get("/api/auth/transactions", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const result = await query(
      "SELECT id, kind, credits, description, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
      [req.user!.id]
    );
    res.json({ transactions: result.rows });
  }));

  // BILLING & TOKEN PACKAGES API
  const TOKEN_PACKAGES = [
    {
      id: "pkg_starter",
      name: "Gói Dùng Thử",
      credits: 20,
      priceVnd: 49000,
      description: "Phù hợp để làm quen và trải nghiệm render video AI cơ bản.",
      badge: null,
    },
    {
      id: "pkg_pro",
      name: "Gói Tiêu Chuẩn",
      credits: 60,
      priceVnd: 129000,
      description: "Lựa chọn tốt nhất cho nhà sáng tạo nội dung cá nhân.",
      badge: "🔥 Phổ Biến Nhất",
    },
    {
      id: "pkg_studio",
      name: "Gói Nhà Sáng Tạo",
      credits: 150,
      priceVnd: 279000,
      description: "Dành cho shop bán hàng, affiliate và kênh video chuyên nghiệp.",
      badge: "⭐ Tiết Kiệm 35%",
    },
    {
      id: "pkg_enterprise",
      name: "Gói Doanh Nghiệp",
      credits: 500,
      priceVnd: 799000,
      description: "Không giới hạn sản xuất video AI số lượng lớn với tốc độ tối đa.",
      badge: "💎 VIP / Studio",
    },
  ];

  app.get("/api/billing/packages", requireAuth, asyncRoute(async (_req, res) => {
    res.json({ packages: TOKEN_PACKAGES });
  }));

  // CREATE PAYMENT ORDER API
  app.post("/api/billing/create-order", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const { packageId, gateway = "VIETQR" } = req.body;
    const selectedPackage = TOKEN_PACKAGES.find((p) => p.id === packageId);
    if (!selectedPackage) {
      return res.status(400).json({ error: "INVALID_PACKAGE", message: "Gói Token không hợp lệ." });
    }

    const validGateways = ["VIETQR", "VNPAY", "MOMO", "SANDBOX"];
    const chosenGateway = validGateways.includes(gateway) ? gateway : "VIETQR";
    const orderCode = generateOrderCode();

    const orderResult = await query(
      `INSERT INTO payment_orders (user_id, order_code, package_id, package_name, credits, amount_vnd, gateway, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
       RETURNING *`,
      [
        req.user!.id,
        orderCode,
        selectedPackage.id,
        selectedPackage.name,
        selectedPackage.credits,
        selectedPackage.priceVnd,
        chosenGateway,
      ]
    );
    const order = orderResult.rows[0] as unknown as PaymentOrder;

    // Generate gateway-specific response
    let vietqrData = null;
    let vnpayUrl = null;
    let momoData = null;

    if (chosenGateway === "VIETQR") {
      const bankConfig = await getBankConfig();
      vietqrData = buildVietQRUrlWithBank({ order_code: order.order_code, amount_vnd: order.amount_vnd }, bankConfig);
    } else if (chosenGateway === "VNPAY") {
      const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket.remoteAddress || "127.0.0.1";
      vnpayUrl = buildVNPayUrl({ order_code: order.order_code, amount_vnd: order.amount_vnd, package_name: order.package_name }, clientIp);
    } else if (chosenGateway === "MOMO") {
      momoData = {
        payUrl: `https://test-payment.momo.vn/v2/gateway/pay?orderId=${order.order_code}`,
        qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=momo://pay?orderId=${order.order_code}&amount=${order.amount_vnd}`,
      };
    }

    res.json({
      order,
      vietqr: vietqrData,
      vnpayUrl,
      momo: momoData,
      isSandbox: chosenGateway === "SANDBOX",
    });
  }));

  // BANK INFO PUBLIC ENDPOINT
  app.get("/api/billing/bank-info", asyncRoute(async (_req, res) => {
    res.json({ bank: await getBankConfig() });
  }));

  // ORDER STATUS POLLING API
  app.get("/api/billing/orders/:orderCode/status", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const orderCode = Array.isArray(req.params.orderCode) ? req.params.orderCode[0] : req.params.orderCode;
    const orderRes = await query(
      "SELECT * FROM payment_orders WHERE order_code = $1 AND user_id = $2",
      [orderCode, req.user!.id]
    );
    const order = orderRes.rows[0] as unknown as PaymentOrder;
    if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });

    let updatedUser = null;
    if (order.status === "SUCCESS") {
      const uRes = await query("SELECT id, email, display_name, role, credits FROM users WHERE id = $1", [req.user!.id]);
      updatedUser = uRes.rows[0];
    }

    res.json({ order, user: updatedUser });
  }));

  // SANDBOX PAYMENT INSTANT COMPLETE
  app.post("/api/billing/orders/:orderCode/sandbox-complete", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const orderCode = Array.isArray(req.params.orderCode) ? req.params.orderCode[0] : req.params.orderCode;
    const orderRes = await query(
      "SELECT * FROM payment_orders WHERE order_code = $1 AND user_id = $2",
      [orderCode, req.user!.id]
    );
    if (!orderRes.rows[0]) return res.status(404).json({ error: "ORDER_NOT_FOUND" });

    const result = await completePaymentOrder(orderCode, "SANDBOX_SIMULATOR", "SANDBOX_1CLICK");
    if (!result.success) return res.status(400).json({ error: result.message });

    const uRes = await query("SELECT id, email, display_name, role, credits FROM users WHERE id = $1", [req.user!.id]);
    res.json({
      success: true,
      order: result.order,
      user: uRes.rows[0],
      message: result.message,
    });
  }));

  // UNIVERSAL PAYMENT WEBHOOK (SEPAY / CASSO / BANK BOT)
  const webhookHandler = asyncRoute(async (req, res) => {
    const body = req.body || {};
    const content = (body.content || body.description || body.remark || "").toString();
    const amountIn = parseInt(body.transferAmount || body.amount || "0", 10);
    const referenceCode = (body.referenceCode || body.id || "").toString();

    const match = content.match(/FF[A-Z0-9]{6}/i);
    if (!match) {
      return res.json({ success: false, message: "NO_ORDER_CODE_IN_CONTENT" });
    }

    const orderCode = match[0].toUpperCase();
    const orderRes = await query("SELECT * FROM payment_orders WHERE order_code = $1", [orderCode]);
    const order = orderRes.rows[0] as unknown as PaymentOrder;
    if (!order) {
      return res.json({ success: false, message: "ORDER_NOT_FOUND" });
    }

    if (amountIn > 0 && amountIn < order.amount_vnd) {
      return res.status(400).json({ success: false, message: "AMOUNT_INSUFFICIENT" });
    }

    const result = await completePaymentOrder(orderCode, referenceCode, "VIETQR_AUTO");
    res.json({ success: true, message: result.message });
  });

  app.post("/api/webhooks/payment", webhookHandler);
  app.post("/api/webhooks/sepay", webhookHandler);

  // VNPAY RETURN CALLBACK API
  app.get("/api/billing/vnpay-return", asyncRoute(async (req, res) => {
    const queryParams = req.query as Record<string, string>;
    const isValid = verifyVNPayHash(queryParams);
    const orderCode = queryParams.vnp_TxnRef;
    const responseCode = queryParams.vnp_ResponseCode;

    if (isValid && responseCode === "00" && orderCode) {
      await completePaymentOrder(orderCode, queryParams.vnp_TransactionNo, "VNPAY");
      return res.redirect(`${config.FRONTEND_ORIGIN}/?payment=success&orderCode=${orderCode}`);
    }

    return res.redirect(`${config.FRONTEND_ORIGIN}/?payment=failed&orderCode=${orderCode}`);
  }));

  app.post("/api/billing/purchase", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const { packageId, paymentMethod } = req.body;
    const selectedPackage = TOKEN_PACKAGES.find((p) => p.id === packageId);
    if (!selectedPackage) {
      return res.status(400).json({ error: "INVALID_PACKAGE" });
    }

    const updatedUser = await transaction(async (client) => {
      const uRes = await client.query(
        "UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING id, email, display_name, role, credits",
        [selectedPackage.credits, req.user!.id]
      );
      if (!uRes.rows[0]) throw Object.assign(new Error("USER_NOT_FOUND"), { status: 404 });

      const description = `Mua ${selectedPackage.name} (+${selectedPackage.credits} Credits - ${selectedPackage.priceVnd.toLocaleString("vi-VN")}₫ qua ${paymentMethod || "Cổng thanh toán"})`;
      await client.query(
        "INSERT INTO transactions(user_id, kind, credits, description) VALUES ($1, 'CREDIT_PURCHASE', $2, $3)",
        [req.user!.id, selectedPackage.credits, description]
      );

      return uRes.rows[0];
    });

    res.json({
      success: true,
      user: updatedUser,
      package: selectedPackage,
      message: `Đã nạp thành công ${selectedPackage.credits} Credits!`,
    });
  }));

  // USER REDEEM PROMO CODE API
  app.post("/api/billing/redeem-promo", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const rawCode = (req.body.code || "").toString().trim().toUpperCase();
    if (!rawCode) return res.status(400).json({ error: "CODE_REQUIRED", message: "Vui lòng nhập mã khuyến mãi." });

    const promoRes = await query(
      `SELECT * FROM promo_codes 
       WHERE code = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > now())`,
      [rawCode]
    );
    const promo = promoRes.rows[0];
    if (!promo) {
      return res.status(404).json({ error: "INVALID_PROMO_CODE", message: "Mã khuyến mãi không tồn tại hoặc đã hết hạn." });
    }

    if (promo.max_uses > 0 && promo.used_count >= promo.max_uses) {
      return res.status(400).json({ error: "PROMO_LIMIT_REACHED", message: "Mã khuyến mãi đã hết lượt sử dụng." });
    }

    const alreadyRedeemed = await query(
      "SELECT 1 FROM promo_code_redemptions WHERE promo_code_id = $1 AND user_id = $2",
      [promo.id, req.user!.id]
    );
    if (alreadyRedeemed.rows[0]) {
      return res.status(400).json({ error: "PROMO_ALREADY_USED", message: "Bạn đã sử dụng mã khuyến mãi này rồi." });
    }

    const updatedUser = await transaction(async (client) => {
      await client.query("UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1", [promo.id]);
      const uRes = await client.query(
        "UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING id, email, display_name, role, credits",
        [promo.credits_reward, req.user!.id]
      );
      await client.query(
        "INSERT INTO promo_code_redemptions(promo_code_id, user_id, credits_awarded) VALUES ($1, $2, $3)",
        [promo.id, req.user!.id, promo.credits_reward]
      );
      await client.query(
        "INSERT INTO transactions(user_id, kind, credits, description) VALUES ($1, 'PROMO_REDEEM', $2, $3)",
        [req.user!.id, promo.credits_reward, `Áp dụng mã khuyến mãi: ${promo.code} (+${promo.credits_reward} Credits)`]
      );
      return uRes.rows[0];
    });

    res.json({
      success: true,
      user: updatedUser,
      creditsAwarded: promo.credits_reward,
      message: `Chúc mừng! Bạn đã nhận được +${promo.credits_reward} Credits miễn phí từ mã ${promo.code}!`,
    });
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

  app.get("/api/rendered-videos", requireAuth, asyncRoute(async (req: AuthRequest, res) => {
    const result = await query(
      `SELECT r.*, p.title as project_title, p.topic as project_topic 
       FROM render_jobs r
       JOIN projects p ON r.project_id = p.id
       WHERE r.user_id = $1 AND r.status = 'COMPLETED'
       ORDER BY r.completed_at DESC`,
      [req.user!.id]
    );
    const videos = await Promise.all(
      result.rows.map(async (row) => ({
        ...row,
        download_url: row.output_key ? await createDownloadUrl(row.output_key) : null,
      }))
    );
    res.json({ videos });
  }));

  // PUBLIC VIDEO SHARING ENDPOINT
  app.get("/api/public/videos/:jobId", asyncRoute(async (req, res) => {
    const result = await query(
      `SELECT r.id, r.status, r.output_key, r.created_at, r.completed_at, p.title as project_title, p.topic as project_topic, u.display_name as creator_name
       FROM render_jobs r
       JOIN projects p ON r.project_id = p.id
       JOIN users u ON r.user_id = u.id
       WHERE r.id = $1 AND r.status = 'COMPLETED'`,
      [req.params.jobId]
    );
    const video = result.rows[0];
    if (!video) return res.status(404).json({ error: "VIDEO_NOT_FOUND" });

    const download_url = video.output_key ? await createDownloadUrl(video.output_key) : null;
    res.json({ video: { ...video, download_url } });
  }));

  // ADMIN DASHBOARD ENDPOINTS
  app.get("/api/admin/stats", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
    const userCount = await query("SELECT COUNT(*) FROM users");
    const projectCount = await query("SELECT COUNT(*) FROM projects");
    const completedJobCount = await query("SELECT COUNT(*) FROM render_jobs WHERE status = 'COMPLETED'");
    const creditsUsed = await query("SELECT ABS(COALESCE(SUM(credits), 0)) as total FROM transactions WHERE kind = 'RENDER_DEBIT'");

    res.json({
      stats: {
        totalUsers: parseInt(userCount.rows[0].count, 10),
        totalProjects: parseInt(projectCount.rows[0].count, 10),
        completedVideos: parseInt(completedJobCount.rows[0].count, 10),
        totalCreditsUsed: parseInt(creditsUsed.rows[0].total, 10),
      },
    });
  }));

  app.get("/api/admin/users", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
    const result = await query(
      "SELECT id, email, display_name, role, credits, created_at FROM users ORDER BY created_at DESC"
    );
    res.json({ users: result.rows });
  }));

  app.post("/api/admin/users/:userId/credits", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const { amount, description } = req.body;
    const creditAmount = parseInt(amount, 10);
    if (isNaN(creditAmount)) return res.status(400).json({ error: "INVALID_AMOUNT" });

    const updatedUser = await transaction(async (client) => {
      const uRes = await client.query(
        "UPDATE users SET credits = credits + $2 WHERE id = $1 RETURNING id, email, display_name, role, credits",
        [req.params.userId, creditAmount]
      );
      if (!uRes.rows[0]) throw Object.assign(new Error("USER_NOT_FOUND"), { status: 404 });
      await client.query(
        "INSERT INTO transactions(user_id, kind, credits, description) VALUES ($1, 'ADMIN_GRANT', $2, $3)",
        [req.params.userId, creditAmount, description || "Admin cấp credit"]
      );
      return uRes.rows[0];
    });
    res.json({ user: updatedUser });
  }));

  app.post("/api/admin/users/:userId/role", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const { role } = req.body;
    if (!["USER", "ADMIN"].includes(role)) return res.status(400).json({ error: "INVALID_ROLE" });

    const result = await query(
      "UPDATE users SET role = $2 WHERE id = $1 RETURNING id, email, display_name, role, credits",
      [req.params.userId, role]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "USER_NOT_FOUND" });
    res.json({ user: result.rows[0] });
  }));

  app.get("/api/admin/jobs", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
    const result = await query(
      `SELECT r.*, u.email as user_email, u.display_name as user_name, p.title as project_title 
       FROM render_jobs r
       JOIN users u ON r.user_id = u.id
       JOIN projects p ON r.project_id = p.id
       ORDER BY r.created_at DESC LIMIT 50`
    );
    res.json({ jobs: result.rows });
  }));

  // ADMIN PROMO CODES API
  app.get("/api/admin/promo-codes", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
    const result = await query("SELECT * FROM promo_codes ORDER BY created_at DESC");
    res.json({ promoCodes: result.rows });
  }));

  app.post("/api/admin/promo-codes", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const { code, creditsReward, maxUses, expiresInDays } = req.body;
    const cleanCode = (code || "").toString().trim().toUpperCase();
    if (!cleanCode) return res.status(400).json({ error: "CODE_REQUIRED", message: "Vui lòng nhập mã khuyến mãi." });
    const reward = parseInt(creditsReward, 10);
    if (isNaN(reward) || reward <= 0) return res.status(400).json({ error: "INVALID_CREDITS", message: "Số credits thưởng không hợp lệ." });
    const max = parseInt(maxUses, 10) || 100;
    const days = parseInt(expiresInDays, 10);
    const expiresAt = days && days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

    try {
      const result = await query(
        `INSERT INTO promo_codes (code, credits_reward, max_uses, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [cleanCode, reward, max, expiresAt]
      );
      res.json({ promoCode: result.rows[0] });
    } catch (err: any) {
      if (err.code === "23505") {
        return res.status(400).json({ error: "CODE_ALREADY_EXISTS", message: "Mã khuyến mãi này đã tồn tại." });
      }
      throw err;
    }
  }));

  app.patch("/api/admin/promo-codes/:id/toggle", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const result = await query(
      "UPDATE promo_codes SET is_active = NOT is_active WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "PROMO_NOT_FOUND" });
    res.json({ promoCode: result.rows[0] });
  }));

  app.delete("/api/admin/promo-codes/:id", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    await query("DELETE FROM promo_codes WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  }));

  // ADMIN PAYMENT ORDERS API
  app.get("/api/admin/orders", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
    const ordersRes = await query(
      `SELECT o.*, u.email as user_email, u.display_name as user_name
       FROM payment_orders o
       JOIN users u ON o.user_id = u.id
       ORDER BY o.created_at DESC LIMIT 100`
    );
    const statsRes = await query(
      `SELECT 
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE status = 'SUCCESS') as successful_orders,
        COALESCE(SUM(amount_vnd) FILTER (WHERE status = 'SUCCESS'), 0) as total_revenue_vnd
       FROM payment_orders`
    );

    res.json({
      orders: ordersRes.rows,
      stats: statsRes.rows[0],
    });
  }));

  // ADMIN BANK SETTINGS
  app.get("/api/admin/settings/bank", requireAuth, requireAdmin, asyncRoute(async (_req, res) => {
    res.json({ bank: await getBankConfig() });
  }));

  app.post("/api/admin/settings/bank", requireAuth, requireAdmin, asyncRoute(async (req, res) => {
    const { bank_id, bank_name, account_no, account_name } = req.body;
    if (!account_no || !account_name) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Vui lòng điền đủ số tài khoản và tên chủ tài khoản." });
    }
    const updated = await setBankConfig({
      bank_id: bank_id || "MB",
      bank_name: bank_name || "MB Bank",
      account_no: account_no.toString().trim(),
      account_name: account_name.toString().trim().toUpperCase(),
    });
    res.json({ success: true, bank: updated, message: "Cập nhật tài khoản ngân hàng thành công!" });
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
