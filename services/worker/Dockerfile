FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY services/worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/worker/app app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

