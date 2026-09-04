import asyncio
import json
import shutil
import tempfile
from pathlib import Path
from typing import Any

import httpx
from minio import Minio

from .providers import create_captions, generate_motion_clip, generate_script, synthesize_speech
from .settings import settings


class PipelineError(RuntimeError):
    pass


class VideoPipeline:
    def __init__(self) -> None:
        self.storage = Minio(
            settings.minio_host,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )

    async def callback(self, job_id: str, status: str, progress: int, stage: str, message: str, **extra: Any) -> None:
        payload = {"status": status, "progress": progress, "stage": stage, "message": message, **extra}
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                f"{settings.backend_internal_url}/internal/jobs/{job_id}/progress",
                headers={"X-Worker-Token": settings.worker_token},
                json=payload,
            )
            response.raise_for_status()

    async def process(self, payload: dict[str, Any]) -> None:
        job_id = payload["job_id"]
        assets = payload.get("assets", [])
        config = payload.get("config", {})
        if not assets:
            raise PipelineError("Job không có ảnh đầu vào")

        work_dir = Path(tempfile.mkdtemp(prefix=f"video-{job_id}-"))
        try:
            await self.callback(job_id, "PROCESSING", 5, "download", "Đang tải ảnh đầu vào")
            image_paths = await self._download_assets(assets, work_dir)

            await self.callback(job_id, "PROCESSING", 18, "script", "Đang phân tích hình ảnh & xây dựng kịch bản")
            script = await generate_script(config.get("topic", "Storytelling"), image_paths)
            (work_dir / "script.txt").write_text(script, encoding="utf-8")

            image_duration = float(config.get("imageDuration", 3))
            total_duration = max(1.0, image_duration * len(image_paths))
            voice_path = work_dir / "voice.mp3"
            await self.callback(job_id, "PROCESSING", 32, "voice", "Đang tạo giọng đọc")
            has_voice = await synthesize_speech(script, config.get("voice", "vi-VN-HoaiMyNeural"), voice_path)
            if not has_voice:
                await self._create_silent_audio(voice_path, total_duration)

            caption_path = work_dir / "captions.srt"
            await self.callback(job_id, "PROCESSING", 45, "captions", "Đang tạo phụ đề")
            await create_captions(voice_path, script, total_duration, caption_path)

            motion_engine = config.get("motionEngine", "ffmpeg").lower()
            stage_msg = "Đang tạo chuyển động zoom ra bằng FFmpeg" if motion_engine == "ffmpeg" else "Đang tạo chuyển động AI Magic Hour"
            await self.callback(job_id, "PROCESSING", 58, "motion", stage_msg)
            resolution = config.get("resolution", "720p")
            width, height = (1920, 1080) if resolution == "1080p" else (1280, 720)
            clips = await self._create_clips(image_paths, work_dir, image_duration, width, height, motion_engine)

            await self.callback(job_id, "PROCESSING", 78, "assembly", "Đang ghép video, âm thanh và phụ đề")
            joined = work_dir / "joined.mp4"
            await self._concat_clips(clips, joined, work_dir)
            output = work_dir / "output.mp4"
            await self._mux(joined, voice_path, caption_path, output)

            await self.callback(job_id, "PROCESSING", 94, "upload", "Đang tải video thành phẩm")
            output_key = f"users/{payload['user_id']}/projects/{payload['project_id']}/outputs/{job_id}.mp4"
            await asyncio.to_thread(
                self.storage.fput_object,
                settings.minio_bucket,
                output_key,
                str(output),
                "video/mp4",
            )
            await self.callback(
                job_id, "COMPLETED", 100, "completed", "Video đã sẵn sàng",
                outputKey=output_key,
                script=script,
            )
        except Exception as error:
            try:
                await self.callback(
                    job_id, "FAILED", 100, "failed", "Không thể hoàn tất video",
                    errorCode=type(error).__name__.upper(),
                )
            finally:
                raise
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    async def _download_assets(self, assets: list[dict[str, Any]], work_dir: Path) -> list[Path]:
        paths: list[Path] = []
        for index, asset in enumerate(assets):
            suffix = Path(asset.get("file_name", "image.jpg")).suffix or ".jpg"
            destination = work_dir / f"image-{index:03d}{suffix}"
            await asyncio.to_thread(
                self.storage.fget_object,
                settings.minio_bucket,
                asset["object_key"],
                str(destination),
            )
            paths.append(destination)
        return paths

    async def _create_silent_audio(self, output: Path, duration: float) -> None:
        await run_command([
            "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", str(duration), "-q:a", "9", "-acodec", "libmp3lame", str(output),
        ])

    async def _create_clips(
        self, images: list[Path], work_dir: Path, duration: float, width: int, height: int, engine: str = "ffmpeg"
    ) -> list[Path]:
        clips: list[Path] = []
        for index, image in enumerate(images):
            clip = work_dir / f"clip-{index:03d}.mp4"
            if engine == "ffmpeg":
                await self._create_ffmpeg_zoom_out_clip(image, clip, duration, width, height)
            else:
                has_ai_motion = await generate_motion_clip(image, clip, duration=int(round(duration)))
                if not has_ai_motion:
                    # Fallback to FFmpeg Zoom Out if Magic Hour fails or is not configured
                    print(f"Magic Hour unavailable for image #{index + 1}, falling back to FFmpeg Zoom Out")
                    await self._create_ffmpeg_zoom_out_clip(image, clip, duration, width, height)
            clips.append(clip)
        return clips

    async def _create_ffmpeg_zoom_out_clip(
        self, image: Path, output: Path, duration: float, width: int, height: int, fps: int = 30
    ) -> None:
        total_frames = max(1, int(round(duration * fps)))
        # Zoom-out effect (Ken Burns): Start at 1.4x and smoothly zoom out to 1.0x over the duration
        filter_expr = (
            f"scale={width}*1.5:-2,"
            f"zoompan=z='if(lte(on,1),1.4,max(1.001,1.4-(on/{total_frames})*0.4))':"
            f"x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s={width}x{height}:fps={fps},"
            f"trim=duration={duration}"
        )
        await run_command([
            "ffmpeg", "-y", "-loop", "1", "-i", str(image),
            "-vf", filter_expr,
            "-t", str(duration),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            str(output),
        ])

    async def _concat_clips(self, clips: list[Path], output: Path, work_dir: Path) -> None:
        manifest = work_dir / "clips.txt"
        manifest.write_text("\n".join(f"file '{clip.as_posix()}'" for clip in clips), encoding="utf-8")
        await run_command([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(manifest),
            "-c", "copy", str(output),
        ])

    async def _mux(self, video: Path, audio: Path, captions: Path, output: Path) -> None:
        captions_str = str(captions).replace("\\", "/").replace(":", "\\:")
        await run_command([
            "ffmpeg", "-y", "-i", str(video), "-i", str(audio),
            "-filter_complex", f"[0:v]subtitles='{captions_str}':force_style='FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2'[v]",
            "-map", "[v]", "-map", "1:a:0",
            "-c:v", "libx264", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output),
        ])


async def run_command(command: list[str]) -> None:
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        detail = stderr.decode("utf-8", errors="replace")[-4000:]
        raise PipelineError(f"Command failed ({process.returncode}): {json.dumps(command)}\n{detail}")
