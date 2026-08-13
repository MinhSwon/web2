import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default("postgresql://saas_video:saas_video_dev@localhost:5432/saas_video"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  RABBITMQ_URL: z.string().default("amqp://guest:guest@localhost:5672"),
  JWT_SECRET: z.string().min(16).default("development-secret-change-me"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  WORKER_TOKEN: z.string().min(12).default("development-worker-token"),
  MINIO_INTERNAL_ENDPOINT: z.string().url().default("http://localhost:9000"),
  MINIO_PUBLIC_ENDPOINT: z.string().url().default("http://localhost:9000"),
  MINIO_ACCESS_KEY: z.string().default("minioadmin"),
  MINIO_SECRET_KEY: z.string().default("minioadmin123"),
  MINIO_BUCKET: z.string().default("saas-video"),
  FRONTEND_ORIGIN: z.string().default("http://localhost:8080"),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().default(""),
});

export const config = schema.parse(process.env);

