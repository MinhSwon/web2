# FrameFoundry - SaaS Video End-to-End

FrameFoundry là MVP hoàn chỉnh cho hệ thống tạo video từ ảnh theo kiến trúc trong tài liệu SRS. Luồng mặc định chạy được ngay cả khi chưa có API key AI: worker tạo kịch bản fallback, dùng Edge-TTS nếu truy cập được và FFmpeg để tạo chuyển động, audio, subtitle và MP4.

## Kiến trúc

```text
React/Vite UI
    |
    v
Node.js API ---- PostgreSQL
    |  |          users, projects, assets, jobs, credits
    |  +-------- Redis (SSE progress)
    |
    +---------- RabbitMQ ---------- FastAPI Worker
                                      |  Gemini / Groq
                                      |  Edge-TTS / ElevenLabs
                                      |  Groq Whisper
                                      +  FFmpeg
                                           |
                                           v
                                      MinIO / S3
```

## Chức năng đã có

- Đăng ký, đăng nhập JWT và tài khoản có 10 credit khởi tạo.
- Tạo project, upload nhiều ảnh bằng pre-signed URL và lưu metadata.
- Tạo render job có idempotency key và trừ/hoàn credit an toàn.
- RabbitMQ queue, FastAPI consumer và progress callback nội bộ.
- Redis Pub/Sub và SSE để cập nhật tiến độ realtime trên giao diện.
- Pipeline tạo kịch bản, TTS, phụ đề SRT, chuyển động Ken Burns và MP4.
- Lưu file private trên MinIO, tải xuống bằng signed URL hết hạn.
- Giao diện responsive cho desktop/mobile.
- Docker health check, migration PostgreSQL tự động và bài test E2E.

## Chạy dự án

Yêu cầu: Docker Desktop.

```powershell
Copy-Item .env.example .env
docker compose up --build -d
docker compose ps
```

Mở ứng dụng tại `http://localhost:8080`.

Các trang vận hành:

- Ứng dụng: `http://localhost:8080`
- MinIO Console: `http://localhost:9001`
- RabbitMQ Management: `http://localhost:15672` (`guest` / `guest` ở môi trường local)

Backend và worker chỉ được expose trong Docker network; Nginx chuyển tiếp `/api` vào backend.

## Cấu hình AI

Điền key trong `.env`, sau đó chạy `docker compose up -d --build worker`.

```dotenv
GEMINI_API_KEY=
GROQ_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
FAL_KEY=
```

Thứ tự lựa chọn hiện tại:

- Kịch bản: Gemini → Groq → fallback local.
- Giọng đọc: `TTS_PROVIDER=edge` hoặc `TTS_PROVIDER=elevenlabs`; lỗi sẽ fallback sang audio im lặng để job vẫn hoàn thành.
- Phụ đề: Groq Whisper → SRT được phân thời gian từ kịch bản.
- Chuyển động: FFmpeg Ken Burns. `FAL_KEY` được dành cho adapter image-to-video cloud khi object storage có public URL.

## Kiểm thử

```powershell
npm install
npm run build
npm run test

$env:PYTHONPATH='services\worker'
.\.venv-worker\Scripts\python -m pytest services\worker\tests -q

powershell -ExecutionPolicy Bypass -File scripts\e2e.ps1
```

Bài E2E tự tạo tài khoản, project, ảnh mẫu, render job, tải MP4 và kiểm tra stream bằng `ffprobe`.

## Cấu trúc thư mục

```text
apps/
  backend/        Express + TypeScript + migrations
  frontend/       React + Vite + Nginx
services/
  worker/         FastAPI + provider adapters + FFmpeg
scripts/
  e2e.ps1         Kiểm thử toàn hệ thống
tài liệu/         SRS và tài liệu kiến trúc
docker-compose.yml
```

## API chính

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET|POST /api/projects`
- `GET /api/projects/:projectId`
- `POST /api/uploads/presign`
- `POST /api/projects/:projectId/assets`
- `POST /api/projects/:projectId/render`
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/events`

## Trước khi đưa lên production

- Thay toàn bộ secret mặc định và dùng cloud secret manager.
- Chuyển MinIO sang S3, thiết lập CDN và lifecycle cho file trung gian.
- Cấu hình OAuth, refresh token rotation, email verification và reset password.
- Thêm rate limit, audit log, malware/file validation và content moderation.
- Tách worker theo stage nếu cần scale GPU, cấu hình DLQ và retry policy RabbitMQ.
- Thêm billing provider, webhook signature verification và đối soát credit.
- Bổ sung OpenTelemetry, metrics, alerting, backup và disaster recovery.
