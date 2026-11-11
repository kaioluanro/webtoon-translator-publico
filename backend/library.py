"""
Library — gerencia a estrutura lib/<manga>/<cap>/<páginas>
"""

from pathlib import Path
from typing import Optional
import json
import re

LIB_DIR = Path("lib")
LIB_DIR.mkdir(exist_ok=True)

IMG_EXT = {".png", ".jpg", ".jpeg", ".webp"}

# ── Helpers ─────────────────────────────────────────────────────────
def natural_key(s: str):
    """Ordenação natural: 'cap_2' antes de 'cap_10'."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s)]

def safe_name(s: str) -> str:
    """Sanitiza nome de pasta — remove caracteres perigosos."""
    return re.sub(r'[^\w\s\-가-힣]', '', s).strip()

# ── API de leitura ──────────────────────────────────────────────────
def list_mangas() -> list[dict]:
    """Lista todos os mangás na pasta lib/."""
    if not LIB_DIR.exists(): return []
    items = []
    for d in sorted(LIB_DIR.iterdir(), key=lambda p: natural_key(p.name)):
        if not d.is_dir(): continue
        chapters = list_chapters(d.name)
        cover = None
        if chapters:
            first_pages = list_pages(d.name, chapters[0]["id"])
            if first_pages: cover = first_pages[0]["url"]
        items.append({
            "id":         d.name,
            "name":       d.name,
            "chapters":   len(chapters),
            "cover":      cover,
            "total_pages": sum(c["pages"] for c in chapters),
        })
    return items

def list_chapters(manga_id: str) -> list[dict]:
    """Lista capítulos de um mangá."""
    manga_dir = LIB_DIR / manga_id
    if not manga_dir.exists(): return []
    chapters = []
    for d in sorted(manga_dir.iterdir(), key=lambda p: natural_key(p.name)):
        if not d.is_dir(): continue
        pages = list_pages(manga_id, d.name)
        chapters.append({
            "id":    d.name,
            "name":  d.name,
            "pages": len(pages),
        })
    return chapters

def list_pages(manga_id: str, chapter_id: str) -> list[dict]:
    """Lista páginas de um capítulo (ordenado naturalmente)."""
    cap_dir = LIB_DIR / manga_id / chapter_id
    if not cap_dir.exists(): return []
    pages = []
    files = [p for p in cap_dir.iterdir()
             if p.is_file() and p.suffix.lower() in IMG_EXT]
    for i, p in enumerate(sorted(files, key=lambda x: natural_key(x.name))):
        pages.append({
            "id":    p.stem,
            "file":  p.name,
            "url":   f"/lib/{manga_id}/{chapter_id}/{p.name}",
            "index": i,
        })
    return pages

def get_page_path(manga_id: str, chapter_id: str, page_file: str) -> Optional[Path]:
    """Resolve caminho seguro para uma página."""
    p = (LIB_DIR / manga_id / chapter_id / page_file).resolve()
    lib_resolved = LIB_DIR.resolve()
    try:
        p.relative_to(lib_resolved)
    except ValueError:
        return None
    return p if p.exists() else None

# ── Cache de traduções ──────────────────────────────────────────────
def translation_path(manga_id: str, chapter_id: str, page_id: str) -> Path:
    """JSON de tradução de uma página."""
    return LIB_DIR / manga_id / chapter_id / f".{page_id}.translation.json"

def save_translation(manga_id: str, chapter_id: str, page_id: str, data: dict):
    """Salva tradução completa ou parcial em disco."""
    path = translation_path(manga_id, chapter_id, page_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def load_translation(manga_id: str, chapter_id: str, page_id: str) -> Optional[dict]:
    """Carrega tradução salva (se existe)."""
    path = translation_path(manga_id, chapter_id, page_id)
    if not path.exists(): return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None

def delete_translation(manga_id: str, chapter_id: str, page_id: str):
    """Remove cache de tradução (forçar retradução)."""
    path = translation_path(manga_id, chapter_id, page_id)
    if path.exists(): path.unlink()

def upsert_balloon(manga_id: str, chapter_id: str, page_id: str, balloon: dict, image_w: int = None, image_h: int = None) -> dict:
    """Insere ou atualiza um balão. Reordena por posição Y (top-to-bottom) e reindexa."""
    cache = load_translation(manga_id, chapter_id, page_id) or {
        "manga": manga_id, "chapter": chapter_id, "page_id": page_id,
        "balloons": [], "complete": False, "total": 0,
    }
    if image_w: cache["image_w"] = image_w
    if image_h: cache["image_h"] = image_h

    balloons = cache.get("balloons", [])

    # Substitui se já existe um com o mesmo index, senão adiciona
    found = False
    for i, b in enumerate(balloons):
        if b.get("index") == balloon.get("index"):
            balloons[i] = balloon
            found = True
            break
    if not found:
        balloons.append(balloon)

    # Reordena por Y (box[1] = topo do bounding box) e reindexa
    balloons.sort(key=lambda b: (b.get("box", [0,0,0,0])[1], b.get("box", [0,0,0,0])[0]))
    for i, b in enumerate(balloons):
        b["index"] = i

    cache["balloons"] = balloons
    cache["total"]    = len(balloons)
    save_translation(manga_id, chapter_id, page_id, cache)
    return cache

def remove_balloon(manga_id: str, chapter_id: str, page_id: str, index: int) -> dict:
    """Remove um balão pelo index. Reindexa os restantes para manter sequência."""
    cache = load_translation(manga_id, chapter_id, page_id)
    if not cache: return {}
    balloons = [b for b in cache.get("balloons", []) if b.get("index") != index]
    # Reindexar para manter contígua
    for i, b in enumerate(sorted(balloons, key=lambda x: x.get("index", 0))):
        b["index"] = i
    cache["balloons"] = balloons
    cache["total"]    = len(balloons)
    save_translation(manga_id, chapter_id, page_id, cache)
    return cache

# ── Navegação ───────────────────────────────────────────────────────
def navigate(manga_id: str, chapter_id: str, page_index: int, direction: str) -> Optional[dict]:
    """
    direction: "next" | "prev"
    Retorna {manga_id, chapter_id, page_index} do destino, ou None se fim/início.
    """
    chapters = list_chapters(manga_id)
    pages = list_pages(manga_id, chapter_id)

    if direction == "next":
        # Próxima página no mesmo capítulo?
        if page_index + 1 < len(pages):
            return {"manga_id": manga_id, "chapter_id": chapter_id, "page_index": page_index + 1}
        # Próximo capítulo
        cap_idx = next((i for i,c in enumerate(chapters) if c["id"] == chapter_id), -1)
        if cap_idx >= 0 and cap_idx + 1 < len(chapters):
            next_cap = chapters[cap_idx + 1]
            return {"manga_id": manga_id, "chapter_id": next_cap["id"], "page_index": 0}
        return None  # fim

    if direction == "prev":
        if page_index > 0:
            return {"manga_id": manga_id, "chapter_id": chapter_id, "page_index": page_index - 1}
        cap_idx = next((i for i,c in enumerate(chapters) if c["id"] == chapter_id), -1)
        if cap_idx > 0:
            prev_cap = chapters[cap_idx - 1]
            prev_pages = list_pages(manga_id, prev_cap["id"])
            return {
                "manga_id":   manga_id,
                "chapter_id": prev_cap["id"],
                "page_index": max(0, len(prev_pages) - 1)
            }
        return None

    return None
