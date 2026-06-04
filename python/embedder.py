"""
ONNX Runtime 推理封装

负责加载 Jina v2 base zh 模型，把文本转成 768 维向量。

模型下载：
  从 Hugging Face 下载 jina-embeddings-v2-base-zh.onnx
  https://huggingface.co/jinaai/jina-embeddings-v2-base-zh
  下载后放到 python/models/ 目录下

如果模型文件不存在，服务启动时会报错，但会给出明确的下载指引。
"""

import os
from pathlib import Path

import numpy as np
import onnxruntime as ort

# 模型文件路径（相对于本文件所在目录）
MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "jina-embeddings-v2-base-zh.onnx"


class Embedder:
    """
    文本向量化器

    使用 ONNX Runtime 加载 Jina v2 base zh 模型，在本地 CPU 上推理。
    Jina v2 base zh 输入中文文本，输出 768 维语义向量。

    使用方式：
        embedder = Embedder()
        vec = embedder.embed("你好世界")        # → [0.123, -0.456, ...] (768 个数字)
        vecs = embedder.batch_embed(["你好", "世界"])  # → [[...], [...]]
    """

    def __init__(self, model_path: str | None = None):
        """
        初始化向量化器，加载 ONNX 模型

        Args:
            model_path: 模型文件路径，不传则用默认路径

        Raises:
            FileNotFoundError: 模型文件不存在时抛出，并给出下载指引
        """
        target = Path(model_path) if model_path else MODEL_PATH

        if not target.exists():
            raise FileNotFoundError(
                f"\n{'='*60}\n"
                f"  ONNX 模型文件不存在: {target}\n"
                f"\n"
                f"  请从 Hugging Face 下载模型：\n"
                f"  https://huggingface.co/jinaai/jina-embeddings-v2-base-zh\n"
                f"\n"
                f"  下载 onnx/ 目录下的文件，放到:\n"
                f"  {MODEL_DIR}\n"
                f"{'='*60}\n"
            )

        # 创建 ONNX 推理会话
        # providers: 优先用 CPU（本地推理），有 GPU 可改为 CUDA
        self.session = ort.InferenceSession(
            str(target),
            providers=["CPUExecutionProvider"],
        )

        # 记录模型的输入名称（不同模型可能不同）
        self.input_name = self.session.get_inputs()[0].name
        print(f"[Embedder] 模型加载成功: {target.name}")
        print(f"[Embedder] 输入节点: {self.input_name}")

    def embed(self, text: str) -> list[float]:
        """
        将单条文本转为向量

        Args:
            text: 任意中文文本

        Returns:
            768 维浮点数列表
        """
        # ONNX 模型输入要求是 batch 形式，所以包一层列表
        inputs = {self.input_name: [text]}
        outputs = self.session.run(None, inputs)
        # outputs[0] shape: (1, 768) → 取第一个 → 转 Python 列表
        return outputs[0][0].tolist()

    def batch_embed(self, texts: list[str]) -> list[list[float]]:
        """
        将多条文本批量转为向量（比逐条调用更快）

        Args:
            texts: 文本列表

        Returns:
            768 维浮点数列表的列表
        """
        inputs = {self.input_name: texts}
        outputs = self.session.run(None, inputs)
        # outputs[0] shape: (batch_size, 768)
        return [vec.tolist() for vec in outputs[0]]
