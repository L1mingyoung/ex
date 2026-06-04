"""
AI Companion - 文本向量化服务

职责：把文本转成 768 维数字向量（Embedding）。
只有两个 API，只做一件事。检索由 PostgreSQL 做。

启动方式：
    uv run uvicorn main:app --port 8000

    # 如果模型还没下载，使用假向量模式先跑通流程：
    uv run uvicorn main:app --port 8000 -- --mock
    # 或设置环境变量：
    MOCK_EMBEDDING=1 uv run uvicorn main:app --port 8000

API：
    POST /embed        — 单条文本向量化
    POST /batch_embed  — 批量文本向量化
"""

import os
import sys

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(
    title="AI Companion Embedding Service",
    version="0.1.0",
)

# ─── 模型初始化 ───────────────────────────────────────────

# 支持 --mock 参数或 MOCK_EMBEDDING 环境变量
# 在模型还没下载时，使用随机假向量先跑通 API 流程
USE_MOCK = "--mock" in sys.argv or os.environ.get("MOCK_EMBEDDING") == "1"

if USE_MOCK:
    import random

    print("[Embedder] [MOCK MODE] Using random vectors for testing only")
    print("[Embedder] Download the ONNX model and remove MOCK_EMBEDDING env var to use real embeddings")

    def embed(text: str) -> list[float]:
        """假向量化：固定 seed 保证同一文本产生相同向量"""
        random.seed(hash(text) % (2**31))
        return [random.random() for _ in range(768)]

    def batch_embed(texts: list[str]) -> list[list[float]]:
        """批量假向量化"""
        return [embed(t) for t in texts]

else:
    try:
        from embedder import Embedder

        engine = Embedder()

        def embed(text: str) -> list[float]:
            return engine.embed(text)

        def batch_embed(texts: list[str]) -> list[list[float]]:
            return engine.batch_embed(texts)

    except FileNotFoundError as e:
        print(str(e))
        print(
            "Hint: Use MOCK mode first to verify the flow works:\n"
            "  MOCK_EMBEDDING=1 uv run uvicorn main:app --port 8000\n"
        )
        sys.exit(1)


# ─── 请求/响应模型 ────────────────────────────────────────


class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    embedding: list[float]


class BatchEmbedResponse(BaseModel):
    embeddings: list[list[float]]


# ─── API 端点 ─────────────────────────────────────────────


@app.post("/embed", response_model=EmbedResponse)
async def embed_endpoint(req: EmbedRequest):
    """
    单条文本向量化

    POST /embed
    Body: { "text": "你好世界" }
    Response: { "embedding": [0.123, -0.456, ...] }  ← 768 维
    """
    return EmbedResponse(embedding=embed(req.text))


@app.post("/batch_embed", response_model=BatchEmbedResponse)
async def batch_embed_endpoint(texts: list[str]):
    """
    批量文本向量化

    POST /batch_embed
    Body: ["文本1", "文本2", "文本3"]
    Response: { "embeddings": [[...], [...], [...]] }
    """
    return BatchEmbedResponse(embeddings=batch_embed(texts))


@app.get("/health")
async def health():
    """健康检查"""
    return {
        "status": "ok",
        "mock_mode": USE_MOCK,
        "dimensions": 768,
    }
