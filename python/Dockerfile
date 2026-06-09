# syntax=docker/dockerfile:1

FROM python:3.12-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple/ uv

# 国内镜像加速 + 超时设置
ENV UV_HTTP_TIMEOUT=120
ENV UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple/

COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev

COPY main.py embedder.py ./
RUN mkdir -p /app/models

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
