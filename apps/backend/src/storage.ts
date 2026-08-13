import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config";

const credentials = { accessKeyId: config.MINIO_ACCESS_KEY, secretAccessKey: config.MINIO_SECRET_KEY };
const common = { region: "us-east-1", credentials, forcePathStyle: true };
const internalClient = new S3Client({ ...common, endpoint: config.MINIO_INTERNAL_ENDPOINT });
const publicClient = new S3Client({ ...common, endpoint: config.MINIO_PUBLIC_ENDPOINT });

export async function initializeStorage() {
  try {
    await internalClient.send(new HeadBucketCommand({ Bucket: config.MINIO_BUCKET }));
  } catch {
    await internalClient.send(new CreateBucketCommand({ Bucket: config.MINIO_BUCKET }));
  }
}

export function createUploadUrl(key: string, contentType: string) {
  return getSignedUrl(publicClient, new PutObjectCommand({
    Bucket: config.MINIO_BUCKET,
    Key: key,
    ContentType: contentType,
  }), { expiresIn: 900 });
}

export function createDownloadUrl(key: string) {
  return getSignedUrl(publicClient, new GetObjectCommand({
    Bucket: config.MINIO_BUCKET,
    Key: key,
  }), { expiresIn: 3600 });
}
