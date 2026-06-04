"""
ONNX Runtime 推理封装

负责加载 Jina v2 base zh 模型，把文本转成 768 维向量。

模型下载：
  python scripts/download_model.py

默认文件：
  python/models/jina-embeddings-v2-base-zh.onnx
  python/models/tokenizer.json

也可以通过环境变量 EMBEDDING_MODEL_PATH / EMBEDDING_TOKENIZER_PATH 指向任意绝对路径。
"""

import os
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

MODEL_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODEL_DIR / "jina-embeddings-v2-base-zh.onnx"
TOKENIZER_PATH = MODEL_DIR / "tokenizer.json"
MODEL_PATH_ENV = "EMBEDDING_MODEL_PATH"
TOKENIZER_PATH_ENV = "EMBEDDING_TOKENIZER_PATH"
MAX_LENGTH = int(os.environ.get("EMBEDDING_MAX_LENGTH", "512"))


class Embedder:
    """文本向量化器：Tokenizer -> ONNX -> mean pooling -> normalize。"""

    def __init__(self, model_path: str | None = None, tokenizer_path: str | None = None):
        configured_model = model_path or os.environ.get(MODEL_PATH_ENV)
        configured_tokenizer = tokenizer_path or os.environ.get(TOKENIZER_PATH_ENV)
        model_target = Path(configured_model) if configured_model else MODEL_PATH
        tokenizer_target = Path(configured_tokenizer) if configured_tokenizer else TOKENIZER_PATH

        if not model_target.exists() or not tokenizer_target.exists():
            raise FileNotFoundError(
                f"\n{'='*60}\n"
                f"  Embedding 文件不存在。\n"
                f"  模型: {model_target}\n"
                f"  Tokenizer: {tokenizer_target}\n"
                f"\n"
                f"  请运行下载脚本：\n"
                f"  .\\.venv\\Scripts\\python.exe scripts\\download_model.py\n"
                f"\n"
                f"  或设置环境变量 {MODEL_PATH_ENV} / {TOKENIZER_PATH_ENV}\n"
                f"{'='*60}\n"
            )

        self.session = ort.InferenceSession(
            str(model_target),
            providers=["CPUExecutionProvider"],
        )
        self.tokenizer = Tokenizer.from_file(str(tokenizer_target))
        self.tokenizer.enable_truncation(max_length=MAX_LENGTH)

        self.input_names = {i.name for i in self.session.get_inputs()}
        self.output_name = self.session.get_outputs()[0].name
        self.pad_token_id = self.tokenizer.token_to_id("[PAD]")
        if self.pad_token_id is None:
            self.pad_token_id = 0

        print(f"[Embedder] 模型加载成功: {model_target.name}")
        print(f"[Embedder] Tokenizer 加载成功: {tokenizer_target.name}")
        print(f"[Embedder] 输入节点: {sorted(self.input_names)}")

    def _encode(self, texts: list[str]) -> dict[str, np.ndarray]:
        encodings = self.tokenizer.encode_batch(texts)
        max_len = max(len(e.ids) for e in encodings)
        max_len = min(max_len, MAX_LENGTH)

        input_ids: list[list[int]] = []
        attention_mask: list[list[int]] = []
        for encoding in encodings:
            ids = encoding.ids[:max_len]
            mask = [1] * len(ids)
            pad_len = max_len - len(ids)
            if pad_len > 0:
                ids = ids + [self.pad_token_id] * pad_len
                mask = mask + [0] * pad_len
            input_ids.append(ids)
            attention_mask.append(mask)

        feeds = {
            "input_ids": np.asarray(input_ids, dtype=np.int64),
            "attention_mask": np.asarray(attention_mask, dtype=np.int64),
        }
        return {k: v for k, v in feeds.items() if k in self.input_names}

    @staticmethod
    def _mean_pool(last_hidden_state: np.ndarray, attention_mask: np.ndarray) -> np.ndarray:
        mask = attention_mask[..., None].astype(np.float32)
        summed = (last_hidden_state * mask).sum(axis=1)
        counts = np.clip(mask.sum(axis=1), a_min=1e-9, a_max=None)
        embeddings = summed / counts
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        return embeddings / np.clip(norms, a_min=1e-9, a_max=None)

    def embed(self, text: str) -> list[float]:
        """将单条文本转为 768 维向量。"""
        return self.batch_embed([text])[0]

    def batch_embed(self, texts: list[str]) -> list[list[float]]:
        """将多条文本批量转为 768 维向量。"""
        if not texts:
            return []
        feeds = self._encode(texts)
        outputs = self.session.run([self.output_name], feeds)
        last_hidden_state = outputs[0]
        embeddings = self._mean_pool(last_hidden_state, feeds["attention_mask"])
        return embeddings.astype(float).tolist()
