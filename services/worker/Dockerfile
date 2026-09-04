FROM web2-worker:latest
WORKDIR /app
COPY services/worker/app app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

