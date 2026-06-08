# Docker Deployment

This project can run as a three-service Docker Compose stack:

- `api`: NestJS backend, also serves `web/dist`.
- `embedding`: Python FastAPI embedding service.
- `postgres`: PostgreSQL with pgvector.

## 1. Prepare environment

Copy the Docker env template:

```powershell
copy .env.docker.example .env.docker
```

Edit `.env.docker` and set:

- `DB_PASSWORD`
- `DEEPSEEK_API_KEY`

## 2. Prepare embedding model

Real embedding mode expects:

```text
python/models/jina-embeddings-v2-base-zh.onnx
python/models/tokenizer.json
```

If the model is not ready yet, set this in `.env.docker`:

```text
MOCK_EMBEDDING=1
```

Mock mode is only for stack testing. Real memory search should use the ONNX model. The model directory is mounted into the embedding container as `/app/models`, so the large ONNX file is not baked into the Docker image.

## 3. Build and start

```powershell
docker compose --env-file .env.docker up --build
```

Open:

```text
http://localhost:3000
```

## 4. Stop

```powershell
docker compose --env-file .env.docker down
```

Keep database data:

```powershell
docker compose --env-file .env.docker down
```

Delete database data:

```powershell
docker compose --env-file .env.docker down -v
```

## Notes

- Inside Docker, the API connects to Postgres by service name: `postgres:5432`.
- Inside Docker, the API connects to embedding by service name: `http://embedding:8000`.
- TypeORM migrations run automatically on API startup.
- `exports/` is ignored by git because it can contain local chat exports.
