"""
Settings — persistência de configurações do usuário em config/settings.json.
"""

from pathlib import Path
import json

CONFIG_DIR = Path("config")
CONFIG_DIR.mkdir(exist_ok=True)
SETTINGS_FILE = CONFIG_DIR / "settings.json"

DEFAULTS = {
    "provider":   "claude",
    "providers": {
        "claude": {
            "api_key":         "",
            "model":           "claude-sonnet-4-5",
            "validator_model": "claude-haiku-4-5-20251001",
        },
        "openai": {
            "api_key":         "",
            "model":           "gpt-4.1-nano-2025-04-14",
            "validator_model": "gpt-4.1-nano-2025-04-14",
        },
        "ollama": {
            "base_url":        "http://localhost:11434",
            "model":           "llava",
        },
        "lmstudio": {
            "base_url":        "http://localhost:1234",
            "model":           "local-model",
        },
    },
    "yolo": {
        "model_path":  "models/best.pt",
        "conf":        0.40,
        "contencao":   0.80,
    },
    "pipeline": {
        "use_validator": True,
        "max_retries":   2,
        "batch_size":    1,
    },
    "ui": {
        "show_overlays":    True,
        "default_view":     "trad",
        "last_manga":       None,
        "last_chapter":     None,
        "last_page_index":  0,
    }
}

def _deep_merge(base: dict, overrides: dict) -> dict:
    """Mescla overrides em base recursivamente."""
    out = dict(base)
    for k, v in overrides.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out

def load() -> dict:
    """Carrega settings com defaults aplicados."""
    if not SETTINGS_FILE.exists():
        return dict(DEFAULTS)
    try:
        saved = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        return _deep_merge(DEFAULTS, saved)
    except Exception:
        return dict(DEFAULTS)

def save(settings: dict):
    """Persiste settings em disco."""
    SETTINGS_FILE.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")

def update(updates: dict) -> dict:
    """Atualiza parcialmente as settings (merge profundo)."""
    current = load()
    merged  = _deep_merge(current, updates)
    save(merged)
    return merged

def get_provider_config(provider: str) -> dict:
    """Pega config completa de um provedor."""
    s = load()
    return s["providers"].get(provider, {})

# ── Sanitização: nunca expor api_keys para o frontend ──────────────
def public_view(settings: dict) -> dict:
    """Retorna settings com api_keys mascaradas."""
    s = json.loads(json.dumps(settings))  # deep clone
    for prov, cfg in s.get("providers", {}).items():
        if "api_key" in cfg and cfg["api_key"]:
            cfg["api_key_set"] = True
            cfg["api_key"]     = ""    # nunca devolve a key
        else:
            cfg["api_key_set"] = False
    return s
