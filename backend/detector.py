"""
YOLO detector — detecção de balões e filtro anti-sobreposição.
"""

from pathlib import Path
from io import BytesIO
import base64
from PIL import Image

_yolo_model = None
_yolo_path  = None

def get_model(model_path: Path):
    """Lazy-load do modelo YOLO. Recarrega se o path mudar."""
    global _yolo_model, _yolo_path
    if _yolo_model is not None and _yolo_path == model_path:
        return _yolo_model
    if not Path(model_path).exists():
        raise FileNotFoundError(f"Modelo YOLO não encontrado: {model_path}")
    from ultralytics import YOLO
    _yolo_model = YOLO(str(model_path))
    _yolo_path  = model_path
    return _yolo_model

# ── Filtro de contenção ─────────────────────────────────────────────
def _area(b): return max(0, b[2]-b[0]) * max(0, b[3]-b[1])
def _inter(a, b):
    return (max(0, min(a[2],b[2])-max(a[0],b[0])) *
            max(0, min(a[3],b[3])-max(a[1],b[1])))

def filtrar_contencao(dets, limiar=0.80):
    if len(dets) <= 1: return dets
    rem = set()
    for i, a in enumerate(dets):
        if i in rem: continue
        for j, b in enumerate(dets):
            if i == j or j in rem: continue
            aa = _area(a["box"])
            if aa == 0:
                rem.add(i); break
            if _inter(a["box"], b["box"]) / aa >= limiar and aa <= _area(b["box"]):
                rem.add(i); break
    return [d for i, d in enumerate(dets) if i not in rem]

# ── Pipeline de detecção ────────────────────────────────────────────
def detectar(img_path: Path, model_path: Path, conf=0.40, limiar=0.80):
    """
    Detecta balões na imagem, recorta, retorna list[dict] com:
        box, classe, conf, crop_b64
    """
    model = get_model(model_path)
    img   = Image.open(img_path).convert("RGB")
    res   = model(str(img_path), conf=conf, verbose=False)[0]
    nomes = model.names

    dets = []
    for box in res.boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        dets.append({
            "box":    (x1, y1, x2, y2),
            "classe": nomes[int(box.cls[0])],
            "conf":   round(float(box.conf[0]), 3),
        })

    dets = filtrar_contencao(dets, limiar)
    dets.sort(key=lambda d: d["box"][1])  # ordem de leitura: cima → baixo

    for det in dets:
        x1, y1, x2, y2 = det["box"]
        crop = img.crop((x1, y1, x2, y2))
        buf  = BytesIO()
        crop.save(buf, "PNG")
        det["crop_b64"] = base64.b64encode(buf.getvalue()).decode()

    return dets, img.size
