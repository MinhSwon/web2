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

export function generateOrderCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let random = "";
  for (let i = 0; i < 6; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `FF${random}`;
}

export function buildVietQRUrl(order: { order_code: string; amount_vnd: number }): {
  qrUrl: string;
  bankId: string;
  accountNo: string;
  accountName: string;
  memo: string;
  amount: number;
} {
  const bankId = config.VIETQR_BANK_ID;
  const accountNo = config.VIETQR_ACCOUNT_NO;
  const accountName = config.VIETQR_ACCOUNT_NAME;
  const memo = order.order_code;
  const qrUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png?amount=${order.amount_vnd}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(accountName)}`;

  return {
    qrUrl,
    bankId,
    accountNo,
    accountName,
    memo,
    amount: order.amount_vnd,
  };
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
