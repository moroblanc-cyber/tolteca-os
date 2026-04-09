/* =====================================================
   TOLTECA OS — app.js
   Secciones:
   STATE & STORAGE · TREE / NAVIGATION · GRID / CARDS ·
   VIEWER · EDITOR · DIALOGS · SEARCH / FILTERS ·
   STATS · DRAG & DROP · IMAGES · IMPORT / EXPORT ·
   KEYBOARD SHORTCUTS
   ===================================================== */

// === STATE & STORAGE ==================================

const DB_DEFAULT = {
  infancia:    { root: [], expanded: true,  iconData: null, bgImageData: null },
  adolescencia:{ root: [], expanded: true,  iconData: null, bgImageData: null },
  adultez:     { root: [], expanded: true,  iconData: null, bgImageData: null }
};

const STAGE_CONFIG = {
  infancia:    {
    label: 'INFANCIA', iconClass: 'si-infancia',
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5c-3.5 0-6.5-2.5-6.5-6.5 0-2.5 1.5-4.5 4-5.5 1.5-.5 3-.5 4.5.5 1.5 1 2.5 3 2.5 5 0 3-3 6-6.5 6.5"/></svg>`
  },
  adolescencia:{
    label: 'ADOLESCENCIA', iconClass: 'si-adolescencia',
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`
  },
  adultez:     {
    label: 'EDAD ADULTA', iconClass: 'si-adultez',
    svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6-7 6 7-6 13-6-13z"/><path d="M6 9h12"/></svg>`
  }
};

const STAGE_THEMES = {
  infancia:    'var(--atmos-infancia)',
  adolescencia:'var(--atmos-adolescencia)',
  adultez:     'var(--atmos-adultez)'
};

const EMO_MAP = {
  neutro:      { icon: 'fas fa-compass',            color: '#8b95a6' },
  sufrimiento: { icon: 'fas fa-heart-broken',        color: '#ff4757' },
  miedo:       { icon: 'fas fa-ghost',               color: '#ff7043' },
  ira:         { icon: 'fas fa-fire',                color: '#e84118' },
  culpa:       { icon: 'fas fa-link',                color: '#fd9644' },
  gozo:        { icon: 'fas fa-star',                color: '#2ed573' },
  poder:       { icon: 'fas fa-bolt',                color: '#ffa502' },
  amor:        { icon: 'fas fa-hand-holding-heart',  color: '#ff6b81' }
};

let DB = null;
let currentEditRef   = null;
let selectedFolderId = null;
let selectedStageKey = null;
let selectedFolderPath = [];   // [{id, name, stageKey}]
let draggedItem      = null;
let currentIconTargetKey  = null;
let currentBgTargetKey    = null;
let tempEventImage   = null;
let undoStack        = [];     // { type, data, stageKey, parentId }
let saveDebounceTimer = null;
let saveFailedFlag   = false;

// Filtros activos (no persistentes)
let activeFilters = {
  search: '',
  emotions: new Set(),
  minIntensity: 0,
  status: 'all',   // 'all' | 'done' | 'pending'
  sort: 'manual'   // 'manual' | 'title' | 'intensity' | 'emotion'
};

document.addEventListener('DOMContentLoaded', init);

function init() {
  try {
    const raw = localStorage.getItem('tolteca_db_v10');
    if (raw) {
      DB = JSON.parse(raw);
      ['infancia','adolescencia','adultez'].forEach(k => {
        if (DB[k]) {
          if (DB[k].iconData   === undefined) DB[k].iconData   = null;
          if (DB[k].bgImageData=== undefined) DB[k].bgImageData= null;
        }
      });
    } else {
      const old = localStorage.getItem('tolteca_db_v1');
      if (old) migrateV1toV10(JSON.parse(old));
    }
  } catch(e) { console.error('Error cargando DB:', e); }

  if (!DB) DB = JSON.parse(JSON.stringify(DB_DEFAULT));

  const bgSaved = localStorage.getItem('tolteca_bg_data');
  if (bgSaved) document.body.style.backgroundImage = `url('${bgSaved}')`;

  setupFileInputs();
  setupKeyboardShortcuts();
  renderTree();
  renderBreadcrumb();
  updateStatsPanel();
}

function autoSave() {
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    try {
      localStorage.setItem('tolteca_db_v10', JSON.stringify(DB));
      saveFailedFlag = false;
    } catch(e) {
      saveFailedFlag = true;
      if (e.name === 'QuotaExceededError') {
        Dialog.confirm({
          title: 'Almacenamiento lleno',
          message: 'El almacenamiento local está casi lleno. Se recomienda exportar una copia de seguridad. ¿Exportar ahora?',
          variant: 'default',
          confirmLabel: 'Exportar',
          cancelLabel: 'Cancelar'
        }).then(ok => { if (ok) downloadBackup(); });
      }
    }
  }, 300);
}

function migrateInventarioFile(j) {
  // Detectar etapa desde archivo_origen o primera categoría
  const origen    = (j.archivo_origen || '').toLowerCase();
  const firstCat  = ((j.inventario?.[0]?.eventos?.[0]?.categoria) || '').toLowerCase();
  let sk = 'infancia';
  if (origen.includes('adolescen') || firstCat.includes('adolescen')) sk = 'adolescencia';
  else if (origen.includes('adult')    || firstCat.includes('adult'))    sk = 'adultez';

  let eventosTotal = 0;
  j.inventario.forEach(grupo => {
    const folder = {
      id:       Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
      name:     grupo.persona_o_contexto || 'Sin nombre',
      children: [],
      events:   [],
      expanded: false
    };
    (grupo.eventos || []).forEach(ev => {
      folder.events.push({
        titulo:               ev.titulo               || 'Sin título',
        descripcion_original: ev.descripcion_original || '',
        tipo_emocion:         'neutro',
        carga_emocional:      Number(ev.carga_emocional) || 5,
        completado:           false,
        observaciones:        ''
      });
      eventosTotal++;
    });
    DB[sk].root.push(folder);
  });

  DB[sk].expanded = true;
  autoSave();
  selectedStageKey   = sk;
  selectedFolderId   = null;
  selectedFolderPath = [{ label: STAGE_CONFIG[sk].label, key: sk, type: 'stage' }];
  setStageBackground(sk);
  renderTree();
  renderBreadcrumb(selectedFolderPath);
  document.getElementById('filterBar').classList.add('hidden');
  document.getElementById('contentArea').innerHTML = `
    <div class="empty-state" style="margin-top:12vh">
      <div class="empty-state-icon"><i class="fas fa-check-circle" style="color:var(--success)"></i></div>
      <h2 class="empty-state-title" style="font-size:1.8rem">Inventario importado</h2>
      <p class="empty-state-sub">${j.inventario.length} carpetas · ${eventosTotal} eventos → ${STAGE_CONFIG[sk].label}</p>
    </div>`;
  Dialog.toast({ message: `Inventario importado: ${j.inventario.length} carpetas, ${eventosTotal} eventos`, type: 'success' });
}

function migrateV1toV10(oldDB) {
  DB = JSON.parse(JSON.stringify(DB_DEFAULT));
  ['infancia','adolescencia','adultez'].forEach(k => {
    if (oldDB[k] && oldDB[k].data && oldDB[k].data.inventario) {
      oldDB[k].data.inventario.forEach(g => {
        DB[k].root.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2,9),
          name: g.persona_o_contexto,
          events: g.eventos || [],
          children: [],
          expanded: false
        });
      });
    }
  });
  autoSave();
}


// === TREE / NAVIGATION ================================

function setStageBackground(sk) {
  const main = document.getElementById('main');
  const bg   = document.getElementById('contentBackground');
  const theme = STAGE_THEMES[sk] || 'var(--atmos-default)';
  main.style.background = theme;
  if (DB[sk] && DB[sk].bgImageData) {
    bg.style.backgroundImage = `url('${DB[sk].bgImageData}')`;
    bg.classList.add('active');
  } else {
    bg.style.backgroundImage = 'none';
    bg.classList.remove('active');
  }
}

function renderTree() {
  const root = document.getElementById('treeRoot');
  if (!root) return;
  root.innerHTML = '';

  ['infancia','adolescencia','adultez'].forEach(key => {
    const et   = DB[key];
    const conf = STAGE_CONFIG[key];
    const node = document.createElement('div');
    node.className = 'stage-node';

    const stats = computeStageStats(key);

    // Icon
    let iconHTML = conf.svg, styleAttr = '';
    if (et.iconData) { styleAttr = `background-image:url('${et.iconData}');`; iconHTML = ''; }

    const progressPct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

    const header = document.createElement('div');
    header.className = 'stage-header';
    header.innerHTML = `
      <div class="stage-header-left">
        <div class="stage-icon ${et.iconData ? '' : conf.iconClass}" style="${styleAttr}">${iconHTML}</div>
        <div>
          <div class="stage-label">${conf.label}</div>
          <div class="stage-info">${stats.done}/${stats.total} recapitulados</div>
          <div class="stage-progress-bar"><div class="stage-progress-fill" style="width:${progressPct}%"></div></div>
        </div>
      </div>
      <div class="stage-actions">
        <button class="stage-btn" title="Cambiar icono" data-action="icon" data-key="${key}"><i class="fas fa-circle-user"></i></button>
        <button class="stage-btn" title="Cambiar fondo" data-action="bg" data-key="${key}"><i class="fas fa-panorama"></i></button>
        <button class="stage-btn" title="Nueva carpeta" data-action="newFolder" data-key="${key}"><i class="fas fa-plus"></i></button>
      </div>`;

    header.querySelector('.stage-header-left').addEventListener('click', () => {
      et.expanded = !et.expanded;
      if (et.expanded) {
        setStageBackground(key);
        selectedStageKey  = key;
        selectedFolderId  = null;
        selectedFolderPath= [];
        resetFilters();
        renderBreadcrumb([{ label: conf.label, key }]);
        renderStageEmptyState(key);
      }
      autoSave();
      renderTree();
    });

    header.querySelectorAll('.stage-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const k = btn.dataset.key;
        if (btn.dataset.action === 'icon')      triggerIconUpload(k);
        else if (btn.dataset.action === 'bg')   triggerStageBgUpload(k);
        else if (btn.dataset.action === 'newFolder') createFolder(k, null);
      });
    });

    const cont = document.createElement('div');
    cont.className = 'folder-container' + (et.expanded ? ' expanded' : '');

    if (et.root) et.root.forEach((f, i) => cont.appendChild(renderFolderNode(f, key, et.root, i, 0)));

    node.appendChild(header);
    node.appendChild(cont);
    root.appendChild(node);
  });
}

function renderFolderNode(folder, sk, par, idx, lvl) {
  const wrap = document.createElement('div');
  const el   = document.createElement('div');
  el.className = 'folder-node' + (selectedFolderId === folder.id ? ' active' : '');

  el.setAttribute('draggable', 'true');
  el.addEventListener('dragstart', e => handleDragStart(e, folder, sk, 'folder'));
  el.addEventListener('dragover',  e => { e.preventDefault(); e.stopPropagation(); el.classList.add('drag-over'); });
  el.addEventListener('dragleave', e => { e.stopPropagation(); el.classList.remove('drag-over'); });
  el.addEventListener('drop',      e => handleDrop(e, folder, sk));
  el.addEventListener('click',     e => handleFolderClick(e, folder, sk));

  const hasCh = folder.children && folder.children.length > 0;
  const stats = computeFolderStats(folder);
  const isDone = stats.total > 0 && stats.done === stats.total;

  el.innerHTML = `
    ${hasCh
      ? `<i class="fas fa-chevron-right folder-chevron ${folder.expanded !== false ? 'open' : ''}"></i>`
      : `<span style="width:12px;display:inline-block"></span>`}
    <i class="fas ${hasCh ? 'fa-folder-open' : 'fa-folder'} folder-icon ${lvl === 0 ? 'level-0' : 'level-n'}"></i>
    <span class="folder-name" style="font-weight:${lvl===0?'600':'400'}">${folder.name}</span>
    <span class="folder-badge ${isDone&&stats.total>0?'done':''}">${stats.done}/${stats.total}</span>
    <div class="folder-actions">
      <span class="act-btn act-move" title="Subir"   data-action="up"  ><i class="fas fa-arrow-up"></i></span>
      <span class="act-btn act-move" title="Bajar"   data-action="down"><i class="fas fa-arrow-down"></i></span>
      <span class="act-btn act-add"  title="Subcarpeta" data-action="add"><i class="fas fa-plus"></i></span>
      <span class="act-btn act-edit" title="Renombrar"  data-action="ren"><i class="fas fa-pen"></i></span>
      <span class="act-btn act-del"  title="Borrar"     data-action="del"><i class="fas fa-trash"></i></span>
    </div>`;

  el.querySelectorAll('.act-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const act = btn.dataset.action;
      if (act === 'up')   moveItemOrder(sk, folder.id, -1);
      else if (act==='down') moveItemOrder(sk, folder.id, 1);
      else if (act==='add')  createFolder(sk, folder.id);
      else if (act==='ren')  renameFolder(sk, folder.id);
      else if (act==='del')  deleteFolder(sk, folder.id);
    });
  });

  wrap.appendChild(el);

  if (hasCh && folder.expanded !== false) {
    const cCont = document.createElement('div');
    cCont.className = 'folder-container expanded';
    folder.children.forEach((c, i) => cCont.appendChild(renderFolderNode(c, sk, folder.children, i, lvl + 1)));
    wrap.appendChild(cCont);
  }
  return wrap;
}

function handleFolderClick(e, f, sk) {
  if (e.target.closest('.folder-actions')) return;
  f.expanded = !f.expanded;
  selectFolder(f, sk);
}

function selectFolder(f, sk) {
  selectedFolderId  = f.id;
  selectedStageKey  = sk;
  selectedFolderPath = buildFolderPath(sk, f.id);
  setStageBackground(sk);
  resetFilters();
  renderBreadcrumb();
  renderTree();
  renderGrid(f);
  document.getElementById('filterBar').classList.remove('hidden');
  updateStatsPanel();
}

function buildFolderPath(sk, fid) {
  const conf = STAGE_CONFIG[sk];
  const path = [{ label: conf.label, key: sk, type: 'stage' }];
  function search(nodes, target) {
    for (const n of nodes) {
      if (n.id === target) { path.push({ label: n.name, id: n.id, type: 'folder' }); return true; }
      if (n.children && search(n.children, target)) {
        path.splice(1, 0); // children found, n is parent
        // Re-build correctly:
        return true;
      }
    }
    return false;
  }
  // Full recursive path
  function buildPath(nodes, target, acc) {
    for (const n of nodes) {
      const newAcc = [...acc, { label: n.name, id: n.id, type: 'folder' }];
      if (n.id === target) return newAcc;
      if (n.children) {
        const found = buildPath(n.children, target, newAcc);
        if (found) return found;
      }
    }
    return null;
  }
  const folderPath = buildPath(DB[sk].root, fid, []);
  return [{ label: conf.label, key: sk, type: 'stage' }, ...(folderPath || [])];
}

function renderBreadcrumb(forcePath) {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  bc.innerHTML = '';
  const path = forcePath || selectedFolderPath;
  if (!path || path.length === 0) {
    bc.innerHTML = `<span class="bc-item active" style="font-size:1.1rem">Recapitulación</span>`;
    return;
  }
  path.forEach((seg, i) => {
    const span = document.createElement('span');
    span.className = 'bc-item' + (i === path.length - 1 ? ' active' : '');
    span.textContent = seg.label;
    if (i < path.length - 1) {
      span.addEventListener('click', () => {
        if (seg.type === 'stage') {
          setStageBackground(seg.key);
          selectedStageKey = seg.key;
          selectedFolderId = null;
          selectedFolderPath = [{ label: STAGE_CONFIG[seg.key].label, key: seg.key, type: 'stage' }];
          resetFilters();
          renderBreadcrumb();
          renderStageEmptyState(seg.key);
          renderTree();
          document.getElementById('filterBar').classList.add('hidden');
        } else {
          const f = findNode(DB[selectedStageKey].root, seg.id);
          if (f) selectFolder(f, selectedStageKey);
        }
      });
    }
    bc.appendChild(span);
    if (i < path.length - 1) {
      const sep = document.createElement('span');
      sep.className = 'bc-sep';
      sep.innerHTML = '<i class="fas fa-chevron-right"></i>';
      bc.appendChild(sep);
    }
  });
}

function renderStageEmptyState(sk) {
  const conf = STAGE_CONFIG[sk];
  const area = document.getElementById('contentArea');
  area.innerHTML = `
    <div class="empty-state" style="margin-top:15vh">
      <div class="empty-state-icon"><i class="fas fa-eye"></i></div>
      <h2 class="empty-state-title">${conf.label}</h2>
      <p class="empty-state-sub">Selecciona una carpeta o crea una nueva</p>
      <button class="btn-empty-action" id="btnNewFolderEmpty"><i class="fas fa-folder-plus"></i> Nueva Carpeta</button>
    </div>`;
  document.getElementById('btnNewFolderEmpty').addEventListener('click', () => createFolder(sk, null));
}


// === GRID / CARDS =====================================

function renderGrid(folder) {
  window.currentFolderRef = folder;
  const area = document.getElementById('contentArea');
  area.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'event-grid';
  grid.id = 'eventGrid';

  // Action cards
  const acFolder = document.createElement('div');
  acFolder.className = 'action-card ac-folder';
  acFolder.innerHTML = `<i class="fas fa-folder-plus fa-2x"></i><span>Nueva Carpeta</span>`;
  acFolder.addEventListener('click', () => createFolder(selectedStageKey, folder.id));

  const acEvent = document.createElement('div');
  acEvent.className = 'action-card';
  acEvent.innerHTML = `<i class="fas fa-calendar-plus fa-2x"></i><span>Nuevo Recuerdo</span>`;
  acEvent.addEventListener('click', () => crearEvento(folder));

  grid.appendChild(acFolder);
  grid.appendChild(acEvent);

  // Subcarpetas
  if (folder.children) {
    folder.children.forEach(c => {
      const sc = document.createElement('div');
      sc.className = 'event-card subfolder-card';
      const cStats = computeFolderStats(c);
      sc.innerHTML = `
        <i class="fas fa-folder fa-2x"></i>
        <div>${c.name}</div>
        <div class="subfolder-card-sub">${cStats.done}/${cStats.total} recapitulados</div>`;
      sc.addEventListener('click', () => { c.expanded = true; selectFolder(c, selectedStageKey); });
      grid.appendChild(sc);
    });
  }

  // Eventos (filtrados y ordenados)
  if (folder.events) {
    const filtered = applyFilters(folder.events);
    if (filtered.length === 0 && folder.events.length > 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'grid-column:1/-1;text-align:center;padding:40px 0;color:var(--text-muted);';
      empty.innerHTML = `<i class="fas fa-search" style="font-size:2rem;margin-bottom:12px;display:block;opacity:0.4"></i>Sin resultados para los filtros actuales`;
      grid.appendChild(empty);
    } else if (filtered.length === 0 && folder.events.length === 0) {
      // no hay nada — el action card ya está
    } else {
      filtered.forEach((ev, i) => {
        const realIdx = folder.events.indexOf(ev);
        grid.appendChild(buildEventCard(ev, realIdx, folder));
      });
    }
  }

  area.appendChild(grid);
}

function buildEventCard(ev, realIdx, folder) {
  const t     = ev.tipo_emocion || 'neutro';
  const emo   = EMO_MAP[t] || EMO_MAP.neutro;
  const color = emo.color;
  const c     = ev.completado;

  const card = document.createElement('div');
  card.className = `event-card${c ? ' card-completed' : ''}`;
  card.style.borderColor = color + '44';
  if (ev.image) card.style.backgroundImage = `url('${ev.image}')`;
  card.setAttribute('draggable', 'true');
  card.addEventListener('dragstart', e => handleEventDragStart(e, ev, folder.id, selectedStageKey));

  card.innerHTML = `
    <div class="card-overlay"></div>
    <button class="btn-check-card ${c ? 'checked' : ''}" title="${c ? 'Desmarcar' : 'Marcar recapitulado'}">
      <i class="fas ${c ? 'fa-check-circle' : 'fa-circle'}"></i>
    </button>
    <div class="hero-icon" style="color:${color};border-color:${color}33;background:${color}14">
      <i class="${emo.icon}"></i>
    </div>
    <div class="card-content">
      <div class="card-header-row">
        <span class="badge-intensity" style="color:${color};border-color:${color}44">
          ${t.toUpperCase()} · NVL ${ev.carga_emocional || 0}
        </span>
      </div>
      <div class="card-title">${ev.titulo || 'Sin Título'}</div>
      <div class="card-desc">${ev.descripcion_original || ev.descripcion || ''}</div>
    </div>
    ${ev.spotify ? '<div class="music-indicator"><i class="fab fa-spotify"></i></div>' : ''}
    <div class="card-actions">
      <button class="btn-card btn-card-dup"  title="Duplicar"><i class="fas fa-copy"></i></button>
      <button class="btn-card"               title="Editar"><i class="fas fa-pen"></i></button>
      <button class="btn-card btn-card-del"  title="Borrar"><i class="fas fa-trash"></i></button>
    </div>`;

  // Check rápido
  card.querySelector('.btn-check-card').addEventListener('click', e => {
    e.stopPropagation();
    ev.completado = !ev.completado;
    autoSave();
    const btn = e.currentTarget;
    btn.classList.toggle('checked', ev.completado);
    btn.title = ev.completado ? 'Desmarcar' : 'Marcar recapitulado';
    btn.innerHTML = `<i class="fas ${ev.completado ? 'fa-check-circle' : 'fa-circle'}"></i>`;
    btn.classList.add('check-pop');
    setTimeout(() => btn.classList.remove('check-pop'), 350);
    card.classList.toggle('card-completed', ev.completado);
    renderTree(); // actualizar contadores sidebar
    updateStatsPanel();
  });

  // Duplicar
  card.querySelector('.btn-card-dup').addEventListener('click', e => {
    e.stopPropagation();
    const copia = JSON.parse(JSON.stringify(ev));
    copia.id    = Date.now().toString() + Math.random().toString(36).substr(2,6);
    copia.titulo = (ev.titulo || 'Sin Título') + ' (copia)';
    copia.completado = false;
    folder.events.splice(folder.events.indexOf(ev) + 1, 0, copia);
    autoSave();
    renderGrid(folder);
    Dialog.toast({ message: 'Recuerdo duplicado', type: 'success' });
  });

  // Editar
  card.querySelectorAll('.btn-card')[1].addEventListener('click', e => {
    e.stopPropagation();
    openEditor(ev, folder);
  });

  // Borrar
  card.querySelector('.btn-card-del').addEventListener('click', e => {
    e.stopPropagation();
    deleteEvent(ev, folder);
  });

  // Click en tarjeta → visor
  card.addEventListener('click', e => {
    if (e.target.closest('.card-actions') || e.target.closest('.btn-check-card')) return;
    openViewer(ev);
  });

  return card;
}


// === VIEWER ===========================================

function openViewer(ev) {
  currentEditRef = ev;
  const imgCont = document.getElementById('viewImgCont');
  const img     = document.getElementById('viewImg');
  if (ev.image) { img.src = ev.image; imgCont.style.display = 'flex'; }
  else           { imgCont.style.display = 'none'; }
  document.getElementById('viewTitle').textContent = ev.titulo || 'Sin Título';
  document.getElementById('viewDesc').textContent  = ev.descripcion_original || '';
  document.getElementById('viewEmotion').innerHTML  = `EMOCIÓN: <b style="color:white">${(ev.tipo_emocion||'neutro').toUpperCase()}</b>`;
  document.getElementById('viewIntensity').innerHTML= `INTENSIDAD: <b style="color:var(--accent)">${ev.carga_emocional||0}/10</b>`;
  const sd = document.getElementById('viewSpotify'); sd.innerHTML = '';
  const vd = document.getElementById('viewVideo');   vd.innerHTML = '';
  if (ev.spotify) generateSpotifyIframe(ev.spotify, sd);
  if (ev.video)   generateVideoIframe(ev.video, vd);
  openModal('viewerModal');
}

function closeViewer() {
  closeModal('viewerModal');
  document.getElementById('viewSpotify').innerHTML = '';
  document.getElementById('viewVideo').innerHTML   = '';
}

function switchToEdit() {
  closeViewer();
  openEditor(currentEditRef, window.currentFolderRef);
}


// === EDITOR ===========================================

function openEditor(ev, f) {
  currentEditRef       = ev;
  window.currentFolderRef = f;

  // Reset tabs
  document.getElementById('tab-datos').classList.add('active');
  document.getElementById('tab-media').classList.remove('active');
  document.querySelectorAll('.tab-btn').forEach((b,i) => b.classList.toggle('active', i===0));

  document.getElementById('editTitle').value     = ev.titulo || '';
  document.getElementById('editDesc').value      = ev.descripcion_original || '';
  document.getElementById('editType').value      = ev.tipo_emocion || 'neutro';
  document.getElementById('editIntensity').value = ev.carga_emocional || 5;
  document.getElementById('editCompleted').checked= ev.completado || false;
  document.getElementById('editNotes').value     = ev.observaciones || '';

  tempEventImage = ev.image || null;
  if (tempEventImage) {
    document.getElementById('imgPreview').style.backgroundImage = `url('${tempEventImage}')`;
    document.getElementById('imgUploadLabel').innerHTML = '<i class="fas fa-sync"></i> Cambiar Imagen';
  } else {
    clearEventImage();
  }
  document.getElementById('editSpotify').value = ev.spotify || '';
  previewSpotify('editSpotify', 'spotifyPreview');
  document.getElementById('editVideo').value   = ev.video   || '';
  previewVideo('editVideo', 'videoPreview');

  openModal('editorModal');
}

function closeEditor() { closeModal('editorModal'); }

function saveEdits() {
  if (!currentEditRef) return;
  currentEditRef.titulo              = document.getElementById('editTitle').value.trim() || 'Sin Título';
  currentEditRef.descripcion_original= document.getElementById('editDesc').value;
  currentEditRef.tipo_emocion        = document.getElementById('editType').value;
  currentEditRef.carga_emocional     = parseInt(document.getElementById('editIntensity').value) || 0;
  currentEditRef.completado          = document.getElementById('editCompleted').checked;
  currentEditRef.observaciones       = document.getElementById('editNotes').value;
  currentEditRef.image               = tempEventImage;
  currentEditRef.spotify             = document.getElementById('editSpotify').value.trim();
  currentEditRef.video               = document.getElementById('editVideo').value.trim();
  autoSave();
  closeEditor();
  if (window.currentFolderRef) renderGrid(window.currentFolderRef);
  renderTree();
  updateStatsPanel();
  Dialog.toast({ message: 'Recuerdo guardado', type: 'success' });
}


// === DIALOGS ==========================================

const Dialog = {
  prompt({ title = 'Escribe un nombre', label = '', defaultValue = '', placeholder = '' } = {}) {
    return new Promise(resolve => {
      document.getElementById('dpTitle').textContent       = title;
      document.getElementById('dpLabel').textContent       = label;
      const inp = document.getElementById('dpInput');
      inp.value       = defaultValue;
      inp.placeholder = placeholder;
      openModal('dialogPrompt');
      setTimeout(() => { inp.focus(); inp.select(); }, 80);

      const onOk = () => {
        const val = inp.value.trim();
        cleanup();
        resolve(val || null);
      };
      const onCancel = () => { cleanup(); resolve(null); };
      const onKey = e => { if (e.key === 'Enter') onOk(); };

      document.getElementById('dpOk').addEventListener('click', onOk, { once: true });
      document.getElementById('dpCancel').addEventListener('click', onCancel, { once: true });
      inp.addEventListener('keydown', onKey);

      function cleanup() {
        closeModal('dialogPrompt');
        inp.removeEventListener('keydown', onKey);
      }
    });
  },

  confirm({ title = '¿Confirmar?', message = '', variant = 'default', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar' } = {}) {
    return new Promise(resolve => {
      document.getElementById('dcTitle').textContent   = title;
      document.getElementById('dcMessage').textContent = message;
      document.getElementById('dcIcon').innerHTML      =
        variant === 'danger' ? '<i class="fas fa-exclamation-triangle" style="color:#f87171"></i>' : '<i class="fas fa-question-circle" style="color:#38bdf8"></i>';
      const okBtn = document.getElementById('dcOk');
      okBtn.textContent = confirmLabel;
      okBtn.className   = 'btn ' + (variant === 'danger' ? 'btn-danger' : 'btn-save');
      document.getElementById('dcCancel').textContent = cancelLabel;
      openModal('dialogConfirm');

      const onOk     = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); resolve(false); };
      okBtn.addEventListener('click', onOk,     { once: true });
      document.getElementById('dcCancel').addEventListener('click', onCancel, { once: true });

      function cleanup() { closeModal('dialogConfirm'); }
    });
  },

  toast({ message = '', type = 'success', undoCallback = null, duration = 3500 } = {}) {
    const container = document.getElementById('toastContainer');
    const t = document.createElement('div');
    const icons = { success: '✓', error: '✕', warning: '⚠' };
    t.className = `toast toast-${type}`;
    t.innerHTML = `<span class="toast-icon">${icons[type] || '●'}</span><span>${message}</span>`;
    if (undoCallback) {
      const undoBtn = document.createElement('button');
      undoBtn.className   = 'btn-undo';
      undoBtn.textContent = 'Deshacer';
      undoBtn.addEventListener('click', () => {
        undoCallback();
        removeToast(t);
      });
      t.appendChild(undoBtn);
    }
    container.appendChild(t);
    const timer = setTimeout(() => removeToast(t), duration);
    t._timer = timer;
  }
};

function removeToast(t) {
  clearTimeout(t._timer);
  t.classList.add('out');
  setTimeout(() => t.remove(), 280);
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('open');
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}

// Cerrar modales clicando el overlay
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    const id = e.target.id;
    // No cerrar dialog modales por click en overlay (requieren acción explícita)
    if (id === 'viewerModal' || id === 'editorModal') {
      closeModal(id);
      if (id === 'viewerModal') {
        document.getElementById('viewSpotify').innerHTML = '';
        document.getElementById('viewVideo').innerHTML   = '';
      }
    }
  }
});


// === SEARCH / FILTERS =================================

function setupFilterBar() {
  // Chips de emoción
  const ef = document.getElementById('emotionFilters');
  ef.innerHTML = '';
  Object.entries(EMO_MAP).forEach(([key, val]) => {
    const chip = document.createElement('span');
    chip.className = 'chip-emo';
    chip.textContent = key.toUpperCase();
    chip.style.borderColor = val.color + '55';
    chip.dataset.emo = key;
    chip.addEventListener('click', () => {
      if (activeFilters.emotions.has(key)) {
        activeFilters.emotions.delete(key);
        chip.classList.remove('active');
        chip.style.background = 'rgba(255,255,255,0.05)';
        chip.style.color      = '';
      } else {
        activeFilters.emotions.add(key);
        chip.classList.add('active');
        chip.style.background = val.color + '22';
        chip.style.color      = val.color;
      }
      refreshGrid();
    });
    ef.appendChild(chip);
  });

  document.getElementById('searchInput').addEventListener('input', e => {
    activeFilters.search = e.target.value.toLowerCase();
    refreshGrid();
  });

  document.getElementById('intensitySlider').addEventListener('input', e => {
    activeFilters.minIntensity = parseInt(e.target.value);
    document.getElementById('intensityLabel').textContent = e.target.value;
    refreshGrid();
  });

  document.getElementById('statusFilter').addEventListener('change', e => {
    activeFilters.status = e.target.value;
    refreshGrid();
  });

  document.getElementById('sortSelect').addEventListener('change', e => {
    activeFilters.sort = e.target.value;
    refreshGrid();
  });

  document.getElementById('btnClearFilters').addEventListener('click', () => {
    resetFilters();
    refreshGrid();
  });
}

function resetFilters() {
  activeFilters = { search: '', emotions: new Set(), minIntensity: 0, status: 'all', sort: 'manual' };
  const si = document.getElementById('searchInput');    if (si) si.value = '';
  const il = document.getElementById('intensitySlider'); if (il) { il.value = 0; }
  const ilb= document.getElementById('intensityLabel'); if (ilb) ilb.textContent = '0';
  const sf = document.getElementById('statusFilter');   if (sf) sf.value = 'all';
  const ss = document.getElementById('sortSelect');     if (ss) ss.value = 'manual';
  document.querySelectorAll('.chip-emo').forEach(c => {
    c.classList.remove('active');
    c.style.background = '';
    c.style.color = '';
  });
}

function applyFilters(events) {
  let list = [...events];

  if (activeFilters.search) {
    const q = activeFilters.search;
    list = list.filter(ev =>
      (ev.titulo||'').toLowerCase().includes(q) ||
      (ev.descripcion_original||'').toLowerCase().includes(q) ||
      (ev.observaciones||'').toLowerCase().includes(q)
    );
  }

  if (activeFilters.emotions.size > 0) {
    list = list.filter(ev => activeFilters.emotions.has(ev.tipo_emocion || 'neutro'));
  }

  if (activeFilters.minIntensity > 0) {
    list = list.filter(ev => (ev.carga_emocional || 0) >= activeFilters.minIntensity);
  }

  if (activeFilters.status === 'done')    list = list.filter(ev => ev.completado);
  if (activeFilters.status === 'pending') list = list.filter(ev => !ev.completado);

  if (activeFilters.sort === 'title')
    list.sort((a,b) => (a.titulo||'').localeCompare(b.titulo||''));
  else if (activeFilters.sort === 'intensity')
    list.sort((a,b) => (b.carga_emocional||0) - (a.carga_emocional||0));
  else if (activeFilters.sort === 'emotion')
    list.sort((a,b) => (a.tipo_emocion||'').localeCompare(b.tipo_emocion||''));

  return list;
}

function refreshGrid() {
  const f = window.currentFolderRef;
  if (f) renderGrid(f);
}


// === STATS ============================================

function computeStageStats(sk) {
  let done = 0, total = 0;
  function walk(nodes) {
    nodes.forEach(n => {
      if (n.events) n.events.forEach(ev => { total++; if (ev.completado) done++; });
      if (n.children) walk(n.children);
    });
  }
  walk(DB[sk].root);
  return { done, total };
}

function computeFolderStats(folder) {
  let done = 0, total = 0;
  if (folder.events) folder.events.forEach(ev => { total++; if (ev.completado) done++; });
  if (folder.children) folder.children.forEach(c => {
    const cs = computeFolderStats(c); done += cs.done; total += cs.total;
  });
  return { done, total };
}

function computeGlobalStats() {
  let done = 0, total = 0;
  const byEmo = {};
  Object.keys(EMO_MAP).forEach(k => { byEmo[k] = 0; });
  let totalIntensity = 0;

  ['infancia','adolescencia','adultez'].forEach(sk => {
    function walk(nodes) {
      nodes.forEach(n => {
        if (n.events) n.events.forEach(ev => {
          total++;
          if (ev.completado) done++;
          const emo = ev.tipo_emocion || 'neutro';
          if (byEmo[emo] !== undefined) byEmo[emo]++; else byEmo[emo] = 1;
          totalIntensity += (ev.carga_emocional || 0);
        });
        if (n.children) walk(n.children);
      });
    }
    walk(DB[sk].root);
  });

  return { done, total, byEmo, avgIntensity: total > 0 ? (totalIntensity / total).toFixed(1) : 0 };
}

function updateStatsPanel() {
  const panel = document.getElementById('statsPanel');
  if (!panel || panel.classList.contains('hidden')) return;
  renderStatsContent();
}

function renderStatsContent() {
  const panel = document.getElementById('statsPanel');
  const st    = computeGlobalStats();
  const pct   = st.total > 0 ? Math.round((st.done / st.total) * 100) : 0;

  const maxEmo = Math.max(1, ...Object.values(st.byEmo));
  const emoBars = Object.entries(st.byEmo)
    .filter(([,v]) => v > 0)
    .sort((a,b) => b[1]-a[1])
    .map(([k,v]) => {
      const w = Math.round((v / maxEmo) * 100);
      const col = EMO_MAP[k]?.color || '#fff';
      return `<span class="stats-emo-bar"><div class="stats-emo-pill" style="width:${w}px;background:${col}"></div>${k} (${v})</span>`;
    }).join('');

  panel.innerHTML = `
    <div class="stats-grid">
      <div class="stats-card">
        <div class="stats-card-label">Total recuerdos</div>
        <div class="stats-card-value">${st.total}</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-label">Recapitulados</div>
        <div class="stats-card-value" style="color:var(--success)">${st.done}</div>
        <div class="stats-card-sub">${pct}% completado</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-label">Pendientes</div>
        <div class="stats-card-value" style="color:var(--accent)">${st.total - st.done}</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-label">Intensidad media</div>
        <div class="stats-card-value" style="color:var(--warning)">${st.avgIntensity}</div>
        <div class="stats-card-sub">sobre 10</div>
      </div>
    </div>
    <div class="stats-progress"><div class="stats-progress-fill" style="width:${pct}%"></div></div>
    <div class="stats-emotions">${emoBars || '<span style="color:var(--text-muted);font-size:0.8rem">Sin datos aún</span>'}</div>`;
}

function toggleStats() {
  const panel = document.getElementById('statsPanel');
  const btn   = document.getElementById('btnStats');
  panel.classList.toggle('hidden');
  btn.classList.toggle('active', !panel.classList.contains('hidden'));
  if (!panel.classList.contains('hidden')) renderStatsContent();
}


// === DRAG & DROP ======================================

function handleDragStart(e, item, sk, type) {
  e.stopPropagation();
  draggedItem = { item, stageKey: sk, type };
  if (type !== 'event') e.dataTransfer.setData('text', JSON.stringify(item.id));
  setTimeout(() => { if (e.target) e.target.style.opacity = '0.45'; }, 0);
}

function handleEventDragStart(e, ev, fid, sk) {
  e.stopPropagation();
  draggedItem = { type: 'event', event: ev, sourceFolderId: fid, stageKey: sk };
  e.dataTransfer.setData('text', 'ev');
  setTimeout(() => { if (e.target) e.target.style.opacity = '0.45'; }, 0);
}

function handleDrop(e, tf, sk) {
  e.preventDefault();
  e.stopPropagation();
  const el = e.target.closest('.folder-node');
  if (el) el.classList.remove('drag-over');
  if (!draggedItem) return;

  if (draggedItem.type === 'folder') {
    if (draggedItem.item.id === tf.id) return;
    if (draggedItem.stageKey !== sk)   return;
    moveFolder(sk, draggedItem.item.id, tf.id);
  }
  if (draggedItem.type === 'event') {
    if (draggedItem.stageKey !== sk)          return;
    if (draggedItem.sourceFolderId === tf.id) return;
    moveEvent(sk, draggedItem.event, draggedItem.sourceFolderId, tf.id);
  }
  draggedItem = null;
  renderTree();
  if (selectedFolderId) {
    const f = findNode(DB[sk].root, selectedFolderId);
    if (f) renderGrid(f);
  }
}

function moveFolder(sk, did, tid) {
  const ext = findAndRemove(DB[sk].root, did);
  if (!ext) return;
  const tgt = findNode(DB[sk].root, tid);
  if (tgt) { if (!tgt.children) tgt.children = []; tgt.children.unshift(ext); tgt.expanded = true; autoSave(); }
}

function moveEvent(sk, ev, sid, tid) {
  const sf = findNode(DB[sk].root, sid);
  if (!sf || !sf.events) return;
  const idx = sf.events.indexOf(ev);
  if (idx > -1) sf.events.splice(idx, 1);
  const tf = findNode(DB[sk].root, tid);
  if (tf) { if (!tf.events) tf.events = []; tf.events.push(ev); autoSave(); }
}

function moveItemOrder(sk, id, dir) {
  const arr = findParentArray(DB[sk].root, id);
  if (!arr) return;
  const idx  = arr.findIndex(x => x.id === id);
  const tidx = idx + dir;
  if (tidx >= 0 && tidx < arr.length) {
    [arr[tidx], arr[idx]] = [arr[idx], arr[tidx]];
    autoSave();
    renderTree();
  }
}


// === IMAGES ===========================================

function compressImage(file, callback) {
  const img  = new Image();
  const url  = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const MAX = 1600;
    let w = img.width, h = img.height;
    if (w > MAX || h > MAX) {
      if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
      else        { w = Math.round(w * MAX / h); h = MAX; }
    }
    const canvas  = document.createElement('canvas');
    canvas.width  = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    let quality = 0.82;
    let result  = canvas.toDataURL('image/jpeg', quality);

    while (result.length > 900 * 1024 * 1.37 && quality > 0.6) {
      quality -= 0.08;
      result   = canvas.toDataURL('image/jpeg', quality);
    }

    if (result.length > 1200 * 1024 * 1.37) {
      Dialog.confirm({
        title: 'Imagen grande',
        message: `La imagen sigue siendo grande (~${Math.round(result.length / 1024 / 1.37)} KB). ¿Usarla de todos modos?`,
        variant: 'default',
        confirmLabel: 'Usar',
        cancelLabel: 'Cancelar'
      }).then(ok => { if (ok) callback(result); });
    } else {
      callback(result);
    }
  };
  img.onerror = () => Dialog.toast({ message: 'No se pudo cargar la imagen', type: 'error' });
  img.src = url;
}

function handleImageUpload(file, cb) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    Dialog.toast({ message: `Archivo demasiado grande (${(file.size/1024/1024).toFixed(1)} MB). Máximo 8 MB.`, type: 'error' });
    return;
  }
  compressImage(file, cb);
}

function clearEventImage() {
  tempEventImage = null;
  document.getElementById('imgPreview').style.backgroundImage = 'none';
  document.getElementById('imgUploadLabel').innerHTML = '<i class="fas fa-camera"></i> Subir Imagen';
}

function triggerIconUpload(sk) {
  currentIconTargetKey = sk;
  document.getElementById('iconInput').click();
}

function triggerStageBgUpload(sk) {
  currentBgTargetKey = sk;
  document.getElementById('stageBgInput').click();
}


// === CRUD FOLDERS =====================================

async function createFolder(sk, pid) {
  const n = await Dialog.prompt({ title: 'Nueva Carpeta', label: 'Nombre', placeholder: 'Ej: Con papá' });
  if (!n) return;
  const nf = { id: Date.now().toString(), name: n, children: [], events: [], expanded: true };
  if (pid) {
    const p = findNode(DB[sk].root, pid);
    if (p) { if (!p.children) p.children = []; p.children.unshift(nf); p.expanded = true; }
  } else {
    DB[sk].root.unshift(nf);
  }
  autoSave();
  renderTree();
  Dialog.toast({ message: `Carpeta "${n}" creada`, type: 'success' });
}

async function renameFolder(sk, id) {
  const n = findNode(DB[sk].root, id);
  if (!n) return;
  const nn = await Dialog.prompt({ title: 'Renombrar Carpeta', label: 'Nuevo nombre', defaultValue: n.name });
  if (!nn) return;
  n.name = nn;
  autoSave();
  renderTree();
  if (selectedFolderId === id) renderBreadcrumb();
}

async function deleteFolder(sk, id) {
  const ok = await Dialog.confirm({
    title: 'Borrar Carpeta',
    message: 'Se borrarán la carpeta y todos sus recuerdos. ¿Continuar?',
    variant: 'danger',
    confirmLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;

  const deleted = JSON.parse(JSON.stringify(findNode(DB[sk].root, id)));
  findAndRemove(DB[sk].root, id);

  if (selectedFolderId === id) {
    selectedFolderId   = null;
    selectedFolderPath = [];
    document.getElementById('contentArea').innerHTML = '';
    document.getElementById('filterBar').classList.add('hidden');
    renderBreadcrumb();
  }
  autoSave();
  renderTree();
  Dialog.toast({
    message: `Carpeta borrada`,
    type: 'warning',
    undoCallback: () => {
      if (!deleted) return;
      if (deleted.parentId) {
        const p = findNode(DB[sk].root, deleted.parentId);
        if (p) { if (!p.children) p.children = []; p.children.unshift(deleted); }
      } else {
        DB[sk].root.unshift(deleted);
      }
      autoSave(); renderTree();
    }
  });
}


// === CRUD EVENTS ======================================

function crearEvento(f) {
  const n = { titulo: 'Nuevo Recuerdo', descripcion_original: '', tipo_emocion: 'neutro', carga_emocional: 5, completado: false };
  if (!f.events) f.events = [];
  f.events.push(n);
  autoSave();
  openEditor(n, f);
}

async function deleteEvent(ev, folder) {
  const ok = await Dialog.confirm({
    title: 'Borrar Recuerdo',
    message: `¿Borrar "${ev.titulo || 'este recuerdo'}"?`,
    variant: 'danger',
    confirmLabel: 'Borrar',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;
  const idx = folder.events.indexOf(ev);
  if (idx < 0) return;
  const snapshot = JSON.parse(JSON.stringify(ev));
  folder.events.splice(idx, 1);
  autoSave();
  renderGrid(folder);
  renderTree();
  updateStatsPanel();
  Dialog.toast({
    message: `"${snapshot.titulo || 'Recuerdo'}" borrado`,
    type: 'warning',
    duration: 6000,
    undoCallback: () => {
      folder.events.splice(idx, 0, snapshot);
      autoSave(); renderGrid(folder); renderTree(); updateStatsPanel();
    }
  });
}


// === IMPORT / EXPORT ==================================

function downloadBackup() {
  const a = document.createElement('a');
  const f = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
  a.href     = URL.createObjectURL(f);
  a.download = `tolteca_tree_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  Dialog.toast({ message: 'Copia exportada correctamente', type: 'success' });
}

async function resetFactory() {
  const ok = await Dialog.confirm({
    title: 'Restablecer de fábrica',
    message: 'Se borrarán TODOS los datos y recuerdos. Esta acción no se puede deshacer. ¿Continuar?',
    variant: 'danger',
    confirmLabel: 'Borrar todo',
    cancelLabel: 'Cancelar'
  });
  if (!ok) return;
  localStorage.removeItem('tolteca_db_v10');
  location.reload();
}

function setupFileInputs() {
  document.getElementById('iconInput').addEventListener('change', function(e) {
    handleImageUpload(e.target.files[0], r => {
      DB[currentIconTargetKey].iconData = r;
      autoSave(); renderTree();
    });
    e.target.value = '';
  });

  document.getElementById('stageBgInput').addEventListener('change', function(e) {
    handleImageUpload(e.target.files[0], r => {
      DB[currentBgTargetKey].bgImageData = r;
      autoSave(); setStageBackground(currentBgTargetKey);
    });
    e.target.value = '';
  });

  document.getElementById('eventImgInput').addEventListener('change', function(e) {
    handleImageUpload(e.target.files[0], r => {
      tempEventImage = r;
      document.getElementById('imgPreview').style.backgroundImage = `url('${r}')`;
      document.getElementById('imgUploadLabel').innerHTML = '<i class="fas fa-sync"></i> Cambiar Imagen';
    });
    e.target.value = '';
  });

  document.getElementById('bgInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    handleImageUpload(file, r => {
      document.body.style.backgroundImage = `url('${r}')`;
      try { localStorage.setItem('tolteca_bg_data', r); } catch(err) {}
    });
    e.target.value = '';
  });

  document.getElementById('fileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        const j = JSON.parse(evt.target.result);
        if (j.infancia && j.infancia.root) {
          // Copia de seguridad completa: restaurar directamente
          DB = j;
          // Asegurarse de que todas las etapas tienen los campos necesarios
          ['infancia','adolescencia','adultez'].forEach(k => {
            if (!DB[k]) DB[k] = JSON.parse(JSON.stringify(DB_DEFAULT[k]));
            if (DB[k].iconData    === undefined) DB[k].iconData    = null;
            if (DB[k].bgImageData === undefined) DB[k].bgImageData = null;
          });
          // Expandir todas las etapas para que se vean los datos
          ['infancia','adolescencia','adultez'].forEach(k => { DB[k].expanded = true; });
          autoSave();
          selectedFolderId   = null;
          selectedStageKey   = null;
          selectedFolderPath = [];
          renderTree();
          renderBreadcrumb();
          updateStatsPanel();
          document.getElementById('filterBar').classList.add('hidden');
          document.getElementById('contentArea').innerHTML = `
            <div class="empty-state" style="margin-top:12vh">
              <div class="empty-state-icon"><i class="fas fa-check-circle" style="color:var(--success)"></i></div>
              <h2 class="empty-state-title" style="font-size:2rem">Datos restaurados</h2>
              <p class="empty-state-sub">Selecciona una etapa en el panel izquierdo para ver tus recuerdos</p>
            </div>`;
          Dialog.toast({ message: 'Copia restaurada correctamente', type: 'success' });
        } else if (j.infancia && j.infancia.data) {
          migrateV1toV10(j);
          renderTree();
          Dialog.toast({ message: 'Datos v1 migrados correctamente', type: 'success' });
        } else if (j.inventario && Array.isArray(j.inventario)) {
          // Formato inventario: { archivo_origen, inventario: [{ persona_o_contexto, eventos[] }] }
          migrateInventarioFile(j);
        } else {
          // Intentar fusión parcial
          let count = 0;
          ['infancia','adolescencia','adultez'].forEach(k => {
            if (j[k] && j[k].root) { DB[k].root = DB[k].root.concat(j[k].root); count++; }
          });
          if (count > 0) {
            autoSave(); renderTree();
            Dialog.toast({ message: `Datos importados (${count} etapas)`, type: 'success' });
          } else {
            Dialog.toast({ message: 'Formato JSON no reconocido', type: 'error' });
          }
        }
      } catch(err) {
        console.error('Error importando JSON:', err);
        Dialog.toast({ message: 'Error al leer el archivo JSON', type: 'error' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}


// === MEDIA ============================================

function generateSpotifyIframe(url, cont) {
  if (!url.includes('spotify.com')) return;
  if (url.includes('?')) url = url.split('?')[0];
  let eu = url;
  if (!url.includes('/embed')) {
    eu = url
      .replace(/\/track\//,    '/embed/track/')
      .replace(/\/album\//,    '/embed/album/')
      .replace(/\/playlist\//, '/embed/playlist/')
      .replace(/\/episode\//, '/embed/episode/');
  }
  cont.innerHTML = `<iframe style="border-radius:12px;margin-top:12px" src="${eu}" width="100%" height="80" frameBorder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
}

function generateVideoIframe(url, cont) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    let vid = url.split('v=')[1];
    if (!vid && url.includes('youtu.be')) vid = url.split('/').pop().split('?')[0];
    const amp = vid ? vid.indexOf('&') : -1;
    if (amp !== -1) vid = vid.substring(0, amp);
    if (vid) cont.innerHTML = `<iframe style="margin-top:12px;border-radius:12px" width="100%" height="300" src="https://www.youtube.com/embed/${vid}" frameborder="0" allowfullscreen></iframe>`;
  }
}

function previewSpotify(inputId, previewId) {
  const u = document.getElementById(inputId).value.trim();
  const c = document.getElementById(previewId);
  c.innerHTML = '';
  generateSpotifyIframe(u, c);
}

function previewVideo(inputId, previewId) {
  const u = document.getElementById(inputId).value;
  const c = document.getElementById(previewId);
  c.innerHTML = '';
  generateVideoIframe(u, c);
}


// === UTILS ============================================

function findNode(list, id) {
  for (const n of list) {
    if (n.id === id) return n;
    if (n.children) { const f = findNode(n.children, id); if (f) return f; }
  }
  return null;
}

function findAndRemove(list, id) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list.splice(i, 1)[0];
    if (list[i].children) { const f = findAndRemove(list[i].children, id); if (f) return f; }
  }
  return null;
}

function findParentArray(list, id) {
  if (list.some(x => x.id === id)) return list;
  for (const n of list) {
    if (n.children) { const f = findParentArray(n.children, id); if (f) return f; }
  }
  return null;
}

function switchTab(e, t) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + t).classList.add('active');
  e.currentTarget.classList.add('active');
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop= document.getElementById('sidebarBackdrop');
  const isMobile = window.innerWidth <= 720;
  if (isMobile) {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('visible', sidebar.classList.contains('open'));
  } else {
    sidebar.classList.toggle('collapsed');
  }
}

// Cerrar sidebar en móvil al clicar el backdrop
document.getElementById('sidebarBackdrop').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('visible');
});


// === KEYBOARD SHORTCUTS ===============================

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    const inInput = ['INPUT','TEXTAREA','SELECT'].includes(tag);

    // Esc: cerrar modales abiertos
    if (e.key === 'Escape') {
      ['viewerModal','editorModal','dialogPrompt','dialogConfirm'].forEach(id => closeModal(id));
      document.getElementById('viewSpotify').innerHTML = '';
      document.getElementById('viewVideo').innerHTML   = '';
      // Cerrar sidebar en móvil
      if (window.innerWidth <= 720) {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarBackdrop').classList.remove('visible');
      }
      return;
    }

    if (inInput) return;

    // / : foco en búsqueda
    if (e.key === '/' && !e.ctrlKey) {
      e.preventDefault();
      const si = document.getElementById('searchInput');
      if (si && !document.getElementById('filterBar').classList.contains('hidden')) {
        si.focus();
      }
      return;
    }

    // Ctrl+N: nuevo evento en carpeta activa
    if (e.key === 'n' && e.ctrlKey) {
      e.preventDefault();
      if (window.currentFolderRef) crearEvento(window.currentFolderRef);
      return;
    }
  });
}


// === DOM SETUP (botones globales) =====================

document.addEventListener('DOMContentLoaded', () => {
  // Hamburger
  document.getElementById('btnToggleSidebar')?.addEventListener('click', toggleSidebar);

  // Importar JSON
  document.getElementById('btnImport')?.addEventListener('click', () => document.getElementById('fileInput').click());

  // Estadísticas
  document.getElementById('btnStats')?.addEventListener('click', toggleStats);

  // Fondo global
  document.getElementById('btnChangeBg')?.addEventListener('click', () => document.getElementById('bgInput').click());

  // Footer sidebar
  document.getElementById('btnExport')?.addEventListener('click', downloadBackup);
  document.getElementById('btnReset')?.addEventListener('click', resetFactory);
  document.getElementById('btnSidebarBg')?.addEventListener('click', () => document.getElementById('bgInput').click());

  // Editor: guardar / cancelar
  document.getElementById('btnSaveEdits')?.addEventListener('click', saveEdits);
  document.getElementById('btnCloseEditor')?.addEventListener('click', closeEditor);

  // Visor: cerrar / editar
  document.getElementById('btnCloseViewer')?.addEventListener('click', closeViewer);
  document.getElementById('btnEditFromViewer')?.addEventListener('click', switchToEdit);

  // Imagen del evento
  document.getElementById('btnClearImg')?.addEventListener('click', clearEventImage);
  document.getElementById('imgPreview')?.addEventListener('click', () => document.getElementById('eventImgInput').click());

  // Spotify y YouTube preview en editor
  document.getElementById('editSpotify')?.addEventListener('input', () => previewSpotify('editSpotify','spotifyPreview'));
  document.getElementById('editVideo')?.addEventListener('input',   () => previewVideo('editVideo','videoPreview'));

  // Tabs del editor
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', e => switchTab(e, btn.dataset.tab));
  });

  // Setup barra de filtros
  setupFilterBar();
});
