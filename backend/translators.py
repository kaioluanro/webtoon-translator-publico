"""
Translators — agentes de tradução e validação multi-provider.

Schema Pydantic compartilhado entre Claude/OpenAI/Ollama/LM Studio.
Cada provedor usa seu mecanismo nativo de structured output:
  - Claude:    tool_use forçado
  - OpenAI:    response_format json_schema strict
  - Ollama:    format=schema (constrained decoding)
  - LM Studio: response_format json_schema strict
"""

import json
from typing import Literal, Optional
from pydantic import BaseModel, Field, ValidationError

# ── Schemas ────────────────────────────────────────────────────────
class Translation(BaseModel):
    original:   str = Field(description="Texto original em coreano lido do balão")
    traducao:   str = Field(description="Tradução para português brasileiro")
    personagem: str = Field(default="?", description="Nome do personagem ou 'Narrador'")
    tipo:       Literal["fala","grito","narração","sfx","pensamento"] = Field(default="fala")

class Validation(BaseModel):
    has_text:      bool = Field(description="O balão contém texto legível em coreano?")
    is_translated: bool = Field(description="A tradução está em português brasileiro e faz sentido?")
    is_complete:   bool = Field(description="A tradução cobre todo o texto original?")
    feedback:      str  = Field(default="", description="Se inválido, explique em 1 frase curta")

# ── Prompts ────────────────────────────────────────────────────────
PROMPT_TRADUTOR = """Você é um tradutor especializado em manhwa e webtoon coreano para português brasileiro.

Recebe a imagem de um balão de fala, caixa de narração ou efeito sonoro.
Sua tarefa:
1. Leia o texto coreano (한글) presente na imagem
2. Traduza para português brasileiro natural e fluido
3. Identifique o personagem (use "Narrador" para caixas de narração)
4. Classifique o tipo: fala, grito, narração, sfx ou pensamento

Se não conseguir ler nenhum texto, retorne string vazia em "original" e "traducao"."""

PROMPT_TRADUTOR_RETRY = """Você é um tradutor especializado em manhwa e webtoon coreano.

A tentativa anterior teve este problema: {feedback}

Tente novamente com mais cuidado. Leia o texto coreano e traduza para português brasileiro."""

PROMPT_VALIDADOR = """Você é um validador de traduções de manhwa.

Você recebe:
- A imagem original do balão
- O texto que foi extraído como "original" coreano
- A tradução proposta em português brasileiro

Sua tarefa é verificar:
1. has_text: a imagem do balão contém texto coreano legível? (true/false)
2. is_translated: a tradução está em português correto e faz sentido? (true/false)
3. is_complete: a tradução cobre o texto original sem omitir partes? (true/false)
4. feedback: se algo está errado, descreva em uma frase curta o que precisa ser corrigido

Seja rigoroso. Uma tradução vazia ou que apenas repete o coreano não é válida.
Se has_text for false, então is_translated e is_complete também devem ser false."""

# ── Helper de extração ─────────────────────────────────────────────
def _extrair_json(text: str) -> dict:
    text = (text or "").strip()
    if "```" in text:
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"): text = text[4:]
    text = text.strip()
    if "{" in text:
        start = text.index("{")
        depth = 0
        for i, c in enumerate(text[start:], start):
            if c == "{": depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try: return json.loads(text[start:i+1])
                    except: break
    try: return json.loads(text)
    except: return {}

# ── Tradutores ─────────────────────────────────────────────────────
def _tradutor_claude(b64, key, model, retry_feedback=None):
    import anthropic
    c = anthropic.Anthropic(api_key=key)
    sys_prompt = PROMPT_TRADUTOR_RETRY.format(feedback=retry_feedback) if retry_feedback else PROMPT_TRADUTOR
    schema = Translation.model_json_schema()
    r = c.messages.create(
        model=model, max_tokens=512, system=sys_prompt,
        tools=[{
            "name": "submit_translation",
            "description": "Submete a tradução do balão",
            "input_schema": {
                "type": "object",
                "properties": schema["properties"],
                "required": ["original","traducao","personagem","tipo"]
            }
        }],
        tool_choice={"type":"tool","name":"submit_translation"},
        messages=[{
            "role":"user","content":[
                {"type":"image","source":{"type":"base64","media_type":"image/png","data":b64}},
                {"type":"text","text":"Traduza este balão."}
            ]}])
    for block in r.content:
        if block.type == "tool_use":
            return block.input
    return {}

def _tradutor_openai(b64, key, model, retry_feedback=None):
    from openai import OpenAI
    c = OpenAI(api_key=key)
    sys_prompt = PROMPT_TRADUTOR_RETRY.format(feedback=retry_feedback) if retry_feedback else PROMPT_TRADUTOR
    schema = Translation.model_json_schema()
    schema["additionalProperties"] = False
    schema["required"] = list(schema["properties"].keys())
    r = c.chat.completions.create(
        model=model, max_completion_tokens=512,
        response_format={"type":"json_schema","json_schema":{"name":"translation","schema":schema,"strict":True}},
        messages=[
            {"role":"system","content":sys_prompt},
            {"role":"user","content":[
                {"type":"image_url","image_url":{"url":f"data:image/png;base64,{b64}"}},
                {"type":"text","text":"Traduza este balão."}
            ]}])
    return _extrair_json(r.choices[0].message.content)

def _tradutor_ollama(b64, model, url, retry_feedback=None):
    import requests
    sys_prompt = PROMPT_TRADUTOR_RETRY.format(feedback=retry_feedback) if retry_feedback else PROMPT_TRADUTOR
    schema = Translation.model_json_schema()
    r = requests.post(f"{url}/api/generate", json={
        "model": model, "system": sys_prompt, "prompt":"Traduza este balão.",
        "images":[b64], "format": schema, "stream":False,
        "options": {"temperature": 0.3}
    }, timeout=240)
    r.raise_for_status()
    return _extrair_json(r.json().get("response",""))

def _tradutor_lmstudio(b64, model, url, retry_feedback=None):
    import requests
    sys_prompt = PROMPT_TRADUTOR_RETRY.format(feedback=retry_feedback) if retry_feedback else PROMPT_TRADUTOR
    schema = Translation.model_json_schema()
    schema["required"] = list(schema["properties"].keys())
    r = requests.post(f"{url}/v1/chat/completions", json={
        "model": model, "max_completion_tokens": 512, "temperature": 0.3,
        "response_format": {"type":"json_schema","json_schema":{"name":"translation","schema":schema,"strict":True}},
        "messages":[
            {"role":"system","content":sys_prompt},
            {"role":"user","content":[
                {"type":"image_url","image_url":{"url":f"data:image/png;base64,{b64}"}},
                {"type":"text","text":"Traduza este balão."}
            ]}
        ]}, timeout=240)
    r.raise_for_status()
    return _extrair_json(r.json()["choices"][0]["message"]["content"])

# ── Validadores ────────────────────────────────────────────────────
def _validador_claude(b64, traducao, key, model):
    import anthropic
    c = anthropic.Anthropic(api_key=key)
    schema = Validation.model_json_schema()
    user_text = (
        f"Original detectado: «{traducao.get('original','')}»\n"
        f"Tradução proposta: «{traducao.get('traducao','')}»\n"
        f"Personagem: «{traducao.get('personagem','?')}»\n"
        f"Tipo: «{traducao.get('tipo','fala')}»\n\n"
        "Valide esta tradução."
    )
    r = c.messages.create(
        model=model, max_tokens=300, system=PROMPT_VALIDADOR,
        tools=[{
            "name":"submit_validation",
            "description":"Submete o resultado da validação",
            "input_schema":{
                "type":"object",
                "properties":schema["properties"],
                "required":["has_text","is_translated","is_complete","feedback"]
            }
        }],
        tool_choice={"type":"tool","name":"submit_validation"},
        messages=[{
            "role":"user","content":[
                {"type":"image","source":{"type":"base64","media_type":"image/png","data":b64}},
                {"type":"text","text":user_text}
            ]}])
    for block in r.content:
        if block.type == "tool_use":
            return block.input
    return {}

def _validador_openai(b64, traducao, key, model):
    from openai import OpenAI
    c = OpenAI(api_key=key)
    schema = Validation.model_json_schema()
    schema["additionalProperties"] = False
    schema["required"] = list(schema["properties"].keys())
    user_text = (
        f"Original: «{traducao.get('original','')}»\n"
        f"Tradução: «{traducao.get('traducao','')}»\nValide."
    )
    r = c.chat.completions.create(
        model=model, max_completion_tokens=300,
        response_format={"type":"json_schema","json_schema":{"name":"validation","schema":schema,"strict":True}},
        messages=[
            {"role":"system","content":PROMPT_VALIDADOR},
            {"role":"user","content":[
                {"type":"image_url","image_url":{"url":f"data:image/png;base64,{b64}"}},
                {"type":"text","text":user_text}
            ]}])
    return _extrair_json(r.choices[0].message.content)

def _validador_ollama(b64, traducao, model, url):
    import requests
    schema = Validation.model_json_schema()
    user_text = (
        f"Original: «{traducao.get('original','')}»\n"
        f"Tradução: «{traducao.get('traducao','')}»\nValide."
    )
    r = requests.post(f"{url}/api/generate", json={
        "model": model, "system": PROMPT_VALIDADOR, "prompt": user_text,
        "images":[b64], "format": schema, "stream":False,
        "options": {"temperature": 0.1}
    }, timeout=240)
    r.raise_for_status()
    return _extrair_json(r.json().get("response",""))

def _validador_lmstudio(b64, traducao, model, url):
    import requests
    schema = Validation.model_json_schema()
    schema["required"] = list(schema["properties"].keys())
    user_text = (
        f"Original: «{traducao.get('original','')}»\n"
        f"Tradução: «{traducao.get('traducao','')}»\nValide."
    )
    r = requests.post(f"{url}/v1/chat/completions", json={
        "model": model, "max_completion_tokens": 300, "temperature": 0.1,
        "response_format":{"type":"json_schema","json_schema":{"name":"validation","schema":schema,"strict":True}},
        "messages":[
            {"role":"system","content":PROMPT_VALIDADOR},
            {"role":"user","content":[
                {"type":"image_url","image_url":{"url":f"data:image/png;base64,{b64}"}},
                {"type":"text","text":user_text}
            ]}
        ]}, timeout=240)
    r.raise_for_status()
    return _extrair_json(r.json()["choices"][0]["message"]["content"])

# ── Roteadores públicos ────────────────────────────────────────────
def chamar_tradutor(b64: str, cfg: dict, retry_feedback: Optional[str] = None) -> dict:
    p = cfg.get("provider","claude")
    try:
        if p == "claude":
            raw = _tradutor_claude(b64, cfg["api_key"], cfg.get("model","claude-sonnet-4-6"), retry_feedback)
        elif p == "openai":
            raw = _tradutor_openai(b64, cfg["api_key"], cfg.get("model","gpt-5.4-mini"), retry_feedback)
        elif p == "ollama":
            raw = _tradutor_ollama(b64, cfg.get("model","llava"), cfg.get("base_url","http://localhost:11434"), retry_feedback)
        elif p == "lmstudio":
            raw = _tradutor_lmstudio(b64, cfg.get("model","local-model"), cfg.get("base_url","http://localhost:1234"), retry_feedback)
        else:
            raw = {}
        return Translation(**raw).model_dump()
    except (ValidationError, KeyError, TypeError) as e:
        return {"original":"","traducao":"","personagem":"?","tipo":"fala","_struct_error":str(e)}
    except Exception as e:
        return {"original":"","traducao":f"[Erro: {e}]","personagem":"?","tipo":"fala","_error":str(e)}

def chamar_validador(b64: str, traducao: dict, cfg: dict) -> dict:
    p = cfg.get("provider","claude")
    try:
        if p == "claude":
            raw = _validador_claude(b64, traducao, cfg["api_key"], cfg.get("validator_model","claude-haiku-4-5"))
        elif p == "openai":
            raw = _validador_openai(b64, traducao, cfg["api_key"], cfg.get("validator_model","gpt-5.4-nano"))
        elif p == "ollama":
            raw = _validador_ollama(b64, traducao, cfg.get("model","llava"), cfg.get("base_url","http://localhost:11434"))
        elif p == "lmstudio":
            raw = _validador_lmstudio(b64, traducao, cfg.get("model","local-model"), cfg.get("base_url","http://localhost:1234"))
        else:
            raw = {}
        return Validation(**raw).model_dump()
    except (ValidationError, KeyError, TypeError) as e:
        return {"has_text":True,"is_translated":True,"is_complete":True,"feedback":f"[Validador falhou: {e}]"}
    except Exception as e:
        return {"has_text":True,"is_translated":True,"is_complete":True,"feedback":f"[Validador erro: {e}]"}

def traduzir_com_validacao(b64: str, cfg: dict, max_retries: int = 2) -> dict:
    """Pipeline: tradutor → validador → retry com feedback se inválido."""
    feedback = None
    final, val = None, None

    for attempt in range(max_retries + 1):
        traducao = chamar_tradutor(b64, cfg, retry_feedback=feedback)

        if traducao.get("_error"):
            final = traducao
            val = {"has_text":False,"is_translated":False,"is_complete":False,"feedback":traducao["_error"]}
            break

        if not traducao.get("original","").strip() and not traducao.get("traducao","").strip():
            val = {"has_text":False,"is_translated":False,"is_complete":False,"feedback":"Nenhum texto detectado"}
            final = traducao
            break

        val = chamar_validador(b64, traducao, cfg)
        valido = val.get("has_text") and val.get("is_translated") and val.get("is_complete")

        if valido:
            final = traducao
            break

        feedback = val.get("feedback","Tradução inválida, refaça")
        final = traducao

    return {
        "translation": final,
        "validation":  val,
        "attempts":    attempt + 1,
        "valid":       bool(val and val.get("has_text") and val.get("is_translated") and val.get("is_complete")),
    }
