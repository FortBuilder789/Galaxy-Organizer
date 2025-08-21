// STORAGE KEY
const STORAGE_KEY = 'solar-system-nav';

// Default state skeleton
const DEFAULT_STATE = {
  systems: {},
  current: null,
  editMode: false,
  linkMode: true,
  adv: {
    showHex: false,
    speedMult: 1,
    font: 'Inter,system-ui,Arial',
    disableOrbits: true,
    partyGlobal: false,
    lockLayout: false,
    keybinds: { modifier: 'ctrl', undo: 'z', redo: 'y' }}
};

// DOM refs
const space = document.getElementById('space');
const bg = document.getElementById('bg');
const tabList = document.getElementById('tab-list');
const editor = document.getElementById('editor');
const editorBody = document.getElementById('editor-body');
const editorTitle = document.getElementById('editor-title');
const editorModeLabel = document.getElementById('editor-mode');
const toastContainer = document.getElementById('toast-container');

const overlay = document.getElementById('overlay');
const confirmModal = document.getElementById('confirm-modal');
const confirmText = document.getElementById('confirm-text');
const confirmCancel = document.getElementById('confirm-cancel');
const confirmOk = document.getElementById('confirm-ok');

const aboutFab = document.getElementById('about-fab');
const aboutModal = document.getElementById('about-modal');
const aboutClose = document.getElementById('about-close');

const howtoBtn = document.getElementById('btn-howto');
const howtoModal = document.getElementById('howto-modal');
const howtoClose = document.getElementById('howto-close');

// Runtime state
let state = JSON.parse(JSON.stringify(DEFAULT_STATE)); // deep copy
let rafId = null;
let lastTick = performance.now();
let dragging = null;
let dragOffset = {x:0,y:0};
let currentSelection = null;
let confirmResolve = null;
const elementCache = new Map(); // cache planet DOM elements by id

// Utility helpers
function uid(){ return crypto.randomUUID?.() || (Date.now().toString(36)+Math.random().toString(36).slice(2,8)); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a }
function randomColorHsl(){ return `hsl(${randInt(0,359)} ${randInt(55,85)}% ${randInt(45,65)}%)` }
function toast(text, type=''){ if(!toastContainer) return; const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = text; toastContainer.appendChild(t); setTimeout(()=>{ t.style.transition='opacity .3s'; t.style.opacity='0'; setTimeout(()=>t.remove(),300); },3000); }
function escapeHtml(s=''){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }

// Color helpers
function colorToHex(hslOrHex){
  if(!hslOrHex) return '#808080';
  if(hslOrHex.startsWith('#')) return hslOrHex;
  try{
    const m = hslOrHex.match(/hsl\((\d+)[^\d]+(\d+)%[^\d]+(\d+)%/);
    if(!m) return '#808080';
    let h = parseInt(m[1])/360, s = parseInt(m[2])/100, l = parseInt(m[3])/100;
    function hue2rgb(p,q,t){
      if(t<0) t+=1; if(t>1) t-=1;
      if(t<1/6) return p+(q-p)*6*t;
      if(t<1/2) return q;
      if(t<2/3) return p+(q-p)*(2/3 - t)*6;
      return p;
    }
    let r,g,b;
    if(s===0){ r=g=b=l; } else {
      const q = l < 0.5 ? l*(1+s) : l+s-l*s;
      const p = 2*l-q;
      r = hue2rgb(p,q,h+1/3);
      g = hue2rgb(p,q,h);
      b = hue2rgb(p,q,h-1/3);
    }
    const rh = Math.round(r*255).toString(16).padStart(2,'0');
    const gh = Math.round(g*255).toString(16).padStart(2,'0');
    const bh = Math.round(b*255).toString(16).padStart(2,'0');
    return `#${rh}${gh}${bh}`;
  }catch(e){ return '#808080' }
}

function darken(hex, percent){
  if(!hex) return hex;
  const c = hex.replace('#','');
  let r = parseInt(c.substring(0,2),16), g = parseInt(c.substring(2,4),16), b = parseInt(c.substring(4,6),16);
  r = Math.max(0, Math.floor(r*(1-percent/100)));
  g = Math.max(0, Math.floor(g*(1-percent/100)));
  b = Math.max(0, Math.floor(b*(1-percent/100)));
  return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function rgba(hex,a=1){
  if(!hex) return `rgba(255,255,255,${a})`;
  const c = hex.replace('#','');
  let r = parseInt(c.substring(0,2),16), g = parseInt(c.substring(2,4),16), b = parseInt(c.substring(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

// State factories
function makeSystem(name='System', sunColor='#ffcc00'){
  return {
    id: uid(),
    name,
    sunColor,
    bgSolid: '#06102a',
    bgGradient: '#08122f',
    bgAngle: 120,
    outlineColor: '#111111',
    partyMode: false,
    font: state.adv.font,
    planets: []
  };
}

function makePlanet(name='New Planet', url='', x=0, y=0, size=18, color=null, shape='circle', outline=2, outlineColor='#111'){
  return {
    id: uid(),
    name: name || 'New Planet',
    url: url||'',
    x: x||0,
    y: y||0,
    sizePercent: size||18,
    color: color || randomColorHsl(),
    shape: shape||'circle',
    outlineThickness: (outline === undefined ? 0 : outline),
    outlineColor: outlineColor || '#ffffff',
    opacity: 1,
    orbit: {
      radius: Math.hypot(x,y)||200,
      angle: Math.atan2(y,x)||0,
      speed: (Math.random()*0.4)+0.1,
      rotating: !state.adv.disableOrbits,
      reverse: false,
      showRing: false
    },
    spin: { enabled:false, speed:0.5 }
  };
}

// State load & migration
function migrateLoaded(loaded){
  // Merge top-level defaults -> keep loaded values but ensure the new fields exist
  const merged = Object.assign({}, DEFAULT_STATE, loaded || {});
  merged.adv = Object.assign({}, DEFAULT_STATE.adv, (loaded && loaded.adv) || {});
  // Normalize systems
  const systems = {};
  if(loaded && loaded.systems){
    if(Array.isArray(loaded.systems)){
      loaded.systems.forEach(s => { if(s && s.id) systems[s.id] = s; });
    } else if(typeof loaded.systems === 'object'){
      Object.entries(loaded.systems).forEach(([k,v])=>{
        if(!v) return;
        v.id = v.id || k;
        v.planets = Array.isArray(v.planets) ? v.planets : (v.planets ? Object.values(v.planets) : []);
        systems[k] = v;
      });
    }
  }
  merged.systems = Object.keys(systems).length ? systems : {};
  // Final validation: ensure planets arrays & ids
  Object.entries(merged.systems).forEach(([id, sys])=>{
    sys.id = sys.id || id;
    sys.planets = Array.isArray(sys.planets) ? sys.planets.map(p => {
      p.id = p.id || uid();
      p.sizePercent = p.sizePercent || 18;
      p.orbit = p.orbit || { radius: Math.hypot(p.x||0, p.y||0) || 200, angle: Math.atan2(p.y||0, p.x||0) || 0, speed: (p.orbit && p.orbit.speed) || 0.2, rotating: !(merged.adv && merged.adv.disableOrbits), reverse: false, showRing:false };
      return p;
    }) : [];
  });
  // Ensure current points to a valid system
  if(!merged.current || !merged.systems[merged.current]) merged.current = Object.keys(merged.systems)[0] || null;
  return merged;
}

function save(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){ toast('Failed to save - storage may be full','error'); }
}

function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw){
      createDefaultSystems();
      save();
      return;
    }
    let parsed;
    try{
      parsed = JSON.parse(raw);
    }catch(e){
      console.error('Failed to parse saved state', e);
      createDefaultSystems();
      save();
      return;
    }
    state = migrateLoaded(parsed);
    // if no systems, create defaults
    if(!state.current || Object.keys(state.systems).length === 0){
      createDefaultSystems();
    }
    // persist migrated structure
    save();
  }catch(e){
    console.error('Load failed', e);
    createDefaultSystems();
    save();
  }
}

// default data
function createDefaultSystems(){
  state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  const w = uid(), p = uid();
  state.systems[w] = makeSystem('School', '#ffcc00');
  state.systems[p] = makeSystem('Personal', '#ff9900');
  state.current = w;
  state.systems[w].planets.push(makePlanet('Email','https://mail.google.com',200,0,15,'#4285F4','circle',2,'#111'));
  state.systems[w].planets.push(makePlanet('Calendar','https://calendar.google.com',0,200,15,'#EA4335','diamond',2,'#111'));
  state.systems[w].planets.push(makePlanet('Drive','https://drive.google.com',-200,0,15,'#34A853','square',2,'#111'));
  save();
}

// Renderers
function renderTabs(){
  tabList.innerHTML = '';
  if(!state.systems || Object.keys(state.systems).length === 0){
    createDefaultSystems();
    return;
  }
  Object.values(state.systems).forEach(sys =>{
    if(!sys || !sys.id) return;
    const tab = document.createElement('div');
    tab.className = `tab ${sys.id === state.current ? 'active' : ''}`;
    tab.dataset.id = sys.id;
    tab.innerHTML = `
      <div class="name" title="${escapeHtml(sys.name)}">${escapeHtml(sys.name)}</div>
      <div class="actions">
        <button class="icon-btn btn-dup" title="Duplicate" data-id="${sys.id}">⎘</button>
        <button class="icon-btn btn-del" title="Delete" data-id="${sys.id}">×</button>
      </div>
    `;
    tab.addEventListener('click', (e)=>{
      if(e.target.closest('.btn-dup') || e.target.closest('.btn-del')) return;
      if(state.systems[sys.id]){ state.current = sys.id; renderAll(); save(); } else { toast('System not found - repairing'); repairSystems(); }
    });
    tab.querySelector('.btn-dup').addEventListener('click', ev => { ev.stopPropagation(); duplicateSystem(sys.id); });
    tab.querySelector('.btn-del').addEventListener('click', ev => {
      ev.stopPropagation();
      if(Object.keys(state.systems).length <= 1){ toast('Must have at least one system'); return; }
      confirmDialog(`Delete system "${sys.name}"?`).then(ok => {
        if(ok){ delete state.systems[sys.id]; if(state.current === sys.id) state.current = Object.keys(state.systems)[0] || null; renderAll(); save(); toast('System deleted'); }
      });
    });
    tabList.appendChild(tab);
  });

  // footer add button
  const footer = document.createElement('div');
  footer.style.padding='8px';
  footer.style.display='flex';
  footer.style.gap='8px';
  const addBtn = document.createElement('button');
  addBtn.className='small';
  addBtn.textContent = '+ New System';
  addBtn.addEventListener('click', createNewSystem);
  footer.appendChild(addBtn);
  tabList.appendChild(footer);
}

function renderSpace(){
  space.innerHTML = '';
  elementCache.clear();
  bg.style.background = linearBgForCurrent();
  const sys = state.systems[state.current];
  if(!sys) return;

  if(sys.partyMode || state.adv.partyGlobal) space.classList.add('party'); else space.classList.remove('party');

  // Render sun
  const sun = document.createElement('div');
  sun.className = 'body sun shape-circle';
  sun.dataset.id = 'SUN';
  const sunSize = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.18);
  sun.style.width = sun.style.height = sunSize+'px';
  sun.style.left = `calc(50% - ${sunSize/2}px)`;
  sun.style.top = `calc(50% - ${sunSize/2}px)`;
  sun.style.background = `radial-gradient(circle, ${sys.sunColor}, ${darken(sys.sunColor, 20)})`;
  sun.style.boxShadow = `0 0 40px ${rgba(sys.sunColor,0.4)}`;
  sun.style.border = `1px solid ${rgba(sys.outlineColor,0.6)}`;
  sun.style.zIndex = 5;
  sun.textContent = sys.name;
  sun.addEventListener('click', () => { renderEditorForSun(sys); currentSelection = {type:'sun', id: sys.id}; highlightSelection(currentSelection); });
  space.appendChild(sun);

  // Render planets
  sys.planets.forEach(p=>{
    const el = document.createElement('div');
    el.className = `body planet shape-${p.shape || 'circle'}`;
    el.dataset.id = p.id;
    const sizePx = calculateSize(p.sizePercent);
    el.style.width = el.style.height = sizePx+'px';
    const center = { x: space.clientWidth/2, y: space.clientHeight/2 };
    const left = center.x + (p.x||0) - sizePx/2, top = center.y + (p.y||0) - sizePx/2;
    el.style.left = left+'px'; el.style.top = top+'px';
    el.style.background = `radial-gradient(circle, ${p.color}, ${darken(p.color,15)})`;
    el.textContent = p.name;
    el.style.opacity = (p.opacity === undefined) ? 1 : p.opacity;
    if(p.outlineThickness && p.outlineThickness>0) el.style.boxShadow = `0 0 0 ${p.outlineThickness}px ${rgba(p.outlineColor||'#000',0.6)}`;
    if(p.orbit && p.orbit.showRing){
      const ring = document.createElement('div');
      ring.className='orbit-ring';
      const rad = Math.max(120, p.orbit.radius);
      ring.style.width = ring.style.height = (rad*2) + 'px';
      ring.style.left = (center.x-rad)+'px';
      ring.style.top = (center.y-rad)+'px';
      space.appendChild(ring);
    }
    el.addEventListener('mousedown', (e) => {
      const sys = state.systems[state.current];
      if(!sys) return;
      if(state.linkMode && !state.editMode){
        // open url if present, otherwise open editor
        if(p.url) window.open(p.url, '_blank');
        else { renderEditorForPlanet(p); highlightSelection({type:'planet',id:p.id}); currentSelection={type:'planet',id:p.id}; }
        return;
      } else {
        renderEditorForPlanet(p);
        currentSelection = { type:'planet', id: p.id };
        highlightSelection(currentSelection);
        dragging = p;
        const rect = el.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        e.preventDefault();
      }
    });
    space.appendChild(el);
    elementCache.set(p.id, el);
  });

  if(currentSelection) highlightSelection(currentSelection);
}

function highlightSelection(sel){
  document.querySelectorAll('.planet.selected, .sun.selected').forEach(n=>n.classList.remove('selected'));
  if(!sel || sel.type==='none') return;
  if(sel.type==='sun'){
    const s = document.querySelector('.sun'); if(s) s.classList.add('selected');
  } else if(sel.type==='planet'){
    const p = document.querySelector(`.planet[data-id="${sel.id}"]`); if(p) p.classList.add('selected');
  }
}

function renderAll(){
  document.body.style.fontFamily = state.adv.font;
  renderTabs();
  renderSpace();
  renderEditorPlaceholderIfNeeded();
}

// Editor UI
function renderEditorForPlanet(p){
  currentSelection = { type:'planet', id:p.id };
  editorTitle.textContent = `Planet — ${p.name}`;
  editorModeLabel.textContent = state.linkMode ? 'Link Mode' : 'Edit Mode';
  editorBody.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className='section';
  wrap.innerHTML = `
    <label>Planet Name</label>
    <input id="fld-name" type="text" value="${escapeHtml(p.name)}" />
    <label>URL (optional)</label>
    <input id="fld-url" type="url" value="${escapeHtml(p.url)}" />
    <label>Size: <span id="lbl-size">${p.sizePercent}</span>%</label>
    <input id="fld-size" type="range" min="5" max="50" value="${p.sizePercent}" />
    <label>Color</label>
    <input id="fld-color" type="color" value="${colorToHex(p.color)}" />
    <div id="adv-hex-wrapper" style="display:${state.adv.showHex? 'block':'none'}; margin-top:8px">
      <label>Custom Hex (advanced)</label>
      <input id="fld-hex" type="text" placeholder="#rrggbb" value="${p.color || ''}" />
    </div>
    <label>Opacity</label>
    <input id="fld-opacity" type="range" min="0.1" max="1" step="0.05" value="${p.opacity||1}" />
    <label>Outline Thickness</label>
    <input id="fld-outline" type="range" min="0" max="20" value="${p.outlineThickness||0}" />
    <label>Outline Color</label>
    <input id="fld-outline-color" type="color" value="${p.outlineColor||'#111'}" />
    <label>Shape</label>
    <select id="fld-shape">
      <option value="circle">Circle</option>
      <option value="square">Square</option>
      <option value="diamond">Diamond</option>
      <option value="star">Star</option>
      <option value="triangle">Triangle</option>
      <option value="pentagon">Pentagon</option>
      <option value="hexagon">Hexagon</option>
    </select>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button id="btn-delete-planet" class="small" style="background:#2a1010;color:#ff9a9a">Delete</button>
      <button id="btn-toggle-orbit" class="small">${p.orbit && p.orbit.rotating ? 'Stop Orbit' : 'Start Orbit'}</button>
    </div>
    <div id="orbit-controls" style="margin-top:8px;display:${p.orbit ? 'block':'none'}">
      <label>Orbit Speed</label>
      <input id="fld-orbit-speed" type="range" min="0.01" max="2" step="0.01" value="${p.orbit ? p.orbit.speed : 0.3}" />
      <label><input id="fld-orbit-reverse" type="checkbox" ${p.orbit && p.orbit.reverse ? 'checked':''} /> Reverse Orbit</label>
      <label><input id="fld-orbit-showring" type="checkbox" ${p.orbit && p.orbit.showRing ? 'checked':''} /> Show Orbit Path</label>
    </div>
  `;
  editorBody.appendChild(wrap);
  document.getElementById('fld-shape').value = p.shape || 'circle';

  // bind
  document.getElementById('fld-name').addEventListener('input', e=>{ p.name = e.target.value; renderSpace(); save(); });
  document.getElementById('fld-url').addEventListener('input', e=>{ p.url = e.target.value; save(); });
  document.getElementById('fld-size').addEventListener('input', e=>{ p.sizePercent = parseInt(e.target.value); renderSpace(); save(); document.getElementById('lbl-size').textContent = p.sizePercent; });
  document.getElementById('fld-color').addEventListener('input', e=>{ p.color = e.target.value; renderSpace(); save(); });
  document.getElementById('fld-hex')?.addEventListener('input', e=>{ p.color = e.target.value; renderSpace(); save(); });
  document.getElementById('fld-opacity').addEventListener('input', e=>{ p.opacity = parseFloat(e.target.value); renderSpace(); save(); });
  document.getElementById('fld-outline').addEventListener('input', e=>{ p.outlineThickness = parseInt(e.target.value); renderSpace(); save(); });
  document.getElementById('fld-outline-color').addEventListener('input', e=>{ p.outlineColor = e.target.value; renderSpace(); save(); });
  document.getElementById('fld-shape').addEventListener('change', e=>{ p.shape = e.target.value; renderSpace(); save(); });
  document.getElementById('btn-delete-planet').addEventListener('click', async ()=>{
    const ok = await confirmDialog(`Delete planet "${p.name}"?`);
    if(ok){
      const sys = state.systems[state.current];
      sys.planets = sys.planets.filter(x=>x.id!==p.id);
      currentSelection = null;
      renderAll(); save(); toast('Planet deleted');
    }
  });
  document.getElementById('btn-toggle-orbit').addEventListener('click', ()=>{
    p.orbit = p.orbit || { radius: Math.hypot(p.x,p.y), angle: Math.atan2(p.y,p.x), speed: 0.3, rotating: true, reverse: false, showRing:false };
    p.orbit.rotating = !p.orbit.rotating;
    renderEditorForPlanet(p); renderSpace(); save();
  });
  document.getElementById('fld-orbit-speed')?.addEventListener('input', e=>{ p.orbit.speed = parseFloat(e.target.value); save(); });
  document.getElementById('fld-orbit-reverse')?.addEventListener('change', e=>{ p.orbit.reverse = e.target.checked; save(); });
  document.getElementById('fld-orbit-showring')?.addEventListener('change', e=>{ p.orbit.showRing = e.target.checked; renderSpace(); save(); });

  highlightSelection(currentSelection);
}

function renderEditorForSun(sys){
  currentSelection = { type:'sun', id:sys.id };
  editorTitle.textContent = `Sun / System — ${sys.name}`;
  editorModeLabel.textContent = 'Sun (always editable)';
  editorBody.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className='section';
  wrap.innerHTML = `
    <label>System Name</label>
    <input id="fld-sys-name" type="text" value="${escapeHtml(sys.name)}" />
    <label>Sun Color</label>
    <input id="fld-sun-color" type="color" value="${sys.sunColor||'#ffcc00'}" />
    <label>Outline Color</label>
    <input id="fld-sys-outline" type="color" value="${sys.outlineColor||'#111'}" />
    <label>Background Solid</label>
    <input id="fld-bg-solid" type="color" value="${sys.bgSolid||'#06102a'}" />
    <label>Background Gradient (optional)</label>
    <input id="fld-bg-grad" type="color" value="${sys.bgGradient||'#08122f'}" />
    <label>Background Angle</label>
    <input id="fld-bg-angle" type="range" min="0" max="360" value="${sys.bgAngle||120}" />
    <div style="display:flex;gap:8px;margin-top:8px">
      <button id="btn-auto-arrange" class="small">Auto-Arrange Planets</button>
      <button id="btn-duplicate-system" class="small">Duplicate System</button>
    </div>
  `;
  editorBody.appendChild(wrap);

  document.getElementById('fld-sys-name').addEventListener('input', e=>{ sys.name = e.target.value; renderAll(); save(); });
  document.getElementById('fld-sun-color').addEventListener('input', e=>{ sys.sunColor = e.target.value; renderAll(); save(); });
  document.getElementById('fld-sys-outline').addEventListener('input', e=>{ sys.outlineColor = e.target.value; renderAll(); save(); });
  document.getElementById('fld-bg-solid').addEventListener('input', e=>{ sys.bgSolid = e.target.value; renderSpace(); save(); });
  document.getElementById('fld-bg-grad').addEventListener('input', e=>{ sys.bgGradient = e.target.value; renderSpace(); save(); });
  document.getElementById('fld-bg-angle').addEventListener('input', e=>{ sys.bgAngle = parseInt(e.target.value); renderSpace(); save(); });
  document.getElementById('btn-auto-arrange').addEventListener('click', ()=>{ autoArrange(sys); renderSpace(); save(); toast('Auto-arranged'); });
  document.getElementById('btn-duplicate-system').addEventListener('click', ()=>{ duplicateSystem(sys.id); });

  highlightSelection(currentSelection);
}

function renderEditorPlaceholderIfNeeded(){
  if(!currentSelection || currentSelection.type==='none'){
    editorBody.innerHTML = '<div class="section">Select a planet or the sun to edit it.</div>';
    editorTitle.textContent='Editor';
  }
}

// Interaction: dragging
document.addEventListener('mousemove', (e)=>{
  if(dragging && state.editMode){
    const sys = state.systems[state.current];
    const el = elementCache.get(dragging.id);
    if(!el) return;
    const rect = space.getBoundingClientRect();
    let x = e.clientX - rect.left - dragOffset.x;
    let y = e.clientY - rect.top - dragOffset.y;
    x = clamp(x, 0, space.clientWidth - el.clientWidth);
    y = clamp(y, 0, space.clientHeight - el.clientHeight);
    el.style.left = x+'px'; el.style.top = y+'px';
    const cx = space.clientWidth/2, cy = space.clientHeight/2;
    const size = el.clientWidth;
    dragging.x = (x + size/2) - cx;
    dragging.y = (y + size/2) - cy;
    if(dragging.orbit){ dragging.orbit.radius = Math.hypot(dragging.x, dragging.y); dragging.orbit.angle = Math.atan2(dragging.y, dragging.x); }
    save();
  }
});
document.addEventListener('mouseup', ()=>{ if(dragging){ dragging=null; save(); } });

// Removed dblclick planet creation per request

// Animation loop
function animate(time){
  if (!lastTick) lastTick = time;
  const dt = Math.min((time - lastTick)/1000, 0.1);
  lastTick = time;
  const sys = state.systems[state.current];
  if(sys){
    const center = { x: space.clientWidth/2, y: space.clientHeight/2 };
    sys.planets.forEach(p=>{
      if(p.orbit && p.orbit.rotating){
        const dir = p.orbit.reverse ? -1 : 1;
        const speed = (p.orbit.speed || 0.2) * (state.adv.speedMult || 1);
        p.orbit.angle += dir * speed * dt;
        p.x = Math.cos(p.orbit.angle) * p.orbit.radius;
        p.y = Math.sin(p.orbit.angle) * p.orbit.radius;
      }
      const el = elementCache.get(p.id) || document.querySelector(`.planet[data-id="${p.id}"]`);
      if(el){
        const size = el.clientWidth;
        el.style.left = (center.x + p.x - size/2) + 'px';
        el.style.top = (center.y + p.y - size/2) + 'px';
        if(p.spin && p.spin.enabled){
          const rot = (time/1000) * p.spin.speed * 360;
          el.style.transform = `rotate(${rot}deg)`;
        } else {
          el.style.transform = '';
        }
        el.style.opacity = p.opacity===undefined?1:p.opacity;
        elementCache.set(p.id, el);
      }
    });
  }
  rafId = requestAnimationFrame(animate);
}

// System actions
function createNewSystem(){
  const id = uid();
  const sys = makeSystem(`System ${Object.keys(state.systems).length+1}`, colorToHex(randomBackgroundColor()));
  sys.bgSolid = colorToHex(randomBackgroundColor());
  sys.bgGradient = colorToHex(randomBackgroundColor());
  sys.bgAngle = randInt(0,360);
  state.systems[id] = sys;
  state.current = id;
  renderAll(); save(); toast('New system created');
}

function duplicateSystem(id){
  if(!state.systems[id]) return;
  const copy = JSON.parse(JSON.stringify(state.systems[id]));
  copy.id = uid(); copy.name = `${copy.name} (copy)`; copy.planets = (copy.planets||[]).map(p=> ({...p, id: uid()}));
  state.systems[copy.id] = copy; state.current = copy.id; renderAll(); save(); toast('System duplicated');
}

function repairSystems(){
  Object.keys(state.systems).forEach(id => { if(!state.systems[id] || typeof state.systems[id] !== 'object') delete state.systems[id]; });
  if(!state.current || !state.systems[state.current]) state.current = Object.keys(state.systems)[0] || null;
  const valid = {};
  Object.entries(state.systems).forEach(([id,sys]) => { if(sys && sys.id){ sys.id = id; valid[id]=sys; } });
  state.systems = valid;
  save(); toast('Systems repaired'); renderAll();
}

// Helpers
function linearBgForCurrent(){
  const sys = state.systems[state.current];
  if(!sys) return '';
  return `linear-gradient(${sys.bgAngle}deg, ${sys.bgSolid}, ${sys.bgGradient || sys.bgSolid})`;
}
function calculateSize(percent){
  const vw = Math.min(space.clientWidth, space.clientHeight);
  return Math.max(12, Math.round(vw*(percent/100)));
}
function findNonOverlapping(sys, sizePx){
  if (!sys) return { x: 200, y: 0 };
  const existing = sys.planets || [];
  let radius = 140;
  const maxAttempts = 800;
  for(let attempt=0; attempt<maxAttempts; attempt++){
    const angle = Math.random() * Math.PI * 2;
    const jitter = Math.random() * 30 - 15;
    const x = Math.cos(angle) * radius + jitter;
    const y = Math.sin(angle) * radius + jitter;
    let overlap=false;
    for(const other of existing){
      const otherSizePx = calculateSize(other.sizePercent || 18);
      const minDist = (sizePx + otherSizePx) / 2 + 8;
      const dist = Math.hypot(x - (other.x || 0), y - (other.y || 0));
      if(dist < minDist){ overlap=true; break; }
    }
    if(!overlap) return { x, y };
    if(attempt % 30 === 0) radius += 40;
  }
  return { x: radius, y: 0 };
}

function randomBackgroundColor(){ return `hsl(${randInt(200,350)} ${randInt(30,60)}% ${randInt(10,20)}%)`; }

// Planet creation from top button
function createPlanetInCurrent(){
  if(!state.current || !state.systems[state.current]) { toast('No system selected — creating a new one first'); createNewSystem(); }
  const sys = state.systems[state.current];
  if(!sys.planets) sys.planets=[];
  const size = 18;
  const sizePx = calculateSize(size);
  const pos = findNonOverlapping(sys, sizePx);
  const p = makePlanet('New Planet','',pos.x,pos.y,size,colorToHex(randomColorHsl()),'circle',2,'#111');
  sys.planets.push(p);
  renderAll(); save(); toast('Planet created');
}

// Auto-arrange
function autoArrange(sys){
  const count = sys.planets.length;
  if(!count) return;
  const base = 180, gap = 70;
  sys.planets.forEach((p,i)=>{
    const ring = Math.floor(i/8);
    const spacing = 2*Math.PI/(Math.min(8,count));
    const angle = (i * spacing) + (ring * 0.3);
    const radius = base + ring*gap + (Math.random()*30);
    p.orbit = p.orbit || { radius, angle, speed: 0.2, rotating: !state.adv.disableOrbits, reverse:false, showRing:false };
    p.orbit.radius = radius; p.orbit.angle = angle;
    p.x = Math.cos(angle)*radius; p.y = Math.sin(angle)*radius;
  });
}

// Export / Import (keeps structure)
function exportSystems(){
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `solar-systems-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); toast('Systems exported'); },100);
}

function importSystems(){
  const input = document.createElement('input');
  input.type='file';
  input.accept='.json';
  input.onchange = e=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ev=>{
      try{
        const imported = JSON.parse(ev.target.result);
        if(!imported || !imported.systems) throw new Error('Invalid file format');
        // Merge safely: prefer imported.systems but keep adv/defaults for missing fields
        const merged = migrateLoaded(imported);
        // keep existing metadata? We will replace state with merged to ensure structural compatibility
        state = merged;
        state.current = state.current || Object.keys(state.systems)[0];
        renderAll(); save(); toast('Systems imported');
      }catch(err){ console.error('Import failed',err); toast('Import failed - invalid file','error'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

// Confirm dialog (centered overlay)
function confirmDialog(text){
  return new Promise(res=>{
    confirmText.textContent = text;
    overlay.classList.remove('hidden');
    confirmModal.classList.remove('hidden');
    confirmResolve = res;
  });
}
confirmCancel.addEventListener('click', ()=>{ overlay.classList.add('hidden'); confirmModal.classList.add('hidden'); if(confirmResolve) confirmResolve(false); confirmResolve = null; });
confirmOk.addEventListener('click', ()=>{ overlay.classList.add('hidden'); confirmModal.classList.add('hidden'); if(confirmResolve) confirmResolve(true); confirmResolve = null; });

// About & HowTo modals
aboutFab.addEventListener('click', ()=>{ overlay.classList.remove('hidden'); aboutModal.classList.remove('hidden'); });
aboutClose.addEventListener('click', ()=>{ overlay.classList.add('hidden'); aboutModal.classList.add('hidden'); });

howtoBtn.addEventListener('click', ()=>{ overlay.classList.remove('hidden'); howtoModal.classList.remove('hidden'); });
howtoClose.addEventListener('click', ()=>{ overlay.classList.add('hidden'); howtoModal.classList.add('hidden'); });

// settings panel and buttons (keeps original IDs where possible)
document.getElementById('btn-settings').addEventListener('click', ()=>{ 
  const settingsModal = document.getElementById('settings-modal') || createSettingsModal();
  settingsModal.style.display = 'block';
  document.getElementById('adv-show-hex').checked = state.adv.showHex;
  document.getElementById('adv-speed-mult').value = state.adv.speedMult || 1;
  document.getElementById('adv-font').value = state.adv.font || 'Inter,system-ui,Arial';
  document.getElementById('settings-party').checked = !!state.adv.partyGlobal;
  document.getElementById('adv-disable-orbits').checked = !!state.adv.disableOrbits;
});

// create settings modal if not present (moved from inline in original)
function createSettingsModal(){
  const modal = document.createElement('div');
  modal.id = 'settings-modal';
  modal.style.cssText = 'display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10001;background:#0b0b12;padding:16px;border-radius:10px;border:1px solid rgba(255,255,255,0.04)';
  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="font-weight:700;color:var(--accent)">Settings</div>
      <button id="settings-close" class="small">Close</button>
    </div>
    <div style="margin-top:10px">
      <div style="display:flex;gap:8px;align-items:center">
        <label style="margin:0">Global Party Mode</label>
        <input id="settings-party" type="checkbox" />
      </div>
      <div class="section" style="margin-top:10px">
        <div style="font-weight:700">Advanced</div>
        <div style="margin-top:8px">
          <label style="margin:0">Show hex color inputs</label>
          <input type="checkbox" id="adv-show-hex" />
        </div>
        <div style="margin-top:8px">
          <label style="margin:0">Global Orbit Speed Multiplier</label>
          <input type="range" id="adv-speed-mult" min="0.1" max="3" step="0.1" value="1" />
        </div>
        <div style="margin-top:8px">
          <label style="margin:0">Default font</label>
          <select id="adv-font">
            <option value="Inter,system-ui,Arial">Inter (default)</option>
            <option value="Georgia,serif">Georgia</option>
            <option value="'Comic Sans MS',cursive">Comic Sans</option>
            <option value="'Courier New',monospace">Courier</option>
          </select>
        </div>
        <div style="margin-top:8px">
          <label style="margin:0">Disable Orbits by Default</label>
          <input type="checkbox" id="adv-disable-orbits" checked />
        </div>
      </div>
      <div class="section" style="margin-top:10px">
        <div style="font-weight:700">Data</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button id="btn-export" class="small">Export Systems</button>
          <button id="btn-import" class="small">Import Systems</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('settings-close').addEventListener('click', ()=>modal.style.display='none');
  document.getElementById('settings-party').addEventListener('change', e=>{ state.adv.partyGlobal = e.target.checked; renderAll(); save(); });
  document.getElementById('adv-show-hex').addEventListener('change', e=>{ state.adv.showHex = e.target.checked; save(); renderAll(); });
  document.getElementById('adv-speed-mult').addEventListener('input', e=>{ state.adv.speedMult = parseFloat(e.target.value); save(); });
  document.getElementById('adv-font').addEventListener('change', e=>{ state.adv.font = e.target.value; document.body.style.fontFamily = e.target.value; save(); renderAll(); });
  document.getElementById('adv-disable-orbits').addEventListener('change', e=>{ state.adv.disableOrbits = e.target.checked; if(state.adv.disableOrbits){ const sys = state.systems[state.current]; if(sys && sys.planets) sys.planets.forEach(p=>{ if(p.orbit) p.orbit.rotating=false; }); } save(); renderAll(); });
  document.getElementById('btn-export').addEventListener('click', exportSystems);
  document.getElementById('btn-import').addEventListener('click', importSystems);
  return modal;
}

// Event wiring for UI controls
document.getElementById('btn-create-planet-top').addEventListener('click', createPlanetInCurrent);
document.getElementById('btn-toggle-editor').addEventListener('click', (e)=>{
  if(editor.classList.contains('collapsed')){ editor.classList.remove('collapsed'); e.target.textContent='Hide'; }
  else { editor.classList.add('collapsed'); e.target.textContent='Show'; }
});
document.getElementById('btn-mode-toggle').addEventListener('click', (e)=>{ state.editMode = !state.editMode; state.linkMode = !state.editMode; e.target.textContent = state.editMode ? 'Switch to Link' : 'Switch to Edit'; editorModeLabel.textContent = state.editMode ? 'Edit Mode' : 'Link Mode'; save(); });

// Export/import wiring ensures compatibility with migrated structures

// Initialize load & render
load();
document.getElementById('overlay').classList.add('hidden');
document.getElementById('confirm-modal').classList.add('hidden');
document.getElementById('settings-modal')?.style && (document.getElementById('settings-modal').style.display = 'none');

currentSelection = null;
renderAll();
toast('Systems Loaded');
rafId = requestAnimationFrame(animate);

// cleanup
window.addEventListener('beforeunload', ()=>{
  cancelAnimationFrame(rafId);
  save();
});
window.addEventListener('resize', ()=>{ renderAll(); });



// --- Added: normalize outline defaults & adv defaults ---
(function ensureDefaults(){
  try {
    if(!state.adv) state.adv = {};
    if(typeof state.adv.disableOrbits === 'undefined') state.adv.disableOrbits = true;
    if(typeof state.adv.lockLayout === 'undefined') state.adv.lockLayout = false;
    if(!state.adv.keybinds) state.adv.keybinds = { modifier: 'ctrl', undo: 'z', redo: 'y' };
    Object.values(state.systems||{}).forEach(sys => {
      (sys.planets||[]).forEach(p => {
        if(p.outlineThickness === undefined || p.outlineThickness === null) p.outlineThickness = 0;
        if(!p.outlineColor) p.outlineColor = '#ffffff';
        if(p.orbit && typeof p.orbit.rotating === 'undefined') p.orbit.rotating = !state.adv.disableOrbits;
      });
    });
  } catch(e){ /* noop */ }
})();




// === Enhancements: Undo/Redo, Keybinds, Font Auto-Scale, Draggable Tabs, Lock Layout ===

// History stacks
let __history = [];
let __future = [];
let __suppressHistory = false;
const __HIST_MAX = 50;

function __snapshot(label=''){
  if(__suppressHistory) return;
  try{
    const snap = JSON.stringify({ systems: state.systems, current: state.current, adv: state.adv });
    if(__history.length && __history[__history.length-1] === snap) return;
    __history.push(snap);
    if(__history.length > __HIST_MAX) __history.shift();
    __future.length = 0;
  }catch(e){ /* ignore */ }
}

// Wrap original save()
(function(){
  const __origSave = save;
  window.save = function(){
    __origSave();
    __snapshot('save');
  };
})();

function performUndo(){
  if(!__history.length) { toast && toast('Nothing to undo'); return; }
  // current state to future
  try{
    const current = JSON.stringify({ systems: state.systems, current: state.current, adv: state.adv });
    __future.push(current);
    const prev = __history.pop();
    if(prev){
      __suppressHistory = true;
      const parsed = JSON.parse(prev);
      state.systems = parsed.systems || {};
      state.current = parsed.current || Object.keys(state.systems)[0] || null;
      state.adv = Object.assign({}, state.adv, parsed.adv || {});
      renderAll();
      __suppressHistory = false;
      save(); // will snapshot but suppressed
      toast && toast('Undone');
    }
  }catch(e){ __suppressHistory=false; }
}

function performRedo(){
  if(!__future.length) { toast && toast('Nothing to redo'); return; }
  try{
    const next = __future.pop();
    if(next){
      __suppressHistory = true;
      const parsed = JSON.parse(next);
      state.systems = parsed.systems || {};
      state.current = parsed.current || Object.keys(state.systems)[0] || null;
      state.adv = Object.assign({}, state.adv, parsed.adv || {});
      renderAll();
      __suppressHistory = false;
      save();
      toast && toast('Redone');
    }
  }catch(e){ __suppressHistory=false; }
}

// Keyboard shortcuts
(function(){
  function matches(e, key){
    const mod = (state.adv.keybinds && state.adv.keybinds.modifier) || 'ctrl';
    const wantCtrl = mod === 'ctrl';
    const wantMeta = mod === 'meta';
    const wantAlt = mod === 'alt';
    if(wantCtrl && !e.ctrlKey) return false;
    if(wantMeta && !e.metaKey) return false;
    if(wantAlt && !e.altKey) return false;
    return e.key.toLowerCase() === key.toLowerCase();
  }
  document.addEventListener('keydown', (e)=>{
    if(matches(e, (state.adv.keybinds && state.adv.keybinds.undo) || 'z')){
      e.preventDefault(); performUndo();
    } else if(matches(e, (state.adv.keybinds && state.adv.keybinds.redo) || 'y')){
      e.preventDefault(); performRedo();
    }
  });
})();

// Auto font scaling for planets/sun based on viewport
function updateFontScaling(){
  try{
    const w = space.clientWidth || window.innerWidth;
    const h = space.clientHeight || window.innerHeight;
    const base = Math.min(w, h);
    // clamp 12px .. 28px
    const px = Math.max(12, Math.min(28, Math.round(base * 0.02)));
    document.documentElement.style.setProperty('--planet-font-size', px + 'px');
  }catch(e){}
}
window.addEventListener('resize', updateFontScaling);
const __origRenderAll = renderAll;
window.renderAll = function(){
  __origRenderAll();
  updateFontScaling();
  document.body.classList.toggle('locked-layout', !!(state.adv && state.adv.lockLayout));
};
updateFontScaling();

// Draggable tabs (reorder systems)
(function enableTabDrag(){
  const list = document.getElementById('tab-list');
  if(!list) return;
  function onDragStart(e){
    const tab = e.target.closest('.tab');
    if(!tab) return;
    e.dataTransfer.setData('text/plain', tab.dataset.id || '');
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e){
    const over = e.target.closest('.tab');
    if(over){ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  }
  function reorder(ids){
    // rebuild state.systems preserving new order
    const newObj = {};
    ids.forEach(id => { if(state.systems[id]) newObj[id] = state.systems[id]; });
    // append any missing (safety)
    Object.keys(state.systems).forEach(id => { if(!newObj[id]) newObj[id] = state.systems[id]; });
    state.systems = newObj;
    renderAll(); save();
  }
  function onDrop(e){
    const fromId = e.dataTransfer.getData('text/plain');
    const over = e.target.closest('.tab');
    if(!fromId || !over) return;
    const toId = over.dataset.id;
    if(!toId || fromId === toId) return;
    const ids = Array.from(list.querySelectorAll('.tab')).map(t=>t.dataset.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    ids.splice(toIdx, 0, ids.splice(fromIdx,1)[0]);
    reorder(ids);
  }
  // Delegate events
  list.addEventListener('dragstart', onDragStart);
  list.addEventListener('dragover', onDragOver);
  list.addEventListener('drop', onDrop);
  // Make tabs draggable after each render
  const __origRenderTabs = renderTabs;
  window.renderTabs = function(){
    __origRenderTabs();
    list.querySelectorAll('.tab').forEach(t=> t.setAttribute('draggable','true'));
  };
})();

// Lock layout: prevent dragging in edit mode when locked
(function(){
  let warned = false;
  document.addEventListener('mousemove', (e)=>{
    if(state.adv && state.adv.lockLayout && state.editMode && window.dragging){
      // ignore movement; optionally warn once
      if(!warned){ toast && toast('Layout is locked'); warned = true; setTimeout(()=>warned=false, 800); }
    }
  }, true);
})();

// Settings modal: inject Keybinds section
(function(){
  const __origCreate = window.createSettingsModal;
  window.createSettingsModal = function(){
    const modal = __origCreate();
    try{
      // Build Keybinds section
      const section = document.createElement('div');
      section.className = 'section';
      section.innerHTML = `
        <div style="font-weight:700">Keybinds</div>
        <div class="muted" style="margin:6px 0 8px 0">Customize Undo/Redo shortcuts.</div>
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap">
          <label style="margin:0">Modifier</label>
          <select id="kb-mod">
            <option value="ctrl">Ctrl</option>
            <option value="meta">Cmd</option>
            <option value="alt">Alt</option>
          </select>
          <label style="margin-left:10px; margin-right:0">Undo</label>
          <input id="kb-undo" type="text" value="" style="width:60px;text-transform:uppercase" maxlength="1" />
          <label style="margin-left:10px; margin-right:0">Redo</label>
          <input id="kb-redo" type="text" value="" style="width:60px;text-transform:uppercase" maxlength="1" />
          <button id="kb-reset" class="small" style="margin-left:10px">Reset</button>
        </div>
      `;
      modal.appendChild(section);
      const kb = (state.adv && state.adv.keybinds) || { modifier:'ctrl', undo:'z', redo:'y' };
      modal.querySelector('#kb-mod').value = kb.modifier || 'ctrl';
      modal.querySelector('#kb-undo').value = (kb.undo || 'z').toUpperCase();
      modal.querySelector('#kb-redo').value = (kb.redo || 'y').toUpperCase();
      modal.querySelector('#kb-mod').addEventListener('change', e=>{ state.adv.keybinds.modifier = e.target.value; save(); });
      modal.querySelector('#kb-undo').addEventListener('input', e=>{ const v = (e.target.value||'z').trim().slice(0,1); e.target.value = v.toUpperCase(); state.adv.keybinds.undo = v.toLowerCase() || 'z'; save(); });
      modal.querySelector('#kb-redo').addEventListener('input', e=>{ const v = (e.target.value||'y').trim().slice(0,1); e.target.value = v.toUpperCase(); state.adv.keybinds.redo = v.toLowerCase() || 'y'; save(); });
      modal.querySelector('#kb-reset').addEventListener('click', ()=>{ state.adv.keybinds = { modifier:'ctrl', undo:'z', redo:'y' }; save(); document.getElementById('kb-mod').value='ctrl'; document.getElementById('kb-undo').value='Z'; document.getElementById('kb-redo').value='Y'; });
    }catch(e){ /* ignore */ }
    return modal;
  };
})();

// Startup UI synchronization to avoid mode label inversion after refresh
(function syncModeUI(){
  try{
    const btn = document.getElementById('btn-mode-toggle');
    const label = document.getElementById('editor-mode');
    if(btn){ btn.textContent = state.editMode ? 'Switch to Link' : 'Switch to Edit'; }
    if(label){ label.textContent = state.linkMode ? 'Link Mode' : 'Edit Mode'; }
  }catch(e){}
})();

// Seed an initial history snapshot after first load/render
setTimeout(()=>{ __snapshot('init'); }, 0);

