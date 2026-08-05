# CPU varianti. GPU uchun quyidagi qatorni almashtiring:
#   FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
# va requirements.txt da cpu torch o'rniga default CUDA torch + onnxruntime-gpu.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # Ultralytics/torch CUDA g'ildiragini tortmasin.
    CUDA_VISIBLE_DEVICES=""

# libgl va libglib: OpenCV uchun. ffmpeg kutubxonalari: PyAV uchun.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 \
      libglib2.0-0 \
      ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
# Avval CPU torch, keyin qolganlari — ultralytics CUDA torch o'rnatmasin.
RUN pip install --no-cache-dir \
      --extra-index-url https://download.pytorch.org/whl/cpu \
      "torch==2.5.1+cpu" "torchvision==0.20.1+cpu" \
    && pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Modellar volume orqali ulanadi, image ichiga qo'yilmaydi: ular og'ir
# va mijozdan mijozga farq qiladi.
ENV MODELS_DIR=/models

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
