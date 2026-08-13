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
    if settings.motion_provider in ("huggingface", "hf") or (settings.motion_provider == "auto" and settings.hf_token):
        if settings.hf_token:
            try:
                from gradio_client import Client, handle_file
                headers = {"Authorization": f"Bearer {settings.hf_token}"}
                client = await asyncio.to_thread(
                    Client, "multimodalart/stable-video-diffusion", headers=headers
                )
                res = await asyncio.to_thread(
                    client.predict,
                    image=handle_file(str(image_path)),
                    seed=42,
                    randomize_seed=True,
                    motion_bucket_id=127,
                    fps_id=6,
                    api_name="/video"
                )
                video_file = res[0] if isinstance(res, (tuple, list)) else res.get("video") if isinstance(res, dict) else res
                if video_file and Path(video_file).exists():
                    shutil.copy(video_file, output_clip)
                    return output_clip.exists() and output_clip.stat().st_size > 0
            except Exception as err:
                print(f"Hugging Face Space motion error: {err}")

    if settings.motion_provider in ("kling", "klingai") or (settings.motion_provider == "auto" and settings.kling_api_key):
        if settings.kling_api_key:
            try:
                import base64
                image_bytes = image_path.read_bytes()
                b64_img = base64.b64encode(image_bytes).decode('utf-8')
                headers = {
                    "Authorization": f"Bearer {settings.kling_api_key}",
                    "Content-Type": "application/json",
                }
                payload = {
                    "model_name": "kling-v1",
                    "image": b64_img,
                    "prompt": prompt or "Animate this image smoothly with cinematic camera movement",
                    "duration": "5"
                }
                async with httpx.AsyncClient(timeout=30) as client:
                    response = await client.post(
                        "https://api.klingai.com/v1/videos/image2video",
                        headers=headers,
                        json=payload,
                    )
                    data = response.json()
                    if response.status_code == 200 and data.get("code") == 0:
                        task_id = data["data"]["task_id"]
                        for _ in range(60):
                            await asyncio.sleep(5)
                            poll_res = await client.get(
                                f"https://api.klingai.com/v1/videos/image2video/{task_id}",
                                headers=headers,
                            )
                            poll_data = poll_res.json()
                            if poll_data.get("code") == 0:
                                status = poll_data.get("data", {}).get("task_status")
                                if status == "succeed":
                                    videos = poll_data.get("data", {}).get("task_result", {}).get("videos", [])
                                    if videos and videos[0].get("url"):
                                        video_res = await client.get(videos[0]["url"])
                                        video_res.raise_for_status()
                                        output_clip.write_bytes(video_res.content)
                                        return output_clip.exists() and output_clip.stat().st_size > 0
                                elif status in ("failed", "canceled"):
                                    print(f"Kling task failed: {poll_data}")
                                    break
                    else:
                        print(f"Kling API submit response ({response.status_code}): {response.text}")
            except Exception as err:
                print(f"Kling AI motion error: {err}")

    if settings.motion_provider in ("fal", "omni") or (settings.motion_provider == "auto" and settings.fal_key):
        if settings.fal_key:
            try:
                import base64
                image_bytes = image_path.read_bytes()
                mime = "image/jpeg" if image_path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
                b64_data = f"data:{mime};base64,{base64.b64encode(image_bytes).decode()}"
                
                async with httpx.AsyncClient(timeout=180) as client:
                    response = await client.post(
                        "https://fal.run/fal-ai/minimax-video/image-to-video",
                        headers={
                            "Authorization": f"Key {settings.fal_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "prompt": prompt or "Animate this image smoothly with cinematic camera movement",
                            "image_url": b64_data,
                        },
                    )
                    response.raise_for_status()
                    data = response.json()
                    video_url = data.get("video", {}).get("url") or data.get("video_url")
                    if video_url:
                        video_res = await client.get(video_url)
                        video_res.raise_for_status()
                        output_clip.write_bytes(video_res.content)
                        return output_clip.exists() and output_clip.stat().st_size > 0
            except Exception as err:
                print(f"Fal.ai Omni motion error: {err}")

    if settings.motion_provider in ("shotstack",) or (settings.motion_provider == "auto" and settings.shotstack_api_key):
        if settings.shotstack_api_key:
            try:
                public_img_url = None
                try:
                    async with httpx.AsyncClient(timeout=30) as client:
                        files = {"fileToUpload": (image_path.name, image_path.read_bytes(), "image/jpeg")}
                        data = {"reqtype": "fileupload"}
                        up_res = await client.post("https://catbox.moe/user/api.php", files=files, data=data)
                        if up_res.status_code == 200 and up_res.text.startswith("http"):
                            public_img_url = up_res.text.strip()
                except Exception as up_err:
                    print(f"Catbox image upload warning: {up_err}")

                if not public_img_url:
                    public_img_url = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1024"

                effects = ["zoomIn", "slideLeft", "zoomOut", "slideRight", "slideUp"]
                chosen_effect = effects[abs(hash(image_path.name)) % len(effects)]

                env = "stage" if settings.shotstack_env == "stage" else "v1"
                host = f"https://api.shotstack.io/edit/{env}/render"
                headers = {
                    "x-api-key": settings.shotstack_api_key,
                    "Content-Type": "application/json"
                }
                payload = {
                    "timeline": {
                        "background": "#000000",
                        "tracks": [
                            {
                                "clips": [
                                    {
                                        "asset": {
                                            "type": "image",
                                            "src": public_img_url
                                        },
                                        "start": 0,
                                        "length": 5,
                                        "effect": chosen_effect
                                    }
                                ]
                            }
                        ]
                    },
                    "output": {
                        "format": "mp4",
                        "resolution": "sd"
                    }
                }
                async with httpx.AsyncClient(timeout=30) as client:
                    response = await client.post(host, headers=headers, json=payload)
                    if response.status_code in (200, 201):
                        data = response.json()
                        render_id = data.get("response", {}).get("id") or data.get("id")
                        if render_id:
                            poll_url = f"https://api.shotstack.io/edit/{env}/render/{render_id}"
                            for _ in range(60):
                                await asyncio.sleep(4)
                                poll_res = await client.get(poll_url, headers=headers)
                                if poll_res.status_code == 200:
                                    res_data = poll_res.json().get("response", {})
                                    status = res_data.get("status")
                                    if status == "done":
                                        video_url = res_data.get("url")
                                        if video_url:
                                            video_res = await client.get(video_url)
                                            video_res.raise_for_status()
                                            output_clip.write_bytes(video_res.content)
                                            return output_clip.exists() and output_clip.stat().st_size > 0
                                    elif status in ("failed", "error"):
                                        print(f"Shotstack render failed: {res_data}")
                                        break
                    else:
                        print(f"Shotstack submit response ({response.status_code}): {response.text}")
            except Exception as err:
                print(f"Shotstack motion error: {err}")

    if settings.motion_provider in ("veo", "google_veo") or (settings.motion_provider == "auto" and settings.google_veo_api_key):
        if settings.google_veo_api_key:
            try:
                import base64
                image_bytes = image_path.read_bytes()
                b64_img = base64.b64encode(image_bytes).decode("utf-8")
                
                async with httpx.AsyncClient(timeout=180) as client:
                    url = "https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predict"
                    response = await client.post(
                        url,
                        headers={"x-goog-api-key": settings.google_veo_api_key},
                        json={
                            "instances": [{
                                "prompt": prompt or "Animate image with realistic smooth camera motion",
                                "image": {"bytesBase64Encoded": b64_img}
                            }]
                        }
                    )
                    if response.status_code == 200:
                        res_json = response.json()
                        video_b64 = res_json.get("predictions", [{}])[0].get("bytesBase64Encoded")
                        if video_b64:
                            output_clip.write_bytes(base64.b64decode(video_b64))
                            return output_clip.exists() and output_clip.stat().st_size > 0
            except Exception as err:
                print(f"Google Veo motion error: {err}")
    return False


def debug_provider_summary() -> str:
    return json.dumps({
        "script": "google-gemini" if settings.gemini_api_key else "openai" if settings.openai_api_key else "groq" if settings.groq_api_key else "local-fallback",
        "tts": settings.tts_provider,
        "caption": "openai-whisper" if settings.openai_api_key else "groq-whisper" if settings.groq_api_key else "local-srt",
        "motion": "shotstack" if settings.shotstack_api_key else "klingai" if settings.kling_api_key else "huggingface" if settings.hf_token else "google-veo" if settings.google_veo_api_key else "fal-omni" if settings.fal_key else settings.motion_provider,
    })
