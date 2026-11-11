"""
Webtoon Translator — Aplicação principal
========================================
Estrutura:
  lib/<manga>/<cap>/<páginas>          ← biblioteca de mangás
  lib/<manga>/<cap>/.<page>.translation.json ← cache de traduções
  config/settings.json                  ← preferências do usuário
  backend/                              ← lógica
"""

import os, json, time, uuid
from pathlib import Path
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

from flask import (Flask, render_template, request, jsonify,
                   send_from_directory, Response, stream_with_context, abort)

from backend import library, settings, detector, translators

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024

# ── SSE helpers ──────────────────────────────────────────────────────
def sse(event, data): return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
def sse_ping():        return f"event: ping\ndata: {{}}\n\n"

# ────────────────────────────────────────────────────────────────────
# Páginas
# ────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/lib/<manga>/<chapter>/<page>")
def serve_page(manga, chapter, page):
    """Serve as imagens das páginas dos mangás."""
    p = library.get_page_path(manga, chapter, page)
    if p is None: abort(404)
    return send_from_directory(p.parent, p.name)

# ────────────────────────────────────────────────────────────────────
# Library API
# ────────────────────────────────────────────────────────────────────
@app.route("/api/library")
def api_library():
    return jsonify({"mangas": library.list_mangas()})

@app.route("/api/library/<manga>")
def api_manga(manga):
    chapters = library.list_chapters(manga)
    if not chapters: return jsonify({"error":"Mangá não encontrado"}), 404
    return jsonify({"manga": manga, "chapters": chapters})

@app.route("/api/library/<manga>/<chapter>")
def api_chapter(manga, chapter):
    pages = library.list_pages(manga, chapter)
    if not pages: return jsonify({"error":"Capítulo não encontrado"}), 404

    # Anexa info se cada página tem tradução em cache
    for p in pages:
        cached = library.load_translation(manga, chapter, p["id"])
        p["has_cache"] = cached is not None
        p["complete"]  = cached.get("complete", False) if cached else False

    return jsonify({"manga": manga, "chapter": chapter, "pages": pages})

@app.route("/api/page/<manga>/<chapter>/<int:page_index>")
def api_page(manga, chapter, page_index):
    """Retorna info da página + tradução em cache se existir."""
    pages = library.list_pages(manga, chapter)
    if page_index < 0 or page_index >= len(pages):
        return jsonify({"error":"Página inválida"}), 404

    page = pages[page_index]
    cached = library.load_translation(manga, chapter, page["id"])

    chapters = library.list_chapters(manga)
    cap_idx = next((i for i,c in enumerate(chapters) if c["id"] == chapter), -1)

    return jsonify({
        "manga":         manga,
        "chapter":       chapter,
        "page":          page,
        "page_count":    len(pages),
        "chapter_index": cap_idx,
        "chapter_count": len(chapters),
        "translation":   cached,
        "nav": {
            "prev": library.navigate(manga, chapter, page_index, "prev"),
            "next": library.navigate(manga, chapter, page_index, "next"),
        }
    })

@app.route("/api/translation/<manga>/<chapter>/<page_id>", methods=["DELETE"])
def api_clear_translation(manga, chapter, page_id):
    """Limpa cache de tradução para forçar retradução."""
    library.delete_translation(manga, chapter, page_id)
    return jsonify({"ok": True})

@app.route("/api/translate-box/<manga>/<chapter>/<page_id>", methods=["POST"])
def api_translate_box(manga, chapter, page_id):
    """
    Traduz uma caixa específica (criada/movida manualmente).
    Body JSON:
      {
        "index":  int (-1 = nova, ou index existente para refazer),
        "box":    [x1, y1, x2, y2] em pixels da imagem original
      }
    Retorna o balão traduzido.
    """
    data = request.get_json(force=True) or {}
    box   = data.get("box")
    index = data.get("index", -1)

    if not box or len(box) != 4:
        return jsonify({"error": "box inválida"}), 400

    # Localizar a página
    pages = library.list_pages(manga, chapter)
    page = next((p for p in pages if p["id"] == page_id), None)
    if page is None:
        return jsonify({"error": "Página não encontrada"}), 404

    img_path = library.get_page_path(manga, chapter, page["file"])
    if img_path is None:
        return jsonify({"error": "Imagem não encontrada"}), 404

    # Recortar a caixa com Pillow
    img = Image.open(img_path).convert("RGB")
    img_w, img_h = img.size
    x1, y1, x2, y2 = [max(0, int(v)) for v in box]
    x2 = min(x2, img_w); y2 = min(y2, img_h)
    if x2 <= x1 or y2 <= y1:
        return jsonify({"error": "box com dimensões inválidas"}), 400

    crop = img.crop((x1, y1, x2, y2))
    buf  = BytesIO(); crop.save(buf, "PNG")
    import base64 as _b64
    crop_b64 = _b64.b64encode(buf.getvalue()).decode()

    # Resolver index se for nova
    cache = library.load_translation(manga, chapter, page_id) or {"balloons":[]}
    if index < 0:
        existing = cache.get("balloons", [])
        index = max([b.get("index", -1) for b in existing], default=-1) + 1

    # Carregar settings e traduzir
    s = settings.load()
    cfg = {"provider": s["provider"], **s["providers"][s["provider"]]}
    pipeline_cfg = s["pipeline"]

    if pipeline_cfg.get("use_validator", True):
        resultado = translators.traduzir_com_validacao(
            crop_b64, cfg,
            max_retries=int(pipeline_cfg.get("max_retries", 2))
        )
        t        = resultado["translation"]
        val      = resultado["validation"]
        attempts = resultado["attempts"]
        valid    = resultado["valid"]
    else:
        t = translators.chamar_tradutor(crop_b64, cfg)
        val, attempts = None, 1
        valid = bool(t.get("traducao", "").strip())

    balloon_data = {
        "index":      index,
        "box":        [x1, y1, x2, y2],
        "classe":     "balloon",
        "conf":       1.0,           # criada manualmente
        "manual":     True,          # flag de origem manual
        "crop_b64":   crop_b64,
        "original":   t.get("original", ""),
        "traducao":   t.get("traducao", ""),
        "personagem": t.get("personagem", "?"),
        "tipo":       t.get("tipo", "fala"),
        "validation": val,
        "attempts":   attempts,
        "valid":      valid,
    }

    cache = library.upsert_balloon(manga, chapter, page_id, balloon_data, image_w=img_w, image_h=img_h)
    # Após upsert, o balão pode ter novo index (reordenado por Y).
    # Localiza o balão correspondente comparando pela box.
    final_balloon = next(
        (b for b in cache["balloons"] if b.get("box") == balloon_data["box"]),
        balloon_data
    )
    return jsonify({"balloon": final_balloon, "balloons": cache["balloons"]})

@app.route("/api/balloon/<manga>/<chapter>/<page_id>/<int:index>", methods=["DELETE"])
def api_delete_balloon(manga, chapter, page_id, index):
    """Remove um balão específico do cache."""
    cache = library.remove_balloon(manga, chapter, page_id, index)
    return jsonify({"ok": True, "total": cache.get("total", 0)})

# ────────────────────────────────────────────────────────────────────
# Settings API
# ────────────────────────────────────────────────────────────────────
@app.route("/api/settings", methods=["GET"])
def api_get_settings():
    return jsonify(settings.public_view(settings.load()))

@app.route("/api/settings", methods=["PUT"])
def api_update_settings():
    """Atualiza settings parcialmente. Não sobrescreve api_key se vier vazia."""
    updates = request.get_json(force=True) or {}
    current = settings.load()

    # Não apagar api_keys existentes se o frontend mandou vazio
    for prov, cfg in updates.get("providers", {}).items():
        if "api_key" in cfg and cfg["api_key"] == "":
            existing = current.get("providers",{}).get(prov,{}).get("api_key","")
            if existing:
                cfg["api_key"] = existing  # mantém

    merged = settings.update(updates)
    return jsonify(settings.public_view(merged))

# ────────────────────────────────────────────────────────────────────
# Tradução (SSE) — usa settings persistidos
# ────────────────────────────────────────────────────────────────────
@app.route("/api/translate/<manga>/<chapter>/<int:page_index>", methods=["POST"])
def api_translate(manga, chapter, page_index):
    """
    Roda o pipeline para uma página específica.
    SSE stream + salvamento incremental no JSON da página.
    """
    pages = library.list_pages(manga, chapter)
    if page_index < 0 or page_index >= len(pages):
        return jsonify({"error":"Página inválida"}), 404

    page = pages[page_index]
    img_path = library.get_page_path(manga, chapter, page["file"])
    if img_path is None:
        return jsonify({"error":"Imagem não encontrada"}), 404

    s = settings.load()
    provider = s["provider"]
    prov_cfg = s["providers"][provider]

    # Cfg para os tradutores
    cfg = {
        "provider":         provider,
        **prov_cfg,
    }

    yolo_cfg = s["yolo"]
    pipeline_cfg = s["pipeline"]

    page_id = page["id"]

    def generate():
        yield sse_ping()

        # ── Detectar balões ────────────────────────────
        try:
            yield sse("status", {"msg":"Detectando balões…","step":"detect"})
            dets, (img_w, img_h) = detector.detectar(
                img_path, Path(yolo_cfg["model_path"]),
                conf=float(yolo_cfg["conf"]),
                limiar=float(yolo_cfg["contencao"])
            )
        except FileNotFoundError as e:
            yield sse("error", {"msg":str(e),"yolo_missing":True}); return
        except Exception as e:
            yield sse("error", {"msg":f"Erro na detecção: {e}"}); return

        total = len(dets)
        yield sse("detected", {"total":total,"image_w":img_w,"image_h":img_h})

        # Inicializa estrutura de cache
        cache = {
            "manga":     manga,
            "chapter":   chapter,
            "page_id":   page_id,
            "image_w":   img_w,
            "image_h":   img_h,
            "total":     total,
            "balloons":  [],
            "complete":  False,
            "provider":  provider,
            "started_at": int(time.time()),
        }

        if total == 0:
            cache["complete"] = True
            cache["finished_at"] = int(time.time())
            library.save_translation(manga, chapter, page_id, cache)
            yield sse("done", {"total":0}); return

        # ── Traduzir em batches paralelos ───────────────
        batch_size = max(1, int(pipeline_cfg.get("batch_size", 1)))

        def _translate_one(idx_det):
            i, det = idx_det
            if pipeline_cfg.get("use_validator", True):
                resultado = translators.traduzir_com_validacao(
                    det["crop_b64"], cfg,
                    max_retries=int(pipeline_cfg.get("max_retries", 2))
                )
                t        = resultado["translation"]
                val      = resultado["validation"]
                attempts = resultado["attempts"]
                valid    = resultado["valid"]
            else:
                t = translators.chamar_tradutor(det["crop_b64"], cfg)
                val, attempts = None, 1
                valid = bool(t.get("traducao","").strip())

            return i, det, {
                "index":      i,
                "box":        list(det["box"]),
                "classe":     det["classe"],
                "conf":       det["conf"],
                "crop_b64":   det["crop_b64"],
                "original":   t.get("original",""),
                "traducao":   t.get("traducao",""),
                "personagem": t.get("personagem","?"),
                "tipo":       t.get("tipo","fala"),
                "validation": val,
                "attempts":   attempts,
                "valid":      valid,
            }

        completed = 0
        # Processar em chunks de tamanho batch_size
        for chunk_start in range(0, total, batch_size):
            chunk = list(enumerate(dets))[chunk_start:chunk_start + batch_size]

            yield sse("status", {
                "msg": f"Traduzindo batch {chunk_start//batch_size + 1} ({len(chunk)} balões em paralelo)…",
                "step":"translate", "i": chunk_start, "total": total
            })

            # Executa o chunk em paralelo
            with ThreadPoolExecutor(max_workers=len(chunk)) as ex:
                futures = [ex.submit(_translate_one, item) for item in chunk]

                for fut in as_completed(futures):
                    try:
                        i, det, balloon_data = fut.result()
                    except Exception as e:
                        yield sse("error", {"msg": f"Erro no batch: {e}"})
                        continue

                    # Salvamento incremental — mantém ordem por index
                    cache["balloons"].append(balloon_data)
                    cache["balloons"].sort(key=lambda b: b["index"])
                    library.save_translation(manga, chapter, page_id, cache)

                    completed += 1
                    yield sse("balloon", {**balloon_data, "total": total})
                    yield sse_ping()

            time.sleep(0.05)

        # Marca como completo
        cache["complete"]    = True
        cache["finished_at"] = int(time.time())
        library.save_translation(manga, chapter, page_id, cache)

        yield sse("done", {"total": total})

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering":"no",
            "Connection":       "keep-alive",
        }
    )

# ────────────────────────────────────────────────────────────────────
# Run
# ────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n📚 Webtoon Translator")
    print(f"   Library:  {library.LIB_DIR.resolve()}")
    print(f"   Config:   {settings.SETTINGS_FILE.resolve()}")
    s = settings.load()
    print(f"   Provider: {s['provider']}")
    print(f"   YOLO:     {s['yolo']['model_path']}")
    print(f"   Server:   http://localhost:5000\n")
    app.run(debug=True, host="0.0.0.0", port=5000, threaded=True)
