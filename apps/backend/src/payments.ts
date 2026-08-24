import crypto from "node:crypto";
import { config } from "./config";
import { query, transaction } from "./db";

export interface PaymentOrder {
  id: string;
  user_id: string;
  order_code: string;
  package_id: string;
  package_name: string;
  credits: number;
  amount_vnd: number;
  gateway: string;
  status: "PENDING" | "SUCCESS" | "FAILED" | "EXPIRED";
  transaction_ref?: string | null;
  metadata?: Record<string, unknown>;
  paid_at?: string | null;
  created_at: string;
}

export interface BankConfig {
  bank_id: string;
  bank_name: string;
  account_no: string;
  account_name: string;
}

export async function getBankConfig(): Promise<BankConfig> {
  try {
    const res = await query("SELECT value FROM system_settings WHERE key = 'bank_config'");
    if (res.rows[0]?.value) {
      return res.rows[0].value as BankConfig;
    }
  } catch (err) {
    console.error("Failed to read bank_config from DB:", err);
  }
  return {
    bank_id: config.VIETQR_BANK_ID || "MB",
    bank_name: "MB Bank (Ngân Hàng Quân Đội)",
    account_no: config.VIETQR_ACCOUNT_NO || "999988886666",
    account_name: config.VIETQR_ACCOUNT_NAME || "FRAME FOUNDRY AI",
  };
}

export async function setBankConfig(bankConfig: Partial<BankConfig>): Promise<BankConfig> {
  const current = await getBankConfig();
  const updated: BankConfig = {
    bank_id: bankConfig.bank_id || current.bank_id,
    bank_name: bankConfig.bank_name || current.bank_name,
    account_no: bankConfig.account_no || current.account_no,
    account_name: (bankConfig.account_name || current.account_name).toUpperCase(),
  };

  await query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('bank_config', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
    [JSON.stringify(updated)]
  );

  return updated;
}

export function generateOrderCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let random = "";
  for (let i = 0; i < 6; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `FF${random}`;
}

export function buildVietQRUrlWithBank(
  order: { order_code: string; amount_vnd: number },
  bank: BankConfig
): {
  qrUrl: string;
  bankId: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  memo: string;
  amount: number;
} {
  const bankId = bank.bank_id;
  const bankName = bank.bank_name;
  const accountNo = bank.account_no;
  const accountName = bank.account_name;
  const memo = order.order_code;
  const qrUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png?amount=${order.amount_vnd}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(accountName)}`;

  return {
    qrUrl,
    bankId,
    bankName,
    accountNo,
    accountName,
    memo,
    amount: order.amount_vnd,
  };
}

export function buildVietQRUrl(order: { order_code: string; amount_vnd: number }): {
  qrUrl: string;
  bankId: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  memo: string;
  amount: number;
} {
  return buildVietQRUrlWithBank(order, {
    bank_id: config.VIETQR_BANK_ID || "MB",
    bank_name: "MB Bank (Ngân Hàng Quân Đội)",
    account_no: config.VIETQR_ACCOUNT_NO || "999988886666",
    account_name: config.VIETQR_ACCOUNT_NAME || "FRAME FOUNDRY AI",
  });
}

export function buildVNPayUrl(order: { order_code: string; amount_vnd: number; package_name: string }, ipAddr: string): string {
  const tmnCode = config.VNPAY_TMN_CODE;
  const secretKey = config.VNPAY_HASH_SECRET;
  const vnpUrl = config.VNPAY_URL;
  const returnUrl = `${config.FRONTEND_ORIGIN}/?payment=vnpay_return&orderCode=${order.order_code}`;

  const date = new Date();
  const createDate = date.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);

  const vnpParams: Record<string, string> = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: tmnCode,
    vnp_Locale: "vn",
    vnp_CurrCode: "VND",
    vnp_TxnRef: order.order_code,
    vnp_OrderInfo: `Thanh toan don hang ${order.order_code} - ${order.package_name}`,
    vnp_OrderType: "other",
    vnp_Amount: String(order.amount_vnd * 100),
    vnp_ReturnUrl: returnUrl,
    vnp_IpAddr: ipAddr || "127.0.0.1",
    vnp_CreateDate: createDate,
  };

  const sortedKeys = Object.keys(vnpParams).sort();
  const signData = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(vnpParams[k])}`)
    .join("&");

  const hmac = crypto.createHmac("sha512", secretKey);
  const secureHash = hmac.update(Buffer.from(signData, "utf-8")).digest("hex");

  return `${vnpUrl}?${signData}&vnp_SecureHash=${secureHash}`;
}

export function verifyVNPayHash(queryObj: Record<string, string>): boolean {
  const secureHash = queryObj.vnp_SecureHash;
  if (!secureHash) return false;

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(queryObj)) {
    if (key.startsWith("vnp_") && key !== "vnp_SecureHash" && key !== "vnp_SecureHashType") {
      params[key] = value;
    }
  }

  const sortedKeys = Object.keys(params).sort();
  const signData = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");

  const hmac = crypto.createHmac("sha512", config.VNPAY_HASH_SECRET);
  const checkHash = hmac.update(Buffer.from(signData, "utf-8")).digest("hex");

  return secureHash.toLowerCase() === checkHash.toLowerCase();
}

export async function completePaymentOrder(
  orderCode: string,
  transactionRef?: string,
  gatewayUsed?: string
): Promise<{ success: boolean; order?: PaymentOrder; message: string }> {
  return transaction(async (client) => {
    const orderRes = await client.query(
      "SELECT * FROM payment_orders WHERE order_code = $1 FOR UPDATE",
      [orderCode]
    );
    const order: PaymentOrder = orderRes.rows[0];
    if (!order) {
      return { success: false, message: "ORDER_NOT_FOUND" };
    }
    if (order.status === "SUCCESS") {
      return { success: true, order, message: "ALREADY_COMPLETED" };
    }

    const updatedOrderRes = await client.query(
      `UPDATE payment_orders 
       SET status = 'SUCCESS', paid_at = now(), transaction_ref = COALESCE($2, transaction_ref), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [order.id, transactionRef ?? null]
    );
    const updatedOrder: PaymentOrder = updatedOrderRes.rows[0];

    // Award credits to user
    await client.query(
      "UPDATE users SET credits = credits + $1 WHERE id = $2",
      [order.credits, order.user_id]
    );

    // Record in transactions log
    const desc = `Nạp ${order.package_name} (+${order.credits} Credits - ${order.amount_vnd.toLocaleString("vi-VN")}₫ qua ${gatewayUsed || order.gateway} [${order.order_code}])`;
    await client.query(
      "INSERT INTO transactions(user_id, kind, credits, description) VALUES ($1, 'CREDIT_PURCHASE', $2, $3)",
      [order.user_id, order.credits, desc]
    );

    return {
      success: true,
      order: updatedOrder,
      message: `Đã nạp thành công ${order.credits} Credits cho đơn hàng ${order.order_code}!`,
    };
  });
}
