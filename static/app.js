// ════════════════════════════════════════════════════════
// Webtoon Translator — Frontend SPA
// ════════════════════════════════════════════════════════

const State = {
  page:        'library',     // library | reader | settings
  manga:       null,
  chapter:     null,
  pageIndex:   0,
  pageData:    null,           // resposta de /api/page/...
  balloons:    [],             // dados de tradução em memória
  totalDet:    0,
  imgNaturalW: 0,
  imgNaturalH: 0,
  settings:    null,
  view:        'trad',         // trad | orig (toggle simples)
};

// ════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════
const $  = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

function escapeHTML(s){
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    const j = await r.json().catch(()=>({}));
    throw new Error(j.error || `HTTP ${r.status}`);
  }
  return r.json();
}

// ════════════════════════════════════════════════════════
// Roteamento de páginas
// ════════════════════════════════════════════════════════
function showPage(name){
  State.page = name;
  $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${name}`));
  $$('.nav-rail .nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.page === name));
}

$$('.nav-rail .nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const target = btn.dataset.page;
    if (!target) return;
    if (target === 'reader' && !State.pageData) {
      // só permite ir pro reader se há página carregada
      return;
    }
    showPage(target);
  });
});

// ════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════
async function loadSettings(){
  State.settings = await api('/api/settings');
  applySettingsToUI();
}

function applySettingsToUI(){
  const s = State.settings;
  if (!s) return;

  // Provider tabs
  $$('.prov-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.prov === s.provider));
  $$('.prov-section').forEach(sec =>
    sec.classList.toggle('active', sec.id === `prov-${s.provider}`));

  // Provider configs
  ['claude','openai'].forEach(p => {
    const cfg = s.providers[p];
    if ($(`${p}-key`)) $(`${p}-key`).value = '';   // sempre vazio (segurança)
    if ($(`${p}-status`))
      $(`${p}-status`).style.display = cfg.api_key_set ? 'inline-block' : 'none';
    if ($(`${p}-model`))     $(`${p}-model`).value = cfg.model || '';
    if ($(`${p}-validator`)) $(`${p}-validator`).value = cfg.validator_model || '';
  });

  ['ollama','lmstudio'].forEach(p => {
    const cfg = s.providers[p];
    if ($(`${p}-url`))   $(`${p}-url`).value = cfg.base_url || '';
    if ($(`${p}-model`)) $(`${p}-model`).value = cfg.model || '';
  });

  // YOLO
  $('yolo-path').value = s.yolo.model_path;
  $('yolo-conf').value = Math.round(s.yolo.conf * 100);
  $('yolo-cont').value = Math.round(s.yolo.contencao * 100);

  // Pipeline
  $('useValidator').checked = !!s.pipeline.use_validator;
  $('maxRetries').value     = s.pipeline.max_retries;
  $('batchSize').value      = s.pipeline.batch_size || 1;

  // UI
  $('showOverlays').checked = !!s.ui.show_overlays;
  $('cardFontSize').value   = s.ui.card_font_size || 13;
  applyCardFontSize(s.ui.card_font_size || 13);
}

function applyCardFontSize(px){
  document.documentElement.style.setProperty('--card-font-size', `${px}px`);
}

function collectSettingsFromUI(){
  const provider = $$('.prov-tab.active')[0]?.dataset.prov || 'claude';
  return {
    provider,
    providers: {
      claude: {
        api_key:         $('claude-key').value,
        model:           $('claude-model').value,
        validator_model: $('claude-validator').value,
      },
      openai: {
        api_key:         $('openai-key').value,
        model:           $('openai-model').value,
        validator_model: $('openai-validator').value,
      },
      ollama: {
        base_url:        $('ollama-url').value,
        model:           $('ollama-model').value,
      },
      lmstudio: {
        base_url:        $('lmstudio-url').value,
        model:           $('lmstudio-model').value,
      },
    },
    yolo: {
      model_path: $('yolo-path').value,
      conf:       parseFloat($('yolo-conf').value) / 100,
      contencao:  parseFloat($('yolo-cont').value) / 100,
    },
    pipeline: {
      use_validator: $('useValidator').checked,
      max_retries:   parseInt($('maxRetries').value),
      batch_size:    parseInt($('batchSize').value) || 1,
    },
    ui: {
      show_overlays:  $('showOverlays').checked,
      card_font_size: parseInt($('cardFontSize').value) || 13,
    }
  };
}

// Provider tabs
$$('.prov-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.prov-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const prov = tab.dataset.prov;
    $$('.prov-section').forEach(sec =>
      sec.classList.toggle('active', sec.id === `prov-${prov}`));
  });
});

$('btnSaveSettings').addEventListener('click', async () => {
  const updates = collectSettingsFromUI();
  try {
    State.settings = await api('/api/settings', {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(updates),
    });
    applySettingsToUI();
    const msg = $('savedMsg');
    msg.style.opacity = '1';
    setTimeout(() => { msg.style.opacity = '0'; }, 2000);
  } catch(e) {
    alert('Erro ao salvar: ' + e.message);
  }
});

// Salva preferências de UI silenciosamente quando o usuário interage
async function saveUIPref(updates){
  try {
    State.settings = await api('/api/settings', {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(updates),
    });
  } catch(e) { /* silencioso */ }
}

$('showOverlays').addEventListener('change', e => {
  saveUIPref({ ui: { show_overlays: e.target.checked }});
  if (State.balloons.length || State.totalDet > 0) renderReader();
});

$('cardFontSize').addEventListener('input', e => {
  const px = parseInt(e.target.value) || 13;
  applyCardFontSize(px);
  // Reposicionar cards após altura mudar
  requestAnimationFrame(() => {
    if (typeof repositionCards === 'function') repositionCards();
  });
});
$('cardFontSize').addEventListener('change', e => {
  const px = parseInt(e.target.value) || 13;
  saveUIPref({ ui: { card_font_size: px }});
});

// ════════════════════════════════════════════════════════
// LIBRARY (browse mangás → capítulos → páginas)
// ════════════════════════════════════════════════════════
async function loadLibrary(){
  $('libContent').innerHTML = `<div class="lib-empty"><div class="big">📂</div><p>Carregando…</p></div>`;
  try {
    const data = await api('/api/library');
    if (!data.mangas.length) {
      $('libContent').innerHTML = `
        <div class="lib-empty">
          <div class="big">📂</div>
          <p>Nenhum mangá encontrado.<br><br>
          Coloque suas pastas em:<br><code>lib/&lt;nome do mangá&gt;/&lt;capítulo&gt;/&lt;páginas&gt;</code><br><br>
          Ex: <code>lib/Solo Leveling/cap_47/01.png</code></p>
        </div>`;
      return;
    }
    renderMangaGrid(data.mangas);
    $('libTitle').textContent = 'Biblioteca';
    $('libCrumb').innerHTML = `<b>${data.mangas.length}</b> mangás`;
  } catch(e) {
    $('libContent').innerHTML = `<div class="lib-empty"><div class="big">⚠️</div><p>Erro: ${escapeHTML(e.message)}</p></div>`;
  }
}

function renderMangaGrid(mangas){
  $('libContent').innerHTML = `
    <div class="manga-grid">
      ${mangas.map(m => `
        <div class="manga-card" onclick="loadManga('${escapeHTML(m.id)}')">
          <div class="cover ${m.cover ? '' : 'empty'}">
            ${m.cover ? `<img src="${m.cover}" loading="lazy"/>` : '📕'}
          </div>
          <div class="info">
            <div class="name">${escapeHTML(m.name)}</div>
            <div class="meta">${m.chapters} caps · ${m.total_pages} págs</div>
          </div>
        </div>
      `).join('')}
    </div>`;
}

window.loadManga = async function(mangaId){
  $('libTitle').textContent = mangaId;
  $('libCrumb').innerHTML = `<a onclick="loadLibrary()">Biblioteca</a> <span class="sep">/</span> <b>${escapeHTML(mangaId)}</b>`;
  $('libContent').innerHTML = `<div class="lib-empty"><div class="big">📖</div><p>Carregando…</p></div>`;

  try {
    const data = await api(`/api/library/${encodeURIComponent(mangaId)}`);
    if (!data.chapters.length) {
      $('libContent').innerHTML = `<div class="lib-empty"><div class="big">📭</div><p>Nenhum capítulo encontrado.</p></div>`;
      return;
    }
    $('libContent').innerHTML = `
      <div class="chap-list">
        ${data.chapters.map(c => `
          <div class="chap-item" onclick="openChapter('${escapeHTML(mangaId)}','${escapeHTML(c.id)}')">
            <div class="left">
              <div class="name">${escapeHTML(c.name)}</div>
              <div class="meta">${c.pages} páginas</div>
            </div>
            <div class="right">→</div>
          </div>
        `).join('')}
      </div>`;
  } catch(e) {
    $('libContent').innerHTML = `<div class="lib-empty"><div class="big">⚠️</div><p>Erro: ${escapeHTML(e.message)}</p></div>`;
  }
};

window.openChapter = function(manga, chapter){
  loadPage(manga, chapter, 0);
};

// ════════════════════════════════════════════════════════
// READER
// ════════════════════════════════════════════════════════
async function loadPage(manga, chapter, pageIndex){
  State.manga     = manga;
  State.chapter   = chapter;
  State.pageIndex = pageIndex;
  State.balloons  = [];
  State.totalDet  = 0;
  State.imgNaturalW = State.imgNaturalH = 0;

  // Habilita nav-item do leitor
  $('navReader').disabled = false;
  $('navReader').style.opacity = '';
  $('navReader').style.cursor = 'pointer';

  showPage('reader');

  // Atualiza preferência salva
  saveUIPref({ ui: { last_manga: manga, last_chapter: chapter, last_page_index: pageIndex }});

  $('readerCrumb').innerHTML = `<a onclick="loadLibrary()">Biblioteca</a> <span class="sep">/</span> <a onclick="loadManga('${escapeHTML(manga)}')">${escapeHTML(manga)}</a> <span class="sep">/</span> <b>${escapeHTML(chapter)}</b>`;

  $('readerContent').innerHTML = `<div class="lib-empty"><div class="big">⏳</div><p>Carregando página…</p></div>`;

  try {
    const data = await api(`/api/page/${encodeURIComponent(manga)}/${encodeURIComponent(chapter)}/${pageIndex}`);
    State.pageData = data;

    // Atualiza controles
    updateNavButtons(data);
    $('readPageNum').textContent  = pageIndex + 1;
    $('readPageNum2').textContent = pageIndex + 1;
    $('readPageTotal').textContent  = data.page_count;
    $('readPageTotal2').textContent = data.page_count;
    $('readChapName').textContent = chapter;

    // Carrega tradução cacheada se existir
    if (data.translation && data.translation.balloons) {
      State.balloons = data.translation.balloons;
      State.totalDet = data.translation.total || data.translation.balloons.length;
      State.imgNaturalW = data.translation.image_w || 0;
      State.imgNaturalH = data.translation.image_h || 0;

      const isComplete = data.translation.complete;
      $('btnTranslate').style.display = isComplete ? 'none' : 'inline-block';
      $('btnTranslate').textContent   = isComplete ? 'Traduzir' : 'Continuar Tradução';
      $('btnRetranslate').style.display = isComplete ? 'inline-block' : 'none';
    } else {
      $('btnTranslate').style.display   = 'inline-block';
      $('btnTranslate').textContent     = 'Traduzir Página';
      $('btnRetranslate').style.display = 'none';
    }

    renderReader();
    $('bottomControls').style.display = 'flex';

  } catch(e) {
    $('readerContent').innerHTML = `<div class="lib-empty"><div class="big">⚠️</div><p>Erro: ${escapeHTML(e.message)}</p></div>`;
  }
}

function updateNavButtons(data){
  const hasPrev = !!data.nav.prev;
  const hasNext = !!data.nav.next;
  ['btnPrev','btnPrev2'].forEach(id => $(id).disabled = !hasPrev);
  ['btnNext','btnNext2'].forEach(id => $(id).disabled = !hasNext);
}

// Navegação ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function nav(direction){
  const data = State.pageData;
  if (!data) return;
  const t = direction === 'next' ? data.nav.next : data.nav.prev;
  if (!t) return;
  loadPage(t.manga_id, t.chapter_id, t.page_index);
}
['btnPrev','btnPrev2'].forEach(id => $(id).addEventListener('click', () => nav('prev')));
['btnNext','btnNext2'].forEach(id => $(id).addEventListener('click', () => nav('next')));

$('btnBackToLib').addEventListener('click', () => showPage('library'));

// Renderiza reader (imagem + cards) ━━━━━━━━━━━━━━━━━━
function renderReader(){
  const data = State.pageData;
  if (!data) return;

  const html = `
    <div class="reader-shell">
      <div class="img-col">
        <div class="img-stack" id="imgStack">
          <img src="${data.page.url}" alt="página" id="mainImg"/>
        </div>
      </div>
      <div class="cards-col" id="cardsCol">
        ${State.totalDet > 0
          ? Array.from({length: State.totalDet}, (_,i) => skeletonCard(i)).join('')
          : `<div class="no-translation">
               <div class="big">📝</div>
               <p>Nenhuma tradução ainda.<br>Clique em <b>Traduzir Página</b> para começar.</p>
             </div>`
        }
      </div>
    </div>`;
  $('readerContent').innerHTML = html;

  const img = $('mainImg');
  img.addEventListener('load', () => {
    State.imgNaturalH = img.naturalHeight;
    State.imgNaturalW = img.naturalWidth;
    State.balloons.forEach(b => { if (b) addOverlay(b); });
    State.balloons.forEach(b => { if (b) updateCard(b); });
    repositionCards();
  });
  if (img.complete && img.naturalHeight) {
    State.imgNaturalH = img.naturalHeight;
    State.imgNaturalW = img.naturalWidth;
    State.balloons.forEach(b => { if (b) addOverlay(b); });
    State.balloons.forEach(b => { if (b) updateCard(b); });
    requestAnimationFrame(repositionCards);
  }

  if (window._roCards) window._roCards.disconnect();
  window._roCards = new ResizeObserver(() => repositionCards());
  window._roCards.observe(img);
}

function skeletonCard(i){
  return `
    <div class="float loading" id="card-${i}" style="top:${i*120}px">
      <div class="row-top">
        <span class="num">#${i+1}</span>
        <div class="status-row"><span class="conf-badge">…</span></div>
      </div>
      <div class="p-label">Aguardando…</div>
      <div class="en"><div class="spinner"></div>Traduzindo balão ${i+1}…</div>
    </div>`;
}

const FLOAT_CLS = { fala:'tf', grito:'tg', 'narração':'tn', sfx:'ts', pensamento:'tp' };

function valBadgeHTML(b){
  if (b.validation == null) return `<span class="val-badge skip">—</span>`;
  if (b.valid && b.attempts > 1) return `<span class="val-badge warn">✓ ${b.attempts}x</span>`;
  if (b.valid)                    return `<span class="val-badge ok">✓</span>`;
  return `<span class="val-badge err">✗ ${b.attempts}x</span>`;
}

function feedbackHTML(b){
  if (!b.validation || b.valid) return '';
  const fb = b.validation.feedback;
  if (!fb) return '';
  return `<div class="feedback-msg"><strong>Validador:</strong> ${escapeHTML(fb)}</div>`;
}

function addOverlay(b){
  if (!State.settings?.ui?.show_overlays) return;
  const stack = $('imgStack');
  if (!stack || !State.imgNaturalW || !State.imgNaturalH) return;

  const existing = $(`ov-${b.index}`);
  if (existing) existing.remove();

  const tipo = b.tipo || 'fala';
  const fcls = FLOAT_CLS[tipo] || 'tf';
  const invalidCls = (b.validation && !b.valid) ? ' invalid' : '';

  const [x1, y1, x2, y2] = b.box;
  const left   = (x1 / State.imgNaturalW) * 100;
  const top    = (y1 / State.imgNaturalH) * 100;
  const width  = ((x2 - x1) / State.imgNaturalW) * 100;
  const height = ((y2 - y1) / State.imgNaturalH) * 100;

  const ov = document.createElement('div');
  ov.id = `ov-${b.index}`;
  ov.className = `ov-box ${fcls}${invalidCls}`;
  ov.style.cssText = `left:${left}%;top:${top}%;width:${width}%;height:${height}%`;
  ov.innerHTML = `<div class="ov-num">${b.index+1}</div>`;
  stack.appendChild(ov);

  ov.addEventListener('mouseenter', () => highlightPair(b.index, true));
  ov.addEventListener('mouseleave', () => highlightPair(b.index, false));
}

function highlightPair(idx, on){
  const ov   = $(`ov-${idx}`);
  const card = $(`card-${idx}`);
  if (ov)   ov.classList.toggle('highlight', on);
  if (card) card.classList.toggle('highlight', on);
}

function updateCard(b){
  let el = $(`card-${b.index}`);
  if (!el) {
    // Criar se ainda não existe
    const col = $('cardsCol');
    if (!col) return;
    el = document.createElement('div');
    el.id = `card-${b.index}`;
    col.appendChild(el);
  }

  const tipo  = b.tipo || 'fala';
  const fcls  = FLOAT_CLS[tipo] || 'tf';
  const invalidCls = (b.validation && !b.valid) ? ' invalid' : '';
  const currentTop = el.style.top;

  el.className = `float ${fcls}${invalidCls}`;
  if (currentTop) el.style.top = currentTop;

  el.innerHTML = `
    <div class="row-top">
      <span class="num">#${b.index+1}</span>
      <div class="status-row">
        <span class="conf-badge">${(b.conf*100).toFixed(0)}%</span>
        ${valBadgeHTML(b)}
      </div>
    </div>
    <div class="p-label">${escapeHTML(b.personagem || '?')}</div>
    <div class="en ${b.traducao ? '' : 'empty-text'}">${escapeHTML(b.traducao) || '— sem texto —'}</div>
    <div class="ko-mini">${escapeHTML(b.original || '')}</div>
    <span class="type-badge">${tipo}</span>
    ${feedbackHTML(b)}`;

  el.onmouseenter = () => highlightPair(b.index, true);
  el.onmouseleave = () => highlightPair(b.index, false);
}

function repositionCards(){
  const cardsCol = $('cardsCol');
  const img      = $('mainImg');
  if (!cardsCol || !img || !State.imgNaturalH) return;

  const renderedH = img.getBoundingClientRect().height;
  const imgTop    = img.offsetTop;
  const scaleY    = renderedH / State.imgNaturalH;

  const cards = [];
  for (let i = 0; i < State.totalDet; i++) {
    const c = $(`card-${i}`);
    if (c) cards.push({ idx: i, el: c });
  }
  if (!cards.length) return;

  const PAD = 8;
  let lastBottom = 0;

  cards.forEach(({ idx, el }) => {
    const b = State.balloons[idx];
    let desiredTop;
    if (b && b.box) {
      const [, y1, , y2] = b.box;
      const centerY = (y1 + y2) / 2 * scaleY + imgTop;
      const cardH   = el.offsetHeight || 100;
      desiredTop = centerY - cardH / 2;
    } else {
      desiredTop = lastBottom + PAD;
    }
    desiredTop = Math.max(desiredTop, lastBottom + PAD, imgTop);
    el.style.top = `${desiredTop}px`;
    lastBottom = desiredTop + (el.offsetHeight || 100);
  });

  const imgBottom = imgTop + renderedH;
  cardsCol.style.minHeight = `${Math.max(lastBottom, imgBottom) + 20}px`;
}

window.addEventListener('resize', () => requestAnimationFrame(repositionCards));

// ════════════════════════════════════════════════════════
// TRADUÇÃO via SSE
// ════════════════════════════════════════════════════════
function setStatus(cls, msg, pct){
  const bar = $('runStatus');
  bar.className = `run-status show ${cls || ''}`;
  $('runMsg').textContent = msg;
  $('runPct').textContent = pct != null ? `${Math.round(pct)}%` : '';
}

function hideStatus(){ $('runStatus').className = 'run-status'; }

async function startTranslate(retranslate = false){
  if (!State.manga || !State.chapter) return;

  if (retranslate) {
    // Limpa cache antes
    try {
      await api(`/api/translation/${encodeURIComponent(State.manga)}/${encodeURIComponent(State.chapter)}/${encodeURIComponent(State.pageData.page.id)}`, { method: 'DELETE' });
    } catch(e) {}
  }

  State.balloons = [];
  State.totalDet = 0;
  $('btnTranslate').disabled   = true;
  $('btnRetranslate').disabled = true;
  setStatus('', 'Enviando…', 0);

  try {
    const url = `/api/translate/${encodeURIComponent(State.manga)}/${encodeURIComponent(State.chapter)}/${State.pageIndex}`;
    const resp = await fetch(url, { method: 'POST' });
    if (!resp.ok) {
      const j = await resp.json().catch(()=>({}));
      throw new Error(j.error || `HTTP ${resp.status}`);
    }
    await readSSE(resp);
  } catch(e) {
    setStatus('err', e.message);
  } finally {
    $('btnTranslate').disabled   = false;
    $('btnRetranslate').disabled = false;
  }
}

$('btnTranslate').addEventListener('click', () => startTranslate(false));
$('btnRetranslate').addEventListener('click', () => {
  if (confirm('Refazer toda a tradução desta página?')) startTranslate(true);
});

async function readSSE(response){
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      processBlock(block);
    }
  }
}

function processBlock(block){
  let event = 'message';
  let dataStr = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
  }
  if (!dataStr) return;
  try {
    const data = JSON.parse(dataStr);
    handleSSE(event, data);
  } catch(e) {}
}

function handleSSE(evt, data){
  if (evt === 'ping') return;

  if (evt === 'error') {
    const msg = data.yolo_missing
      ? 'Modelo YOLO não encontrado. Configure o caminho em Configurações.'
      : `Erro: ${data.msg}`;
    setStatus('err', msg);
    return;
  }

  if (evt === 'status') {
    let pct = 10;
    if (data.step === 'translate') pct = 15 + (data.i / Math.max(data.total,1)) * 80;
    setStatus('', data.msg, pct);
    return;
  }

  if (evt === 'detected') {
    State.totalDet    = data.total;
    State.imgNaturalW = data.image_w;
    State.imgNaturalH = data.image_h;

    if (data.total === 0) {
      setStatus('err', 'Nenhum balão detectado nesta página.');
      $('cardsCol').innerHTML = `<div class="no-translation"><div class="big">🔍</div><p>Nenhum balão detectado.</p></div>`;
      return;
    }
    setStatus('', `${data.total} balões detectados, traduzindo…`, 15);

    // Limpar e criar skeletons
    const col = $('cardsCol');
    col.innerHTML = Array.from({length: data.total}, (_,i) => skeletonCard(i)).join('');

    requestAnimationFrame(repositionCards);
    return;
  }

  if (evt === 'balloon') {
    State.balloons[data.index] = data;
    addOverlay(data);
    updateCard(data);

    const filled = State.balloons.filter(Boolean).length;
    const pct = 15 + (filled / Math.max(State.totalDet,1)) * 82;
    setStatus('', `${filled}/${State.totalDet} balões traduzidos…`, pct);

    requestAnimationFrame(() => repositionCards());
    return;
  }

  if (evt === 'done') {
    setStatus('ok', `✓ ${data.total} balões processados`, 100);
    $('btnTranslate').style.display   = 'none';
    $('btnRetranslate').style.display = 'inline-block';
    requestAnimationFrame(repositionCards);
    setTimeout(() => hideStatus(), 3000);
  }
}

// ════════════════════════════════════════════════════════
// Boot
// ════════════════════════════════════════════════════════
(async function boot(){
  await loadSettings();
  await loadLibrary();

  // Restaurar última página se existir
  const ui = State.settings?.ui;
  if (ui?.last_manga && ui?.last_chapter != null) {
    try {
      const data = await api(`/api/page/${encodeURIComponent(ui.last_manga)}/${encodeURIComponent(ui.last_chapter)}/${ui.last_page_index || 0}`);
      if (data && !data.error) {
        // Habilita o botão do reader (mas não navega automaticamente)
        $('navReader').disabled = false;
        $('navReader').style.opacity = '';
        $('navReader').style.cursor = 'pointer';
        $('navReader').addEventListener('click', () => {
          if (!State.pageData) loadPage(ui.last_manga, ui.last_chapter, ui.last_page_index || 0);
        }, { once: true });
      }
    } catch(e) {}
  }
})();

// ════════════════════════════════════════════════════════
// MODO EDIÇÃO de caixas
// ════════════════════════════════════════════════════════
const Edit = {
  active:        false,
  selectedIndex: null,    // index da caixa selecionada (existente ou pendente)
  pendingBox:    null,    // {x1,y1,x2,y2} em coords originais da imagem (caixa nova ainda não traduzida)
  drag:          null,    // {mode:'create'|'move'|'resize', startX, startY, origBox, handle}
};

function setEditMode(on){
  Edit.active = on;
  Edit.selectedIndex = null;
  Edit.pendingBox    = null;
  Edit.drag          = null;
  $('editToolbar').classList.toggle('show', on);
  $('btnEdit').classList.toggle('on', on);
  const stack = $('imgStack');
  if (stack) stack.classList.toggle('editing', on);
  refreshEditButtons();
  // Re-render para limpar caixa pendente se houver
  removePendingOverlay();
  // Marcar selecionada visualmente
  document.querySelectorAll('.ov-box').forEach(el => el.classList.remove('selected'));
}

function refreshEditButtons(){
  const has = Edit.selectedIndex !== null || Edit.pendingBox !== null;
  $('btnTranslateBox').disabled = !has;
  $('btnDeleteBox').disabled    = Edit.selectedIndex === null;  // só caixas existentes podem ser deletadas
  // Botão muda label se for nova
  if (Edit.pendingBox) {
    $('btnTranslateBox').textContent = 'Traduzir Caixa';
  } else if (Edit.selectedIndex !== null) {
    $('btnTranslateBox').textContent = 'Refazer Tradução';
  } else {
    $('btnTranslateBox').textContent = 'Traduzir Caixa';
  }
}

// Converte evento de mouse para coords da imagem original
function eventToImgCoords(ev){
  const img = $('mainImg');
  if (!img || !State.imgNaturalW || !State.imgNaturalH) return null;
  const rect = img.getBoundingClientRect();
  const px   = (ev.clientX - rect.left) / rect.width;
  const py   = (ev.clientY - rect.top)  / rect.height;
  return {
    x: Math.max(0, Math.min(1, px)) * State.imgNaturalW,
    y: Math.max(0, Math.min(1, py)) * State.imgNaturalH,
  };
}

// Adiciona handles de redimensionamento numa caixa selecionada
function ensureHandles(el){
  if (el.querySelector('.ov-handle')) return;
  ['nw','n','ne','e','se','s','sw','w'].forEach(pos => {
    const h = document.createElement('div');
    h.className = `ov-handle ${pos}`;
    h.dataset.handle = pos;
    el.appendChild(h);
  });
}

function selectBox(index){
  Edit.selectedIndex = index;
  Edit.pendingBox    = null;
  document.querySelectorAll('.ov-box').forEach(el => el.classList.remove('selected'));
  const el = $(`ov-${index}`);
  if (el) {
    el.classList.add('selected');
    ensureHandles(el);
  }
  refreshEditButtons();
}

function removePendingOverlay(){
  const p = $('ov-pending');
  if (p) p.remove();
  const cardP = $('card-pending');
  if (cardP) cardP.remove();
}

function showPendingOverlay(box){
  const stack = $('imgStack');
  if (!stack) return;
  removePendingOverlay();

  const [x1, y1, x2, y2] = box;
  const left   = (x1 / State.imgNaturalW) * 100;
  const top    = (y1 / State.imgNaturalH) * 100;
  const width  = ((x2 - x1) / State.imgNaturalW) * 100;
  const height = ((y2 - y1) / State.imgNaturalH) * 100;

  const ov = document.createElement('div');
  ov.id = 'ov-pending';
  ov.className = 'ov-box pending selected';
  ov.style.cssText = `left:${left}%;top:${top}%;width:${width}%;height:${height}%`;
  ov.innerHTML = `<div class="ov-num">nova</div>`;
  ensureHandles(ov);
  stack.appendChild(ov);

  // Card placeholder
  const col = $('cardsCol');
  if (col && !$('card-pending')) {
    const card = document.createElement('div');
    card.id = 'card-pending';
    card.className = 'float pending';
    card.innerHTML = `
      <div class="row-top">
        <span class="num">nova</span>
        <div class="status-row"><span class="conf-badge">manual</span></div>
      </div>
      <div class="p-label">Caixa pendente</div>
      <div class="en">Clique em <b>Traduzir Caixa</b> para processar</div>`;
    col.appendChild(card);
  }
}

// ── Mouse handlers no img-stack ────────────────────────────
function onStackMouseDown(ev){
  if (!Edit.active) return;
  if (ev.button !== 0) return;

  const target = ev.target;

  // Clicou num handle?
  if (target.classList.contains('ov-handle')) {
    const ov = target.closest('.ov-box');
    if (!ov) return;
    const index = ov.id === 'ov-pending' ? 'pending' : parseInt(ov.id.replace('ov-',''));
    const box = boxFromOverlay(index);
    if (!box) return;
    Edit.drag = {
      mode: 'resize', handle: target.dataset.handle,
      startCoord: eventToImgCoords(ev), origBox: box,
      index,
    };
    ev.preventDefault(); ev.stopPropagation();
    return;
  }

  // Clicou numa caixa existente?
  const ovBox = target.closest('.ov-box');
  if (ovBox) {
    if (ovBox.id === 'ov-pending') {
      // Selecionar pendente
      const box = Edit.pendingBox;
      Edit.drag = {
        mode: 'move', startCoord: eventToImgCoords(ev),
        origBox: [...box], index: 'pending',
      };
    } else {
      const index = parseInt(ovBox.id.replace('ov-',''));
      selectBox(index);
      const box = boxFromOverlay(index);
      Edit.drag = {
        mode: 'move', startCoord: eventToImgCoords(ev),
        origBox: box, index,
      };
    }
    ev.preventDefault(); ev.stopPropagation();
    return;
  }

  // Clicou no fundo → criar nova caixa
  const start = eventToImgCoords(ev);
  if (!start) return;
  Edit.drag = {
    mode: 'create', startCoord: start,
    origBox: [start.x, start.y, start.x, start.y],
    index: 'pending',
  };
  Edit.pendingBox = [start.x, start.y, start.x + 1, start.y + 1];
  Edit.selectedIndex = null;
  document.querySelectorAll('.ov-box').forEach(el => el.classList.remove('selected'));
  showPendingOverlay(Edit.pendingBox);
  refreshEditButtons();
  ev.preventDefault();
}

function boxFromOverlay(index){
  if (index === 'pending') return Edit.pendingBox ? [...Edit.pendingBox] : null;
  const b = State.balloons[index];
  return b ? [...b.box] : null;
}

function onStackMouseMove(ev){
  if (!Edit.active || !Edit.drag) return;
  const cur = eventToImgCoords(ev);
  if (!cur) return;

  const { mode, startCoord, origBox, handle, index } = Edit.drag;
  let [x1, y1, x2, y2] = origBox;

  if (mode === 'create') {
    x1 = Math.min(startCoord.x, cur.x);
    y1 = Math.min(startCoord.y, cur.y);
    x2 = Math.max(startCoord.x, cur.x);
    y2 = Math.max(startCoord.y, cur.y);
  } else if (mode === 'move') {
    const dx = cur.x - startCoord.x;
    const dy = cur.y - startCoord.y;
    const w = x2 - x1, h = y2 - y1;
    x1 += dx; y1 += dy;
    x2 = x1 + w; y2 = y1 + h;
    // Clamp
    if (x1 < 0) { x2 -= x1; x1 = 0; }
    if (y1 < 0) { y2 -= y1; y1 = 0; }
    if (x2 > State.imgNaturalW) { x1 -= (x2 - State.imgNaturalW); x2 = State.imgNaturalW; }
    if (y2 > State.imgNaturalH) { y1 -= (y2 - State.imgNaturalH); y2 = State.imgNaturalH; }
  } else if (mode === 'resize') {
    const dx = cur.x - startCoord.x;
    const dy = cur.y - startCoord.y;
    if (handle.includes('n')) y1 = origBox[1] + dy;
    if (handle.includes('s')) y2 = origBox[3] + dy;
    if (handle.includes('w')) x1 = origBox[0] + dx;
    if (handle.includes('e')) x2 = origBox[2] + dx;
    // Garante min size e ordem
    if (x2 - x1 < 10) {
      if (handle.includes('w')) x1 = x2 - 10; else x2 = x1 + 10;
    }
    if (y2 - y1 < 10) {
      if (handle.includes('n')) y1 = y2 - 10; else y2 = y1 + 10;
    }
    x1 = Math.max(0, x1); y1 = Math.max(0, y1);
    x2 = Math.min(State.imgNaturalW, x2); y2 = Math.min(State.imgNaturalH, y2);
  }

  const newBox = [x1, y1, x2, y2];

  if (index === 'pending') {
    Edit.pendingBox = newBox;
    showPendingOverlay(newBox);
  } else {
    // Atualiza visualmente o overlay e o State.balloons
    State.balloons[index].box = newBox;
    const ov = $(`ov-${index}`);
    if (ov) {
      const left   = (x1 / State.imgNaturalW) * 100;
      const top    = (y1 / State.imgNaturalH) * 100;
      const width  = ((x2 - x1) / State.imgNaturalW) * 100;
      const height = ((y2 - y1) / State.imgNaturalH) * 100;
      ov.style.cssText = `left:${left}%;top:${top}%;width:${width}%;height:${height}%`;
      // Garante que mantém a classe selected/handles
      if (!ov.classList.contains('selected')) ov.classList.add('selected');
      ensureHandles(ov);
      // Reposicionar cards (a altura mudou de posição)
      requestAnimationFrame(repositionCards);
    }
  }

  ev.preventDefault();
}

function onStackMouseUp(ev){
  if (!Edit.active || !Edit.drag) return;
  const { mode, index } = Edit.drag;

  if (mode === 'create') {
    // Validar tamanho mínimo
    if (Edit.pendingBox) {
      const [x1, y1, x2, y2] = Edit.pendingBox;
      if (x2 - x1 < 10 || y2 - y1 < 10) {
        Edit.pendingBox = null;
        removePendingOverlay();
      }
    }
  }

  Edit.drag = null;
  refreshEditButtons();
}

// ── Botões de edição ──────────────────────────────────
$('btnEdit').addEventListener('click', () => setEditMode(!Edit.active));
$('btnExitEdit').addEventListener('click', () => setEditMode(false));

$('btnTranslateBox').addEventListener('click', async () => {
  if (!State.pageData) return;
  const isPending = Edit.pendingBox !== null;
  const box   = isPending ? Edit.pendingBox : (State.balloons[Edit.selectedIndex]?.box);
  const index = isPending ? -1 : Edit.selectedIndex;
  if (!box) return;

  $('btnTranslateBox').disabled = true;
  $('btnDeleteBox').disabled    = true;
  setStatus('', 'Traduzindo caixa…', 30);

  try {
    const url = `/api/translate-box/${encodeURIComponent(State.manga)}/${encodeURIComponent(State.chapter)}/${encodeURIComponent(State.pageData.page.id)}`;
    const res = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ index, box: box.map(Math.round) }),
    });
    if (!res.ok) {
      const j = await res.json().catch(()=>({}));
      throw new Error(j.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const balloon  = data.balloon;
    const balloons = data.balloons || [];

    // Resincroniza estado local com a ordem retornada (pode ter reindexado)
    State.balloons = [];
    balloons.forEach(b => { State.balloons[b.index] = b; });
    State.totalDet = balloons.length;

    // Re-render completo de overlays e cards (índices podem ter mudado)
    document.querySelectorAll('.ov-box').forEach(el => el.remove());
    const col = $('cardsCol');
    if (col) col.innerHTML = '';
    State.balloons.forEach(b => { if (b) { addOverlay(b); updateCard(b); }});

    // Selecionar o balão recém-criado/atualizado pelo seu novo index
    removePendingOverlay();
    Edit.pendingBox = null;
    selectBox(balloon.index);
    requestAnimationFrame(repositionCards);

    setStatus('ok', '✓ Caixa traduzida', 100);
    setTimeout(hideStatus, 2000);
  } catch(e) {
    setStatus('err', `Erro: ${e.message}`);
  } finally {
    refreshEditButtons();
  }
});

$('btnDeleteBox').addEventListener('click', async () => {
  if (Edit.selectedIndex === null || !State.pageData) return;
  const idx = Edit.selectedIndex;
  if (!confirm(`Excluir a caixa #${idx+1}?`)) return;

  $('btnDeleteBox').disabled    = true;
  $('btnTranslateBox').disabled = true;

  try {
    const url = `/api/balloon/${encodeURIComponent(State.manga)}/${encodeURIComponent(State.chapter)}/${encodeURIComponent(State.pageData.page.id)}/${idx}`;
    const res = await fetch(url, { method:'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Remove localmente; reindexa
    State.balloons.splice(idx, 1);
    State.balloons.forEach((b, i) => { if (b) b.index = i; });
    State.totalDet = State.balloons.filter(Boolean).length;
    Edit.selectedIndex = null;

    // Re-render completo das caixas e cards
    document.querySelectorAll('.ov-box').forEach(el => el.remove());
    const col = $('cardsCol');
    if (col) col.innerHTML = '';
    State.balloons.forEach(b => { if (b) { addOverlay(b); updateCard(b); }});
    requestAnimationFrame(repositionCards);
    refreshEditButtons();

    setStatus('ok', '✓ Caixa excluída', 100);
    setTimeout(hideStatus, 2000);
  } catch(e) {
    setStatus('err', `Erro: ${e.message}`);
  }
});

// Bind dos handlers de mouse no img-stack (delegação a partir do reader)
document.addEventListener('mousedown', e => {
  const stack = e.target.closest('#imgStack');
  if (stack) onStackMouseDown(e);
});
document.addEventListener('mousemove', onStackMouseMove);
document.addEventListener('mouseup',   onStackMouseUp);

// Sair do modo edição ao trocar de página
const _origLoadPage = loadPage;
window.loadPage = async function(...args){
  if (Edit.active) setEditMode(false);
  return _origLoadPage(...args);
};

// Atalhos de teclado
document.addEventListener('keydown', e => {
  if (State.page !== 'reader') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (Edit.active) {
    if (e.key === 'Escape') { setEditMode(false); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (Edit.selectedIndex !== null) { e.preventDefault(); $('btnDeleteBox').click(); }
      else if (Edit.pendingBox) {
        Edit.pendingBox = null;
        removePendingOverlay();
        refreshEditButtons();
      }
      return;
    }
    return;  // não navega entre páginas em modo edição
  }

  if (e.key === 'ArrowLeft')  nav('prev');
  if (e.key === 'ArrowRight') nav('next');
  if (e.key === ' ' || e.key === 'Enter') {
    if (!$('btnTranslate').disabled && $('btnTranslate').style.display !== 'none') {
      e.preventDefault();
      $('btnTranslate').click();
    }
  }
});
