'use strict';
/* ============================================================
   Extras: backtest, curva de bonos, alertas, noticias y sincronización.
   Usa funciones y estado definidos en app.js y cartera.js.
   ============================================================ */

/* ---------------- Gráfico de líneas simple (curvas de backtest) ---------------- */
function lineChart(cv, series, opts = {}) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const padL = 6, padR = 58, top = 8, bot = 20, pw = W - padL - padR, ph = H - top - bot;
  const all = series.flatMap(s => s.y).filter(v => v > 0);
  if (!all.length) return;
  const lo = Math.log(Math.min(...all)), hi = Math.log(Math.max(...all));
  const n = series[0].y.length;
  const X = i => padL + (n === 1 ? 0 : i / (n - 1) * pw), Y = v => top + (1 - (Math.log(v) - lo) / ((hi - lo) || 1)) * ph;
  g.font = '11px Segoe UI, sans-serif'; g.fillStyle = '#8b98a8'; g.strokeStyle = '#273243';
  for (let k = 0; k <= 3; k++) {
    const v = Math.exp(lo + (hi - lo) * k / 3), yy = Y(v);
    g.beginPath(); g.moveTo(padL, yy); g.lineTo(padL + pw, yy); g.stroke();
    g.textBaseline = 'middle'; g.fillText((v >= 1 ? '+' : '') + ((v - 1) * 100).toFixed(0) + '%', padL + pw + 6, yy);
  }
  g.textBaseline = 'top';
  [0, Math.floor(n / 2), n - 1].forEach(i => { const t = opts.labels[i]; const tw = g.measureText(t).width; g.fillText(t, Math.min(Math.max(padL, X(i) - tw / 2), padL + pw - tw), H - bot + 4); });
  series.forEach(s => {
    g.strokeStyle = s.color; g.lineWidth = 1.6; g.beginPath();
    s.y.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)));
    g.stroke();
  });
}

/* ---------------- Backtest en el detalle de un activo ---------------- */
function renderBacktest(a, desde) {
  const box = $('#btBox');
  if (!box || !a) return;
  const n = a.rows.length;
  const idx = desde === 'todo' ? 0 : Math.max(0, n - 1 - { '3a': 756, '5a': 1260 }[desde]);
  const r = backtest(a, S.params, idx);
  if (!r) { box.innerHTML = '<p class="muted">No hay historia suficiente para el backtest.</p>'; return; }
  const kv = (k, v, sub) => `<div class="kv"><div class="k">${k}</div><div class="v">${v}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;
  const gana = r.cagr > r.cagrBh, menosRiesgo = r.mdd > r.mddBh;
  box.innerHTML = `
    <div class="chartbox"><div class="ctrl">
      ${['3a', '5a', 'todo'].map(x => `<button data-bt="${x}" class="${x === desde ? 'on' : ''}">${x === 'todo' ? 'Toda la historia' : 'Últimos ' + x.replace('a', ' años')}</button>`).join('')}
      <span class="legend"><span><i style="background:#4ea1ff"></i>Estrategia</span><span><i style="background:#8b98a8"></i>Comprar y mantener</span></span></div>
      <canvas id="btChart" style="width:100%;height:200px;display:block"></canvas></div>
    <div class="plan">
      ${kv('Estrategia', `<span class="${cls(r.cagr)}">${pct(r.cagr)}</span>`, 'anual')}
      ${kv('Comprar y mantener', `<span class="${cls(r.cagrBh)}">${pct(r.cagrBh)}</span>`, 'anual')}
      ${kv('Peor caída estrategia', `<span class="down">${pct(r.mdd, 0)}</span>`, `vs ${pct(r.mddBh, 0)} manteniendo`)}
      ${kv('Operaciones', r.trades, ok(r.win) ? `${pct(r.win, 0, false)} ganadoras` : '')}
      ${kv('Tiempo invertido', pct(r.tiempo, 0, false), r.abierta ? 'hoy: comprado' : 'hoy: afuera')}
    </div>
    <p class="note">Desde ${r.desde} (${fmt(r.years, 1)} años), en ${a.cur === 'USD' ? 'dólares' : 'pesos'}, con comisión de ${fmt(S.params.comision, 2)}% por operación${S.params.btStop === 'si' ? ' y stop móvil' : ', saliendo solo por señal'}.
      ${gana ? 'La estrategia le ganó a comprar y mantener' : 'Comprar y mantener rindió más'}${menosRiesgo ? ' y la estrategia tuvo caídas más chicas.' : '.'}
      El objetivo principal de la estrategia es evitar las caídas grandes; en activos con subas sostenidas suele rendir menos que mantener.
      Resultados pasados no garantizan resultados futuros.</p>`;
  lineChart($('#btChart'), [
    { y: r.curve.map(p => p.b), color: '#8b98a8' },
    { y: r.curve.map(p => p.s), color: '#4ea1ff' },
  ], { labels: r.curve.map(p => p.d) });
}

$('#detail').addEventListener('click', e => {
  if (e.target.id === 'btnBacktest' && curDetail) renderBacktest(curDetail, '5a');
  const b = e.target.closest('[data-bt]');
  if (b && curDetail) renderBacktest(curDetail, b.dataset.bt);
});

/* ---------------- Backtest general (pestaña Estrategia) ---------------- */
function setupStrategyBacktest() {
  const sec = $('#viewStrategy');
  const div = document.createElement('div');
  div.innerHTML = `
    <h2>¿Funciona la estrategia? Backtest general</h2>
    <p>Prueba las señales sobre las acciones del panel líder y los 30 CEDEARs más operados, en los últimos 5 años,
      y lo compara con comprar y mantener. Usa los parámetros actuales (podés cambiarlos y volver a probar).</p>
    <button id="btnBtAll" class="primary">Correr backtest general</button>
    <div id="btAllOut"></div>`;
  sec.insertBefore(div, sec.querySelector('.disclaimer'));
  $('#btnBtAll').addEventListener('click', runBacktestAll);
}

async function runBacktestAll() {
  const out = $('#btAllOut');
  out.innerHTML = '<p class="muted">Cargando y analizando instrumentos…</p>';
  await Promise.all([loadLive('acciones'), loadLive('cedears')]);
  const ced = (S.live.cedears || []).filter(r => !r.variant && r.v > 0).sort((a, b) => b.monto - a.monto).slice(0, 30);
  const lid = (S.live.acciones || []).filter(r => LIDER.has(r.sym));
  const rows = [...lid, ...ced];
  await analyzeMany(rows.filter(r => !S.an[r.tab + ':' + r.sym]));
  const res = [];
  for (const r of rows) {
    const a = S.an[r.tab + ':' + r.sym];
    if (!a || a.err || !a.rows) continue;
    const b = backtest(a, S.params, Math.max(0, a.rows.length - 1 - 1260));
    if (b && b.years > 2) res.push({ r, b });
  }
  if (!res.length) { out.innerHTML = '<p class="muted">No hubo instrumentos con historia suficiente.</p>'; return; }
  const avg = f => res.reduce((s, x) => s + f(x.b), 0) / res.length;
  const ganan = res.filter(x => x.b.cagr > x.b.cagrBh).length;
  const menosCaida = res.filter(x => x.b.mdd > x.b.mddBh).length;
  const ratio = (c, d) => d < 0 ? c / -d : null;
  res.sort((a, b) => (b.b.cagr - b.b.cagrBh) - (a.b.cagr - a.b.cagrBh));
  out.innerHTML = `
    <div class="plan" style="margin-top:12px">
      <div class="kv"><div class="k">Rinde promedio estrategia</div><div class="v ${cls(avg(b => b.cagr))}">${pct(avg(b => b.cagr))} <small>anual</small></div></div>
      <div class="kv"><div class="k">Comprar y mantener</div><div class="v ${cls(avg(b => b.cagrBh))}">${pct(avg(b => b.cagrBh))} <small>anual</small></div></div>
      <div class="kv"><div class="k">Peor caída promedio</div><div class="v">${pct(avg(b => b.mdd), 0)} <small>vs ${pct(avg(b => b.mddBh), 0)}</small></div></div>
      <div class="kv"><div class="k">Le ganó a mantener</div><div class="v">${ganan} de ${res.length}</div></div>
      <div class="kv"><div class="k">Con menos caída</div><div class="v">${menosCaida} de ${res.length}</div></div>
      <div class="kv"><div class="k">Retorno / caída</div><div class="v">${fmt(ratio(avg(b => b.cagr), avg(b => b.mdd)), 2)} <small>vs ${fmt(ratio(avg(b => b.cagrBh), avg(b => b.mddBh)), 2)}</small></div></div>
    </div>
    <table class="simple" style="font-size:13px">
      <tr><th>Activo</th><th>Estrategia</th><th>Mantener</th><th>Diferencia</th><th>Caída estrategia</th><th>Caída mantener</th><th>Operaciones</th></tr>
      ${res.map(x => `<tr><td><b>${x.r.sym}</b> <span class="muted">${TAB_LABEL[x.r.tab]}</span></td>
        <td class="${cls(x.b.cagr)}">${pct(x.b.cagr)}</td><td class="${cls(x.b.cagrBh)}">${pct(x.b.cagrBh)}</td>
        <td class="${cls(x.b.cagr - x.b.cagrBh)}">${pct(x.b.cagr - x.b.cagrBh)}</td>
        <td>${pct(x.b.mdd, 0)}</td><td>${pct(x.b.mddBh, 0)}</td><td>${x.b.trades}</td></tr>`).join('')}
    </table>
    <p class="note">Rendimientos anuales en dólares (CCL) de los últimos 5 años. CEDEARs incluyen dividendos; acciones argentinas, solo precio.
      Simplificaciones: se opera al cierre del día de la señal y el tiempo fuera del mercado no rinde interés.</p>`;
}

/* ============================================================
   Curva de bonos: TIR vs duration y "barato / caro" respecto de sus pares
   ============================================================ */
let curveCache = null, curveGroup = 'sob';
const CURVE_GROUPS = {
  sob: { label: 'Soberanos US$', tab: 'bonos' },
  pesos: { label: 'Pesos tasa fija', tab: 'bonos' },
  cer: { label: 'CER', tab: 'bonos' },
  ons: { label: 'ONs US$', tab: 'ons' },
};
function groupOf(r, B) {
  if (r.tab === 'ons') return B.kind === 'usd' ? 'ons' : null;
  if (B.kind === 'lecap') return 'pesos';
  if (B.kind === 'cer') return 'cer';
  if (B.kind === 'usd') {
    if (/^BP/.test(r.sym)) return null; // BOPREAL: se muestran pero no forman la curva
    return 'sob';
  }
  return null;
}
// Subgrupo para el ajuste: en soberanos se separa ley local (AL/AE/AO/AN) y ley NY (GD)
const subOf = (g, r) => g === 'sob' ? (/^GD/.test(r.sym) ? 'NY' : 'local') : 'all';

function fitLog(pts) {
  const xs = pts.map(p => Math.log(p.x)), ys = pts.map(p => p.y), n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  const b = sxx ? sxy / sxx : 0, a = my - b * mx;
  return x => a + b * Math.log(x);
}

function buildCurves() {
  const key = [S.liveTime, !!S.flujos, S.cer && S.cer.length, (S.live.ons || []).length].join('|');
  if (curveCache && curveCache.key === key) return curveCache;
  const pts = {};
  for (const tab of ['bonos', 'ons']) for (const r of (S.live[tab] || [])) {
    if (r.variant || !(r.v > 0)) continue;
    const B = bondInfo(r);
    if (!B || B.raro || !ok(B.md)) continue;
    const g = groupOf(r, B);
    if (!g) continue;
    (pts[g] = pts[g] || []).push({ r, B, x: Math.max(B.md, 0.03), y: B.tir, sub: subOf(g, r) });
  }
  const fits = {}, res = {};
  for (const [g, list] of Object.entries(pts)) {
    for (const sub of [...new Set(list.map(p => p.sub))]) {
      const L = list.filter(p => p.sub === sub);
      if (L.length < 3) continue;
      const f = fitLog(L);
      fits[g + ':' + sub] = { f, xs: L.map(p => p.x) };
      L.forEach(p => res[p.r.tab + ':' + p.r.sym] = (p.y - f(p.x)) * 10000);
    }
  }
  return (curveCache = { key, pts, fits, res });
}
function curveRes(r) {
  if (!r || (r.tab !== 'bonos' && r.tab !== 'ons')) return null;
  const c = buildCurves();
  const k = r.tab + ':' + (r.variant ? r.sym.slice(0, -1) + (r.tab === 'ons' ? 'O' : '') : r.sym);
  return c.res[k] ?? null;
}

function renderCurveBox() {
  let box = $('#curveBox');
  if (S.tab !== 'bonos' && S.tab !== 'ons') { if (box) box.hidden = true; return; }
  if (!box) {
    box = document.createElement('details');
    box.id = 'curveBox'; box.className = 'chartbox curvebox';
    box.open = store.get('curvaAbierta', true);
    box.addEventListener('toggle', () => { store.set('curvaAbierta', box.open); if (box.open) drawCurve(); });
    $('#summary').before(box);
  }
  box.hidden = false;
  if (S.tab === 'ons') curveGroup = 'ons'; else if (curveGroup === 'ons') curveGroup = 'sob';
  box.innerHTML = `<summary>Curva de rendimientos (TIR vs duration)</summary>
    <div class="ctrl">${Object.entries(CURVE_GROUPS).filter(([, v]) => v.tab === S.tab).map(([k, v]) => `<button data-cg="${k}" class="${k === curveGroup ? 'on' : ''}">${v.label}</button>`).join('')}
      <span class="legend" id="curveLegend"></span></div>
    <canvas id="curveCv" style="width:100%;height:280px;display:block"></canvas>
    <p class="note" style="margin:6px 0 0">Cada punto es un bono; la línea es la curva ajustada de sus pares. Los que quedan <b>arriba</b> de la curva rinden más que bonos de plazo parecido
      (relativamente baratos); los de <b>abajo</b>, menos (caros). La columna "vs curva" muestra esa diferencia en puntos básicos (100 pb = 1%).</p>`;
  if (box.open) drawCurve();
}

function drawCurve() {
  const cv = $('#curveCv');
  if (!cv || !cv.clientWidth) return;
  const c = buildCurves(), pts = c.pts[curveGroup] || [];
  const extra = curveGroup === 'sob' ? (S.live.bonos || []).filter(r => !r.variant && /^BP[A-D][78]D$/.test(r.sym)).map(r => ({ r, B: bondInfo(r) })).filter(x => x.B && !x.B.raro)
    .map(x => ({ r: x.r, B: x.B, x: x.B.md, y: x.B.tir, sub: 'BOPREAL' })) : [];
  const all = pts.concat(extra);
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  g.font = '11px Segoe UI, sans-serif';
  if (all.length < 2) { g.fillStyle = '#8b98a8'; g.fillText('No hay suficientes bonos con TIR en este grupo.', 10, 20); return; }
  const padL = 44, padR = 14, top = 10, bot = 26, pw = W - padL - padR, ph = H - top - bot;
  const x0 = 0, x1 = Math.max(...all.map(p => p.x)) * 1.08;
  let y0 = Math.min(...all.map(p => p.y)), y1 = Math.max(...all.map(p => p.y));
  const pad = (y1 - y0) * 0.15 || 0.01; y0 -= pad; y1 += pad;
  const X = x => padL + (x - x0) / (x1 - x0) * pw, Y = y => top + (1 - (y - y0) / (y1 - y0)) * ph;
  g.strokeStyle = '#273243'; g.fillStyle = '#8b98a8';
  for (let k = 0; k <= 4; k++) {
    const y = y0 + (y1 - y0) * k / 4; g.beginPath(); g.moveTo(padL, Y(y)); g.lineTo(padL + pw, Y(y)); g.stroke();
    g.textBaseline = 'middle'; g.fillText((y * 100).toFixed(1) + '%', 4, Y(y));
  }
  g.textBaseline = 'top';
  for (let k = 0; k <= 5; k++) { const x = x0 + (x1 - x0) * k / 5; g.fillText(x.toFixed(1), X(x) - 8, H - bot + 6); }
  g.fillText('duration (años)', padL + pw - 80, H - 12);
  const COLORS = { local: '#4ea1ff', NY: '#2fbf71', all: '#4ea1ff', BOPREAL: '#e8b339' };
  // curvas ajustadas
  for (const [k, fit] of Object.entries(c.fits)) {
    const [grp, sub] = k.split(':');
    if (grp !== curveGroup) continue;
    g.strokeStyle = COLORS[sub]; g.globalAlpha = 0.6; g.lineWidth = 1.5; g.beginPath();
    const a = Math.min(...fit.xs), b = Math.max(...fit.xs);
    for (let i = 0; i <= 40; i++) { const x = a + (b - a) * i / 40, y = fit.f(x); i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)); }
    g.stroke(); g.globalAlpha = 1;
  }
  // puntos
  all.forEach(p => {
    g.fillStyle = COLORS[p.sub] || '#4ea1ff';
    g.beginPath(); g.arc(X(p.x), Y(p.y), 4, 0, 7); g.fill();
    g.fillStyle = '#e6edf3'; g.textBaseline = 'bottom';
    g.fillText(p.r.sym, X(p.x) + 5, Y(p.y) - 2);
  });
  const subs = [...new Set(all.map(p => p.sub))];
  $('#curveLegend').innerHTML = subs.map(s => `<span><i style="background:${COLORS[s]}"></i>${s === 'local' ? 'Ley local' : s === 'NY' ? 'Ley Nueva York' : s === 'all' ? CURVE_GROUPS[curveGroup].label : s}</span>`).join('');
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cg]');
  if (b) { curveGroup = b.dataset.cg; renderCurveBox(); }
});
window.addEventListener('resize', () => { if ($('#curveBox') && !$('#curveBox').hidden) drawCurve(); });

/* ============================================================
   Alertas: cambios de señal y stops perforados en tu cartera y favoritos
   ============================================================ */
S.alertas = store.get('alertas', []);
S.alertState = store.get('alertState', {});

function renderBell() {
  const unread = S.alertas.filter(a => !a.leida).length;
  $('#btnBell').innerHTML = `🔔${unread ? ` <span class="badge">${unread}</span>` : ''}`;
  const p = $('#alertPanel');
  if (p.hidden) return;
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  p.innerHTML = `
    <div class="ap-head"><b>Alertas</b><span>
      ${perm === 'default' ? '<button class="mini" id="btnNotif">Avisarme en el navegador</button>' : ''}
      <button class="mini" id="btnAlertRead">Marcar leídas</button> <button class="mini" id="btnAlertClear">Borrar</button></span></div>
    ${S.alertas.length ? S.alertas.slice().reverse().slice(0, 50).map(a => `<div class="ap-item ${a.leida ? '' : 'nueva'}" data-akey="${esc(a.key)}">
      <div>${esc(a.txt)}</div><small class="muted">${new Date(a.t).toLocaleString('es-AR')}</small></div>`).join('')
      : '<p class="muted" style="padding:10px">Sin alertas. Se generan cuando cambia la señal de un activo de tu cartera o favoritos, o cuando el precio perfora su stop móvil.</p>'}
    <p class="muted" style="padding:6px 10px;font-size:11px">${SNAP ? 'En la foto compartida se revisan al abrir la página.' : 'Con la página abierta se revisan solas cada 5 minutos en horario de mercado.'}</p>`;
}

function pushAlert(key, txt) {
  S.alertas.push({ t: Date.now(), key, txt, leida: false });
  if (S.alertas.length > 200) S.alertas = S.alertas.slice(-200);
  try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Panel AR', { body: txt }); } catch { }
}

async function checkAlerts() {
  const keys = [...new Set([...S.cartera.map(p => p.tab + ':' + p.sym), ...S.fav])].filter(k => !k.startsWith('ons:'));
  if (!keys.length) return;
  await Promise.all([...new Set(keys.map(k => k.split(':')[0]))].map(t => loadLive(t).catch(() => { })));
  const rows = keys.map(findRow).filter(Boolean);
  const missing = rows.filter(r => !S.an[r.tab + ':' + r.sym]);
  if (missing.length && !S.busy) await analyzeMany(missing);
  for (const r of rows) {
    const key = r.tab + ':' + r.sym, A = an(r);
    if (!A) continue;
    const st = S.alertState[key];
    let stop = A.stop;
    if (st && st.cur === A.cur) {
      if (st.signal !== A.signal) pushAlert(key, `${r.sym}: la señal pasó de ${st.signal} a ${A.signal} (puntaje ${A.score > 0 ? '+' : ''}${A.score}).`);
      if (ok(st.stop) && A.px < st.stop) pushAlert(key, `${r.sym} perforó su stop móvil (${money(st.stop, A.cur)}); precio ${money(A.px, A.cur)}.`);
      else if (ok(st.stop) && ok(A.stop)) stop = Math.max(st.stop, A.stop); // el stop solo sube
    }
    S.alertState[key] = { signal: A.signal, stop, cur: A.cur, t: Date.now() };
  }
  store.set('alertState', S.alertState);
  store.set('alertas', S.alertas);
  renderBell();
}

function setupAlerts() {
  const btn = document.createElement('button');
  btn.id = 'btnBell'; btn.title = 'Alertas';
  $('#btnParams').before(btn);
  const panel = document.createElement('div');
  panel.id = 'alertPanel'; panel.hidden = true;
  document.body.appendChild(panel);
  btn.addEventListener('click', () => { panel.hidden = !panel.hidden; renderBell(); });
  panel.addEventListener('click', async e => {
    if (e.target.id === 'btnNotif') { try { await Notification.requestPermission(); } catch { } renderBell(); }
    if (e.target.id === 'btnAlertRead') { S.alertas.forEach(a => a.leida = true); store.set('alertas', S.alertas); renderBell(); }
    if (e.target.id === 'btnAlertClear') { S.alertas = []; store.set('alertas', S.alertas); renderBell(); }
    const it = e.target.closest('[data-akey]');
    if (it) { panel.hidden = true; openDetail(it.dataset.akey); }
  });
  renderBell();
}

// Actualización automática (solo en la versión en vivo): cada 5 minutos en horario de mercado
function marketOpen() {
  const ar = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  const d = ar.getDay(), m = ar.getHours() * 60 + ar.getMinutes();
  return d >= 1 && d <= 5 && m >= 10 * 60 + 30 && m <= 17 * 60 + 15;
}
if (!SNAP) setInterval(() => { if (document.visibilityState === 'visible' && marketOpen()) refreshAll(); }, 5 * 60 * 1000);

/* ============================================================
   Noticias (titulares de RSS públicos, descargados por actualizar-noticias.js)
   ============================================================ */
S.noticias = null;
let newsRegion = store.get('newsRegion', 'todas');

async function loadNews() {
  try { S.noticias = await fetchJSON(SNAP ? 'noticias.json' : 'noticias.json?v=' + Date.now(), 15000); } catch { S.noticias = null; }
  renderNews();
}
const hace = t => {
  const m = Math.round((Date.now() - Date.parse(t)) / 60000);
  return m < 60 ? `hace ${Math.max(m, 1)} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : new Date(t).toLocaleDateString('es-AR');
};
function newsItem(n) {
  return `<a class="nw" href="${esc(n.link)}" target="_blank" rel="noopener">
    <span class="nw-t">${esc(n.t)}</span>
    <span class="nw-m">${esc(n.src)} · ${hace(n.fecha)}${n.tags && n.tags.length ? ' · ' + n.tags.slice(0, 3).map(t => `<b>${esc(t)}</b>`).join(' ') : ''}</span></a>`;
}
function renderNews() {
  const box = $('#newsBox');
  if (!box) return;
  const hidden = store.get('newsOculto', false);
  $('#viewTable').classList.toggle('with-news', !hidden);
  if (hidden) { box.innerHTML = '<button class="mini" id="newsShow">Mostrar noticias</button>'; return; }
  if (!S.noticias) { box.innerHTML = '<div class="nw-head"><b>Noticias</b></div><p class="muted">No hay noticias cargadas.</p>'; return; }
  const items = S.noticias.items.filter(n => newsRegion === 'todas' || n.region === newsRegion).slice(0, 40);
  box.innerHTML = `<div class="nw-head"><b>Noticias</b>
      <span>${[['todas', 'Todas'], ['AR', 'Argentina'], ['US', 'EE.UU.']].map(([k, l]) => `<button class="mini ${k === newsRegion ? 'on' : ''}" data-nr="${k}">${l}</button>`).join('')}
      <button class="mini" id="newsHide" title="Ocultar">✕</button></span></div>
    <div class="nw-list">${items.map(newsItem).join('')}</div>
    <p class="muted" style="font-size:11px">Titulares de ${esc([...new Set(S.noticias.items.map(n => n.src))].join(', '))}. Actualizado ${hace(S.noticias.actualizado)}.</p>`;
}
document.addEventListener('click', e => {
  const r = e.target.closest('[data-nr]');
  if (r) { newsRegion = r.dataset.nr; store.set('newsRegion', newsRegion); renderNews(); }
  if (e.target.id === 'newsHide') { store.set('newsOculto', true); renderNews(); }
  if (e.target.id === 'newsShow') { store.set('newsOculto', false); renderNews(); }
});
// Noticias que mencionan un activo (para su detalle)
function newsFor(row) {
  if (!S.noticias) return '';
  const sym = row.tab === 'ons' ? row.sym.slice(0, -1) : row.sym.replace(/[DC]$/, m => row.variant ? '' : m);
  const tags = new Set([sym, row.sym]);
  if (row.tab === 'bonos') tags.add('BONOS');
  const list = S.noticias.items.filter(n => (n.tags || []).some(t => tags.has(t))).slice(0, 6);
  if (!list.length) return '';
  return `<h4>Noticias relacionadas</h4><div class="nw-list">${list.map(newsItem).join('')}</div>`;
}

/* ============================================================
   Sincronización de cartera, seguidas y favoritos
   - En la página de Claude: guardado en tu cuenta (capacidad "db"), sigue en cualquier dispositivo.
   - En cualquier otro lado: "link para otro dispositivo" con la cartera dentro del link.
   ============================================================ */
const SYNC_KEYS = ['cartera', 'seguidas', 'fav'];
let cloud = null, cloudTimer = null, cloudReady = false;

async function setupCloud() {
  if (!window.claude || typeof window.claude.use !== 'function') return;
  try {
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return;
    const id = await user.id();
    const ref = db.collection('data/users/' + id).doc('estado');
    const snap = await Promise.race([ref.get(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))]);
    const remote = snap && (typeof snap.data === 'function' ? snap.data() : snap);
    const localHas = S.cartera.length || Object.keys(S.seguidas).length || S.fav.size;
    if (remote && remote.cartera && (!localHas || (remote.t || 0) > (store.get('syncT', 0)))) {
      S.cartera = remote.cartera || []; S.seguidas = remote.seguidas || {}; S.fav = new Set(remote.fav || []);
      ['cartera', 'seguidas'].forEach(k => { try { localStorage.setItem(k, JSON.stringify(S[k])); } catch { } });
      try { localStorage.setItem('fav', JSON.stringify([...S.fav])); } catch { }
      if (S.tab === 'cartera') renderCartera(); else if (S.tab === 'seguir') renderSeguir(); else renderTable();
    }
    cloud = ref; cloudReady = true;
    if (!remote && localHas) cloudSave();
    syncStatus('Sincronizada con tu cuenta de Claude');
  } catch { /* sin nube: queda en el navegador */ }
}
function cloudSave() {
  if (!cloud) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(async () => {
    const t = Date.now();
    try {
      await cloud.set({ cartera: S.cartera, seguidas: S.seguidas, fav: [...S.fav], t });
      try { localStorage.setItem('syncT', String(t)); } catch { }
      syncStatus('Sincronizada con tu cuenta de Claude');
    } catch { syncStatus('No se pudo sincronizar; queda guardada en este navegador'); }
  }, 1200);
}
function onStoreChange(k) { if (cloudReady && SYNC_KEYS.includes(k)) cloudSave(); }
let syncMsg = '';
function syncStatus(m) { syncMsg = m; const el = $('#syncStatus'); if (el) el.textContent = m; }

// Link con la cartera adentro (para pasarla a otro dispositivo sin cuentas)
const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
function syncLink() {
  const data = { c: S.cartera, s: S.seguidas, f: [...S.fav] };
  return location.origin + location.pathname + '#importar=' + b64(JSON.stringify(data));
}
function checkImportHash() {
  const m = location.hash.match(/^#importar=(.+)$/);
  if (!m) return;
  let data;
  try { data = JSON.parse(unb64(m[1])); } catch { return; }
  const bar = document.createElement('div');
  bar.className = 'snapbar';
  bar.innerHTML = `Este link trae una cartera de ${(data.c || []).length} posiciones. <button class="mini" id="impYes">Importarla (reemplaza la actual)</button> <button class="mini" id="impNo">Ignorar</button>`;
  document.querySelector('.tabs').after(bar);
  bar.addEventListener('click', e => {
    if (e.target.id === 'impYes') {
      S.cartera = data.c || []; S.seguidas = data.s || {}; S.fav = new Set(data.f || []);
      store.set('cartera', S.cartera); store.set('seguidas', S.seguidas); store.set('fav', [...S.fav]);
      bar.remove(); history.replaceState(null, '', location.pathname); setTab('cartera');
    }
    if (e.target.id === 'impNo') { bar.remove(); history.replaceState(null, '', location.pathname); }
  });
}
// Bloque de sincronización dentro de "Mi cartera"
function syncBlock() {
  return `<div class="syncbox"><span id="syncStatus" class="muted">${syncMsg || (cloud ? '' : 'Guardada en este navegador.')}</span>
    ${cloud ? '' : `<button class="mini" id="btnSyncLink">Link para otro dispositivo</button><span id="syncLinkOut"></span>`}</div>`;
}
document.addEventListener('click', async e => {
  if (e.target.id !== 'btnSyncLink') return;
  const url = syncLink();
  try { await navigator.clipboard.writeText(url); $('#syncLinkOut').innerHTML = ' <span class="up">Link copiado: abrilo en el otro dispositivo.</span>'; }
  catch { $('#syncLinkOut').innerHTML = ` <input value="${esc(url)}" style="width:280px" onclick="this.select()">`; }
});

/* ============================================================
   Enganches con app.js
   ============================================================ */
function afterTab(tab) { renderCurveBox(); renderNews(); }
function afterRefresh() { curveCache = null; renderCurveBox(); checkAlerts(); }
function afterInit() { checkAlerts(); }

setupStrategyBacktest();
setupAlerts();
loadNews();
checkImportHash();
setupCloud();
