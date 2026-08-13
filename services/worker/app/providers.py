import asyncio
import json
import shutil
from pathlib import Path

import edge_tts
import httpx

from .settings import settings


async def generate_script(topic: str, image_paths: list[Path] = None) -> str:
    asset_count = len(image_paths) if image_paths else 1
    base_prompt = (
        f"Hãy nhìn vào các bức ảnh được gửi kèm và viết một kịch bản thuyết minh tiếng Việt lôi cuốn cho video "
        f"chủ đề '{topic}'. Mô tả chính xác nội dung, nhân vật, cảnh vật và cảm xúc trong các bức ảnh. "
        f"Chỉ trả về duy nhất lời thuyết minh tiếng Việt, tối đa {asset_count * 30} từ, viết thành câu hoàn chỉnh."
    )

    # 1. OpenAI GPT-4o-mini Vision
    if settings.openai_api_key:
        try:
            import base64
            content_parts = [{"type": "text", "text": base_prompt}]
            if image_paths:
                for img in image_paths[:5]:
                    mime = "image/jpeg" if img.suffix.lower() in (".jpg", ".jpeg") else "image/png"
                    b64 = base64.b64encode(img.read_bytes()).decode()
                    content_parts.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"}
                    })
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                    json={
                        "model": settings.openai_model,
                        "messages": [{"role": "user", "content": content_parts}],
                        "temperature": 0.7,
                    },
                )
                response.raise_for_status()
                return response.json()["choices"][0]["message"]["content"].strip()
        except Exception as error:
            print(f"OpenAI Vision script generation failed ({error}), trying fallback...")

    # 2. Google Gemini Flash Vision
    if settings.gemini_api_key:
        try:
            import base64
            parts = [{"text": base_prompt}]
            if image_paths:
                for img in image_paths[:5]:
                    mime = "image/jpeg" if img.suffix.lower() in (".jpg", ".jpeg") else "image/png"
                    b64 = base64.b64encode(img.read_bytes()).decode()
                    parts.append({
                        "inline_data": {"mime_type": mime, "data": b64}
                    })
            url = (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                "gemini-flash-latest:generateContent"
            )
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(
                    url,
                    headers={"x-goog-api-key": settings.gemini_api_key},
                    json={"contents": [{"parts": parts}]},
                )
                response.raise_for_status()
                payload = response.json()
                return payload["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception as error:
            print(f"Gemini Vision script generation failed ({error}), trying fallback...")

    # 3. Groq LLM
    if settings.groq_api_key:
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                    json={
                        "model": "llama-3.3-70b-versatile",
                        "messages": [{"role": "user", "content": base_prompt}],
                        "temperature": 0.7,
                    },
                )
                response.raise_for_status()
                return response.json()["choices"][0]["message"]["content"].strip()
        except Exception as error:
            print(f"Groq script generation failed ({error}), trying fallback...")

    scenes = [
        "Mỗi khung hình mở ra một lát cắt riêng của câu chuyện.",
        "Ánh sáng, màu sắc và khoảnh khắc cùng dẫn chúng ta đi tiếp.",
        "Những chi tiết nhỏ kết nối thành một hành trình đáng nhớ.",
        "Và cuối cùng, câu chuyện đọng lại bằng cảm xúc chân thật.",
    ]
    selected = [scenes[index % len(scenes)] for index in range(asset_count)]
    return f"{topic}. " + " ".join(selected)


async def synthesize_speech(text: str, voice: str, output: Path) -> bool:
    # 1. Try Edge TTS
    try:
        communicator = edge_tts.Communicate(text, voice or "vi-VN-HoaiMyNeural")
        await communicator.save(str(output))
        if output.exists() and output.stat().st_size > 0:
            return True
    except Exception as e:
        print(f"Edge TTS notice: {e}, attempting gTTS fallback...")

    # 2. Fallback to gTTS
    try:
        from gtts import gTTS
        tts = gTTS(text=text, lang="vi")
        await asyncio.to_thread(tts.save, str(output))
        return output.exists() and output.stat().st_size > 0
    except Exception as e:
        print(f"gTTS error: {e}")
        return False


async def create_captions(audio: Path, fallback_text: str, duration: float, output: Path) -> None:
    if settings.openai_api_key:
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                with audio.open("rb") as audio_file:
                    response = await client.post(
                        "https://api.openai.com/v1/audio/transcriptions",
                        headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                        data={"model": "whisper-1", "response_format": "srt", "language": "vi"},
                        files={"file": (audio.name, audio_file, "audio/mpeg")},
                    )
                response.raise_for_status()
                output.write_text(response.text, encoding="utf-8")
                if output.stat().st_size > 0:
                    return
        except Exception:
            pass

    if settings.groq_api_key:
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                with audio.open("rb") as audio_file:
                    response = await client.post(
                        "https://api.groq.com/openai/v1/audio/transcriptions",
                        headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                        data={"model": "whisper-large-v3-turbo", "response_format": "srt", "language": "vi"},
                        files={"file": (audio.name, audio_file, "audio/mpeg")},
                    )
                response.raise_for_status()
                output.write_text(response.text, encoding="utf-8")
                if output.stat().st_size > 0:
                    return
        except Exception:
            pass
    write_captions(fallback_text, duration, output)


def write_captions(text: str, duration: float, output: Path) -> None:
    sentences = [part.strip() for part in text.replace("!", ".").replace("?", ".").split(".") if part.strip()]
    if not sentences:
        sentences = [text.strip() or "Video của bạn"]
    slot = duration / len(sentences)

    def timestamp(seconds: float) -> str:
        milliseconds = int(seconds * 1000)
        hours, milliseconds = divmod(milliseconds, 3_600_000)
        minutes, milliseconds = divmod(milliseconds, 60_000)
        secs, milliseconds = divmod(milliseconds, 1000)
        return f"{hours:02}:{minutes:02}:{secs:02},{milliseconds:03}"

    blocks = []
    for index, sentence in enumerate(sentences, start=1):
        start = (index - 1) * slot
        end = min(duration, index * slot)
        blocks.append(f"{index}\n{timestamp(start)} --> {timestamp(end)}\n{sentence}\n")
    output.write_text("\n".join(blocks), encoding="utf-8")


async def generate_motion_clip(image_path: Path, output_clip: Path, prompt: str = "") -> bool:
    # Magic Hour AI (Primary High Quality Image-to-Video API)
    if settings.magichour_api_key:
        try:
            headers = {
                "Authorization": f"Bearer {settings.magichour_api_key}",
                "Content-Type": "application/json"
            }
            ext = image_path.suffix.lstrip('.') or 'png'
            async with httpx.AsyncClient(timeout=180) as client:
                res = await client.post(
                    "https://api.magichour.ai/v1/files/upload-urls",
                    headers=headers,
                    json={"items": [{"type": "image", "extension": ext}]}
                )
                if res.status_code == 200:
                    upload_info = res.json()["items"][0]
                    upload_url = upload_info["upload_url"]
                    file_path = upload_info["file_path"]

                    up_res = await client.put(upload_url, content=image_path.read_bytes(), headers={"Content-Type": f"image/{ext}"})
                    if up_res.status_code in (200, 201):
                        job_payload = {
                            "end_seconds": 5,
                            "assets": {"image_file_path": file_path},
                            "style": {"prompt": prompt or "Animate image smoothly with natural motion and cinematic detail"}
                        }
                        job_res = await client.post("https://api.magichour.ai/v1/image-to-video", headers=headers, json=job_payload)
                        if job_res.status_code in (200, 201, 202):
                            job_id = job_res.json().get("id")
                            for _ in range(60):
                                await asyncio.sleep(4)
                                poll = await client.get(f"https://api.magichour.ai/v1/video-projects/{job_id}", headers=headers)
                                poll_data = poll.json()
                                status = poll_data.get("status")
                                if status == "complete":
                                    downloads = poll_data.get("downloads", [])
                                    dl_url = downloads[0]["url"] if downloads else poll_data.get("download", {}).get("url")
                                    if dl_url:
                                        video_res = await client.get(dl_url)
                                        output_clip.write_bytes(video_res.content)
                                        if output_clip.exists() and output_clip.stat().st_size > 0:
                                            return True
                                elif status in ("error", "failed"):
                                    print(f"Magic Hour render failed: {poll_data}")
                                    break
        except Exception as err:
            print(f"Magic Hour motion error: {err}")

    return False


def debug_provider_summary() -> str:
    return json.dumps({
        "script": "google-gemini" if settings.gemini_api_key else "openai" if settings.openai_api_key else "groq" if settings.groq_api_key else "local-fallback",
        "tts": settings.tts_provider,
        "caption": "openai-whisper" if settings.openai_api_key else "groq-whisper" if settings.groq_api_key else "local-srt",
        "motion": "magichour" if settings.magichour_api_key else settings.motion_provider,
    })
