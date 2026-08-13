import asyncio
import json
import shutil
from pathlib import Path

import edge_tts
import httpx

from .settings import settings


async def generate_script(topic: str, asset_count: int) -> str:
    prompt = (
        f"Viết kịch bản thuyết minh tiếng Việt ngắn cho video chủ đề '{topic}', "
        f"gồm {asset_count} cảnh ảnh. Chỉ trả về lời thuyết minh, tối đa {asset_count * 24} từ."
    )
    if settings.openai_api_key:
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                    json={
                        "model": settings.openai_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.7,
                    },
                )
                response.raise_for_status()
                return response.json()["choices"][0]["message"]["content"].strip()
        except Exception as error:
            print(f"OpenAI script generation failed ({error}), trying fallback...")

    if settings.gemini_api_key:
        try:
            url = (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                "gemini-flash-latest:generateContent"
            )
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(
                    url,
                    headers={"x-goog-api-key": settings.gemini_api_key},
                    json={"contents": [{"parts": [{"text": prompt}]}]},
                )
                response.raise_for_status()
                payload = response.json()
                return payload["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception as error:
            print(f"Gemini script generation failed ({error}), trying fallback...")

    if settings.groq_api_key:
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                    json={
                        "model": "llama-3.3-70b-versatile",
                        "messages": [{"role": "user", "content": prompt}],
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
    if settings.tts_provider in ("google", "gtts"):
        try:
            from gtts import gTTS
            tts = gTTS(text=text, lang="vi")
            tts.save(str(output))
            return output.exists() and output.stat().st_size > 0
        except Exception:
            return False

    if settings.tts_provider == "openai" and settings.openai_api_key:
        valid_voices = {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}
        selected_voice = voice.lower() if voice.lower() in valid_voices else "nova"
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    "https://api.openai.com/v1/audio/speech",
                    headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                    json={
                        "model": "tts-1",
                        "input": text,
                        "voice": selected_voice,
                    },
                )
                response.raise_for_status()
                output.write_bytes(response.content)
                return output.stat().st_size > 0
        except Exception:
            return False

    if settings.tts_provider == "elevenlabs" and settings.elevenlabs_api_key:
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    f"https://api.elevenlabs.io/v1/text-to-speech/{settings.elevenlabs_voice_id}",
                    headers={
                        "xi-api-key": settings.elevenlabs_api_key,
                        "Accept": "audio/mpeg",
                    },
                    json={
                        "text": text,
                        "model_id": "eleven_multilingual_v2",
                        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
                    },
                )
                response.raise_for_status()
                output.write_bytes(response.content)
                return output.stat().st_size > 0
        except Exception:
            return False
    if settings.tts_provider != "edge":
        return False
    try:
        communicator = edge_tts.Communicate(text, voice)
        await communicator.save(str(output))
        return output.exists() and output.stat().st_size > 0
    except Exception:
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
