import nodemailer from "nodemailer";
import { config } from "./config";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;
  if (config.SMTP_USER && config.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      },
    });
  }
  return transporter;
}

export async function sendVideoReadyEmail(
  toEmail: string,
  projectTitle: string,
  downloadUrl: string
): Promise<boolean> {
  const mailer = getTransporter();
  if (!mailer) {
    console.log(`[Email Notice] SMTP not configured. Video ready for ${toEmail}: ${downloadUrl}`);
    return false;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f1c18; color: #f2f5f3; border-radius: 12px;">
      <h2 style="color: #ff6b4a; margin-top: 0;">🎉 Video AI Của Bạn Đã Hoàn Tất!</h2>
      <p style="font-size: 16px; line-height: 1.5;">Xin chào,</p>
      <p style="font-size: 16px; line-height: 1.5;">
        Dự án AI Video <strong>"${projectTitle}"</strong> của bạn đã được Magic Hour AI render và ghép thành công kèm kịch bản, giọng đọc và phụ đề.
      </p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${downloadUrl}" target="_blank" style="background-color: #ff6b4a; color: #ffffff; padding: 14px 28px; text-decoration: none; font-size: 16px; font-weight: bold; border-radius: 8px; display: inline-block;">
          ▶ Xem & Tải Video MP4 Kết Quả
        </a>
      </div>
      <p style="font-size: 14px; color: #a0b0a8;">
        Nếu nút trên không hoạt động, bạn có thể copy link trực tiếp dưới đây:<br>
        <a href="${downloadUrl}" style="color: #4da6ff; word-break: break-all;">${downloadUrl}</a>
      </p>
      <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.1); margin: 25px 0;">
      <p style="font-size: 12px; color: #6b7f75; text-align: center;">
        FrameFoundry SaaS Video Studio · Email gửi tự động tới ${toEmail}
      </p>
    </div>
  `;

  try {
    await mailer.sendMail({
      from: `"FrameFoundry AI Studio" <${config.SMTP_USER}>`,
      to: toEmail,
      subject: `🎬 Video AI hoàn tất: "${projectTitle}"`,
      html: html,
    });
    console.log(`[Email Success] Sent video download email to ${toEmail}`);
    return true;
  } catch (error) {
    console.error(`[Email Error] Failed to send email to ${toEmail}:`, error);
    return false;
  }
}
