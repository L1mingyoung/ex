"""
Download the Jina Chinese embedding ONNX model and tokenizer into python/models/.

Usage:
  python scripts/download_model.py

The model files stay out of git while real-embedding setup remains reproducible.
"""

from pathlib import Path

from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models"
MODEL_NAME = "jina-embeddings-v2-base-zh.onnx"
TOKENIZER_NAME = "tokenizer.json"
HF_MODEL_FILENAME = "onnx/model.onnx"
HF_TOKENIZER_FILENAME = "tokenizer.json"


def copy_from_hub(filename: str, target_name: str) -> Path:
    source = hf_hub_download(
        repo_id="jinaai/jina-embeddings-v2-base-zh",
        filename=filename,
    )
    target = MODEL_DIR / target_name
    target.write_bytes(Path(source).read_bytes())
    return target


def main() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_target = copy_from_hub(HF_MODEL_FILENAME, MODEL_NAME)
    tokenizer_target = copy_from_hub(HF_TOKENIZER_FILENAME, TOKENIZER_NAME)
    print(f"Downloaded model to: {model_target}")
    print(f"Downloaded tokenizer to: {tokenizer_target}")


if __name__ == "__main__":
    main()
