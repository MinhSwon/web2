import asyncio
import json
from contextlib import asynccontextmanager

import aio_pika
from fastapi import FastAPI

from .pipeline import VideoPipeline
from .providers import debug_provider_summary
from .settings import settings

QUEUE_NAME = "video.render.jobs"
connection: aio_pika.RobustConnection | None = None
consumer_task: asyncio.Task | None = None
semaphore = asyncio.Semaphore(settings.max_concurrent_jobs)


async def handle_message(message: aio_pika.IncomingMessage) -> None:
    async with message.process(requeue=False):
        payload = json.loads(message.body)
        async with semaphore:
            pipeline = VideoPipeline()
            try:
                await pipeline.process(payload)
            except Exception as error:
                print(f"Job {payload.get('job_id')} failed: {error}")


async def consume() -> None:
    global connection
    while True:
        try:
            connection = await aio_pika.connect_robust(settings.rabbitmq_url)
            channel = await connection.channel()
            await channel.set_qos(prefetch_count=settings.max_concurrent_jobs)
            queue = await channel.declare_queue(QUEUE_NAME, durable=True)
            await queue.consume(handle_message)
            await asyncio.Future()
        except asyncio.CancelledError:
            raise
        except Exception as error:
            print(f"RabbitMQ unavailable: {error}")
            await asyncio.sleep(3)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global consumer_task
    consumer_task = asyncio.create_task(consume())
    yield
    consumer_task.cancel()
    await asyncio.gather(consumer_task, return_exceptions=True)
    if connection:
        await connection.close()


app = FastAPI(title="SaaS Video AI/Media Worker", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "worker", "providers": debug_provider_summary()}

