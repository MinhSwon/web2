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
    magichour_api_key: str = os.getenv("MAGICHOUR_API_KEY", os.getenv("MAGIC_HOUR_API_KEY", "")).strip()
    motion_provider: str = os.getenv("MOTION_PROVIDER", "magichour").strip()
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
