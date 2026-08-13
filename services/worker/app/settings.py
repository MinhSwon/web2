import os
from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class Settings:
    rabbitmq_url: str = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672").strip()
    backend_internal_url: str = os.getenv("BACKEND_INTERNAL_URL", "http://localhost:3000").strip()
    worker_token: str = os.getenv("WORKER_TOKEN", "development-worker-token").strip()
    minio_endpoint: str = os.getenv("MINIO_ENDPOINT", "http://localhost:9000").strip()
    minio_access_key: str = os.getenv("MINIO_ACCESS_KEY", "minioadmin").strip()
    minio_secret_key: str = os.getenv("MINIO_SECRET_KEY", "minioadmin123").strip()
    minio_bucket: str = os.getenv("MINIO_BUCKET", "saas-video").strip()
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "").strip()
    groq_api_key: str = os.getenv("GROQ_API_KEY", "").strip()
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "").strip()
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
    elevenlabs_api_key: str = os.getenv("ELEVENLABS_API_KEY", "").strip()
    elevenlabs_voice_id: str = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM").strip()
    fal_key: str = os.getenv("FAL_KEY", "").strip()
    google_veo_api_key: str = os.getenv("GOOGLE_VEO_API_KEY", "").strip()
    kling_api_key: str = os.getenv("KLING_API_KEY", "").strip()
    shotstack_api_key: str = os.getenv("SHOTSTACK_API_KEY", "").strip()
    shotstack_env: str = os.getenv("SHOTSTACK_ENV", "stage").strip()
    hf_token: str = os.getenv("HF_TOKEN", os.getenv("HUGGINGFACE_TOKEN", "")).strip()
    motion_provider: str = os.getenv("MOTION_PROVIDER", "ffmpeg").strip()
    tts_provider: str = os.getenv("TTS_PROVIDER", "edge").strip()
    max_concurrent_jobs: int = int(os.getenv("MAX_CONCURRENT_JOBS", "1"))

    @property
    def minio_host(self) -> str:
        parsed = urlparse(self.minio_endpoint)
        return parsed.netloc or parsed.path

    @property
    def minio_secure(self) -> bool:
        return self.minio_endpoint.startswith("https://")


settings = Settings()
