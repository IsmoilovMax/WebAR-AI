# AI Worker

RTSP oqimlarni o'qiydi, model inference ni bajaradi va tasdiqlangan
eventlarni Redis Stream ga yozadi.

## Modellar

`models/` papkasiga quyidagi fayllar qo'yiladi. Fayl bo'lmasa, tegishli
detektor avtomatik o'chadi va sabab `/status` da ko'rinadi — servis ishdan
chiqmaydi.

| Fayl | Detektor | Manba |
|---|---|---|
| `person.pt` | Odam aniqlash + tracking | COCO pretrained YOLO, o'qitish shart emas |
| `pose.pt` | Yiqilish, chekish geometriyasi | YOLO11-pose, pretrained |
| `fire_smoke.pt` | Yong'in va tutun | Roboflow da fine-tune qilingan |
| `cigarette.pt` | Chekish | Roboflow da o'qitilgan |
| `face.pt` | Demografiya fallback | YOLO yuz (InsightFace yo'q bo'lsa) |
| `genderage.onnx` | Jins/yosh fallback | YOLO face bilan |
| `insightface/models/buffalo_sc/` | **Asosiy demografiya** | RetinaFace + ArcFace 512-d + genderage |

### Demografiya (default)

1. **Detection:** RetinaFace (`buffalo_sc`)
2. **Recognition:** ArcFace 512-d embedding, cosine similarity, threshold **0.42**
   (faqat xotirada track qayta bog'lash — DB ga yozilmaydi)
3. **Gender/age:** paketdagi `genderage`

O'chirish / fallback: `ACS_INSIGHTFACE=false` — u holda `face.pt` + `genderage.onnx`.

Bazaviy modellarni olish:

```bash
cd services/ai-worker/models
yolo export model=yolo11n.pt format=onnx      # yoki .pt ni to'g'ridan-to'g'ri ishlating
mv yolo11n.pt person.pt
mv yolo11n-pose.pt pose.pt
```

### Litsenziya haqida ogohlantirish

InsightFace ning `buffalo_l` / `antelopev2` paketlari **faqat tijorat
bo'lmagan tadqiqot uchun** litsenziyalangan. Ularni sotiladigan mahsulotda
ishlatib bo'lmaydi. `genderage.onnx` uchun UTKFace yoki FairFace kabi ochiq
litsenziyali datasetda o'z modelingizni o'qiting. Kutilayotgan kirish/chiqish
shakli `app/pipeline/face.py` da hujjatlashtirilgan.

## Ishga tushirish

```bash
python -m venv .venv && .venv/Scripts/activate    # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Python 3.11 yoki 3.12 ishlating. 3.13+ da torch g'ildiraklari hali barqaror emas.

## TensorRT ga o'tish

CPU dan GPU ga o'tgandan keyin keyingi qadam TensorRT:

```bash
yolo export model=person.pt format=engine half=True device=0
```

Ultralytics `.engine` faylini ham xuddi `.pt` kabi yuklaydi, shuning uchun
kodni o'zgartirish shart emas — faqat fayl nomini `person.pt` qoldiring
yoki `ModelRegistry.FILENAMES` ni yangilang.

## Sig'im

Bitta o'rta GPU (RTX 4060 Ti / T4) da 640x640, FP16:

- faqat `person`: ~25-40 kamera, 6 fps
- `person` + `pose`: ~12-18 kamera
- barcha detektorlar yoqilgan: **8-12 kamera**

CPU da faqat 1-2 kamera, 3-5 fps, va faqat `person`. `fall` va
`demographics` ni CPU da yoqmang.

12 dan ortiq kamera kerak bo'lsa, thread-per-camera modeli yetmaydi —
batched inference yoki NVIDIA DeepStream ga o'tish kerak.
