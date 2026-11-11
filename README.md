# Webtoon Translator

App Flask completo para tradução de manhwa/webtoon coreano com:

- 📚 Biblioteca de mangás organizada em pastas
- 🤖 Pipeline multi-agente (Tradutor + Validador) com schema Pydantic
- 🔄 Multi-provider: Claude, ChatGPT, Ollama, LM Studio
- 💾 Cache automático de traduções por página
- 🎯 YOLO para detecção de balões
- 🧭 Navegação entre páginas/capítulos
- ⚙️ Configurações persistentes

## Estrutura de pastas

```
webtoon-translator/
├── app.py
├── requirements.txt
├── backend/
│   ├── __init__.py
│   ├── library.py       ← gerencia lib/ e cache de traduções
│   ├── settings.py      ← carrega/salva config/settings.json
│   ├── detector.py      ← YOLO + filtro de contenção
│   └── translators.py   ← agentes Tradutor + Validador
├── templates/
│   └── index.html
├── static/
│   ├── app.css
│   └── app.js
├── config/
│   └── settings.json    ← criado automaticamente
├── lib/                 ← SUA BIBLIOTECA
│   └── <Nome do Mangá>/
│       └── <capítulo>/
│           ├── 01.png
│           ├── 02.png
│           ├── .01.translation.json   ← cache (oculto)
│           └── .02.translation.json
└── runs/balloon_v1/weights/best.pt   ← seu modelo YOLO
```

## Instalação

```bash
# 1. Dependências
pip install -r requirements.txt

# 2. Modelo YOLO
mkdir -p runs/balloon_v1/weights/
cp /caminho/best.pt runs/balloon_v1/weights/best.pt

# 3. Biblioteca de mangás
mkdir -p "lib/Solo Leveling/cap_47"
# coloque as páginas (.png/.jpg) na pasta do capítulo

# 4. Rodar
python app.py
# → http://localhost:5000
```

## Como funciona

### Biblioteca
- A página inicial lista todos os mangás em `lib/`
- Capítulos e páginas detectados automaticamente
- Capa = primeira página do primeiro capítulo

### Leitor
- Imagem grande à esquerda, cards de tradução à direita
- Cards alinhados verticalmente com cada balão da imagem
- Hover sincroniza imagem ↔ card
- Atalhos de teclado: `←` `→` para navegar páginas, `Espaço` para traduzir
- No fim do capítulo, "Próxima" passa pro primeiro do próximo capítulo

### Cache de traduções
- Cada página gera `.<page_id>.translation.json` no diretório do capítulo
- Salvo incrementalmente durante a tradução (se interromper, dá pra continuar)
- Botão "Continuar Tradução" aparece se não estiver completo
- Botão "Refazer" deleta o cache e refaz tudo

### Configurações persistentes
- Tudo salvo em `config/settings.json`
- API keys nunca são devolvidas pro frontend (mascaradas como `[salva]`)
- Inclui última página visitada para retomada

## Pipeline de tradução

```
YOLO detecta balões  →  recorta com Pillow  →  TRADUTOR (Pydantic schema)
                                                       ↓
                                                  VALIDADOR
                                                       ↓
                                            valid? sim → próximo balão
                                                       ↓
                                            valid? não → retry com feedback
                                                       (até max_retries)
```

### Schema (`backend/translators.py`)

```python
class Translation(BaseModel):
    original:   str
    traducao:   str
    personagem: str
    tipo:       Literal["fala","grito","narração","sfx","pensamento"]

class Validation(BaseModel):
    has_text:      bool
    is_translated: bool
    is_complete:   bool
    feedback:      str
```

### Indicadores na UI

- **✓ verde**         — validado na 1ª tentativa
- **✓ N× âmbar**      — validado após N tentativas
- **✗ N× vermelho**   — esgotou retries (mostra feedback inline)
- **— cinza**         — validador desativado

## API endpoints

```
GET  /                                 ← SPA
GET  /api/library                      ← lista mangás
GET  /api/library/<manga>              ← capítulos
GET  /api/library/<manga>/<cap>        ← páginas + status do cache
GET  /api/page/<manga>/<cap>/<idx>     ← dados da página + tradução cacheada
POST /api/translate/<manga>/<cap>/<idx> ← SSE: traduz a página

GET  /api/settings                     ← carregar config (api_keys mascaradas)
PUT  /api/settings                     ← atualizar (merge profundo)

DELETE /api/translation/<manga>/<cap>/<page_id>  ← limpar cache

GET  /lib/<manga>/<cap>/<page>         ← serve imagens
```
