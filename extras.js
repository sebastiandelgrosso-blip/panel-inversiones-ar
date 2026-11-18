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
  g.font = '500 11px Manrope, system-ui, sans-serif'; g.fillStyle = tc('--muted'); g.strokeStyle = tc('--line');
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
      <span class="legend"><span><i style="background:var(--c-fast)"></i>${ESTRATEGIAS[S.params.estrategia] || 'TMR'}</span><span><i style="background:var(--muted)"></i>Comprar y mantener</span></span></div>
      <canvas id="btChart" style="width:100%;height:200px;display:block"></canvas></div>
    <div class="plan">
      ${kv(ESTRATEGIAS[S.params.estrategia] || 'TMR', `<span class="${cls(r.cagr)}">${pct(r.cagr)}</span>`, 'anual')}
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
    { y: r.curve.map(p => p.b), color: tc('--muted') },
    { y: r.curve.map(p => p.s), color: tc('--c-fast') },
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
    <h2>¿Cuál funciona mejor? Backtest general</h2>
    <p>Prueba todas las estrategias sobre las acciones del panel líder y los 30 CEDEARs más operados, en los últimos 5 años,
      y las compara con comprar y mantener. Usa los parámetros actuales (perfil, medias, comisión); podés cambiarlos y volver a probar.</p>
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
  // Calidad barata se prueba como cartera sobre todos los CEDEARs con balances
  const conBal = (S.live.cedears || []).filter(r => !r.variant && fundDe(r.sym));
  await analyzeMany([...rows, ...conBal], { front: true });
  const EST = Object.keys(ESTRATEGIAS).filter(e => e !== 'calidad');
  const res = [];
  for (const r of rows) {
    const a = S.an[r.tab + ':' + r.sym];
    if (!a || a.err || !a.rows) continue;
    const desde = Math.max(0, a.rows.length - 1 - 1260);
    const b = {};
    for (const e of EST) b[e] = backtest(a, { ...S.params, estrategia: e }, desde);
    if (b.tmr && b.tmr.years > 2) res.push({ r, b });
  }
  if (!res.length) { out.innerHTML = '<p class="muted">No hubo instrumentos con historia suficiente.</p>'; return; }
  const avg = f => res.reduce((s, x) => s + f(x), 0) / res.length;
  const ratio = (c, d) => d < 0 ? c / -d : null;
  const bhC = avg(x => x.b.tmr.cagrBh), bhD = avg(x => x.b.tmr.mddBh);
  const sum = EST.map(e => {
    const c = avg(x => x.b[e].cagr), d = avg(x => x.b[e].mdd);
    return { e, c, d, rd: ratio(c, d), gana: res.filter(x => x.b[e].cagr > x.b[e].cagrBh).length + ' de ' + res.length,
      ops: avg(x => x.b[e].trades / x.b[e].years), t: avg(x => x.b[e].tiempo), bh: bhC };
  });
  const cq = carteraCalidad(conBal);
  // Calidad barata va aparte: se mide sobre otro grupo de activos, así que no se mezcla en este ranking
  sum.sort((a, b) => (b.rd ?? -9) - (a.rd ?? -9));
  const best = {};
  for (const x of res) best[x.r.sym] = EST.reduce((m, e) => x.b[e].cagr > x.b[m].cagr ? e : m, EST[0]);
  out.innerHTML = `
    <table class="simple" style="font-size:13px;margin-top:12px">
      <tr><th>Estrategia</th><th>Rinde anual (prom.)</th><th>Peor caída (prom.)</th><th>Retorno / caída</th><th>Le ganó a mantener</th><th>Operaciones por año</th><th>Tiempo invertido</th></tr>
      ${sum.map((x, i) => `<tr${x.e === S.params.estrategia ? ' style="background:var(--hl)"' : ''}><td><b>${ESTRATEGIAS[x.e]}</b>${i === 0 ? ' 🏆' : ''}${x.e === S.params.estrategia ? ' <span class="muted">(elegida)</span>' : ''}</td>
        <td class="${cls(x.c)}">${pct(x.c)}</td><td>${pct(x.d, 0)}</td><td>${fmt(x.rd, 2)}</td>
        <td>${x.gana}</td><td>${fmt(x.ops, 1)}</td><td>${pct(x.t, 0, false)}</td></tr>`).join('')}
      <tr><td><b>Comprar y mantener</b></td><td class="${cls(bhC)}">${pct(bhC)}</td><td>${pct(bhD, 0)}</td><td>${fmt(ratio(bhC, bhD), 2)}</td><td>—</td><td>0</td><td>100%</td></tr>
    </table>
    <p class="note">Ordenadas por <b>retorno / caída</b> (rinde anual ÷ peor caída): cuánto rendimiento da cada punto de caída que tuviste que aguantar. 🏆 = la mejor de todas en eso.
      Si comprar y mantener sale mejor, ninguna estrategia le ganó en este período.</p>
    ${cq ? `<h3 style="margin-top:18px">Calidad barata (balances), como cartera</h3>
    <p>Se prueba sobre los <b>${cq.N} CEDEARs con balances de la SEC</b> (las acciones argentinas no tienen): cada día se tienen, por partes iguales, todas las empresas que cumplen la regla,
      y el resto queda en efectivo. Se compara con tener esas mismas ${cq.N} empresas por partes iguales todo el tiempo.</p>
    <div class="plan">
      <div class="kv"><div class="k">Rinde anual</div><div class="v ${cls(cq.cagr)}">${pct(cq.cagr)} <small>vs ${pct(cq.cagrBh)} manteniendo</small></div></div>
      <div class="kv"><div class="k">Peor caída</div><div class="v">${pct(cq.mdd, 0)} <small>vs ${pct(cq.mddBh, 0)}</small></div></div>
      <div class="kv"><div class="k">Empresas en cartera</div><div class="v">${fmt(cq.prom, 1)} <small>en promedio (máx. ${cq.max})</small></div></div>
      <div class="kv"><div class="k">Tiempo invertido</div><div class="v">${pct(cq.tiempo, 0, false)}</div></div>
      <div class="kv"><div class="k">Hoy califican</div><div class="v">${cq.hoy.length}</div></div>
    </div>
    ${cq.hoy.length ? `<p class="note">Califican hoy: ${cq.hoy.map(s => '<b>' + esc(s) + '</b>').join(', ')}.</p>` : ''}
    <p class="note">Aproximación: supone que cada balance anual se conoce 90 días después del cierre y usa los datos tal como figuran hoy en la SEC (pueden incluir correcciones posteriores).
      Incluye solo empresas que existen hoy (las que quebraron no están), lo que mejora un poco los resultados.</p>` : ''}
    <h3 style="margin-top:18px">Rinde anual por activo</h3>
    <table class="simple" style="font-size:13px">
      <tr><th>Activo</th><th>Mantener</th>${EST.map(e => `<th>${ESTRATEGIAS[e]}</th>`).join('')}</tr>
      ${res.map(x => `<tr><td><b>${x.r.sym}</b> <span class="muted">${TAB_LABEL[x.r.tab]}</span></td>
        <td class="${cls(x.b.tmr.cagrBh)}">${pct(x.b.tmr.cagrBh)}</td>
        ${EST.map(e => `<td class="${cls(x.b[e].cagr)}"${best[x.r.sym] === e ? ' style="font-weight:700"' : ''}>${pct(x.b[e].cagr)}</td>`).join('')}</tr>`).join('')}
    </table>
    <p class="note">En negrita, la mejor estrategia para cada activo. Rendimientos anuales en dólares (CCL) de los últimos 5 años. CEDEARs incluyen dividendos; acciones argentinas, solo precio.
      Simplificaciones: se opera al cierre del día de la señal y el tiempo fuera del mercado no rinde interés.</p>`;
}

// Cartera "Calidad barata": cada día, partes iguales entre todas las empresas que cumplen la regla
function carteraCalidad(lista) {
  const P = { ...S.params, estrategia: 'calidad' }, cost = (P.comision || 0) / 100;
  const series = [];
  for (const r of lista) {
    const a = S.an['cedears:' + r.sym];
    if (!a || a.err || !a.rows || !a.usK) continue;
    const b = backtest(a, P, Math.max(0, a.rows.length - 1 - 1260));
    if (!b) continue;
    const m = new Map();
    for (let k = 0; k < b.held.length; k++) m.set(a.rows[b.start + k].d, { c: a.rows[b.start + k].c, h: b.held[k] });
    series.push({ sym: r.sym, m, abierta: b.abierta });
  }
  if (series.length < 20) return null;
  const fechas = [...new Set(series.flatMap(s => [...s.m.keys()]))].sort();
  const prev = new Map(); // último dato visto de cada empresa
  let eq = 1, bh = 1, pk = 1, pkB = 1, mdd = 0, mddB = 0, dias = 0, conPos = 0, suma = 0, max = 0, entradas = 0;
  for (const d of fechas) {
    let rP = 0, nP = 0, rB = 0, nB = 0, cambios = 0, nHoy = 0;
    for (const s of series) {
      const x = s.m.get(d);
      if (!x) continue;
      const p = prev.get(s.sym);
      if (p) {
        const r = x.c / p.c - 1;
        rB += r; nB++;
        if (p.h) { rP += r; nP++; }
        if (x.h !== p.h) { cambios++; if (x.h) entradas++; }
      }
      if (x.h) nHoy++;
      prev.set(s.sym, x);
    }
    if (!nB) continue;
    dias++;
    eq *= 1 + (nP ? rP / nP : 0);
    eq *= 1 - cost * cambios / Math.max(1, nHoy, nP); // comisión de las compras y ventas del día (aprox.)
    bh *= 1 + rB / nB;
    pk = Math.max(pk, eq); pkB = Math.max(pkB, bh);
    mdd = Math.min(mdd, eq / pk - 1); mddB = Math.min(mddB, bh / pkB - 1);
    if (nHoy) conPos++;
    suma += nHoy; max = Math.max(max, nHoy);
  }
  const years = dias / 252;
  return {
    N: series.length, cagr: Math.pow(eq, 1 / years) - 1, cagrBh: Math.pow(bh, 1 / years) - 1, mdd, mddBh: mddB,
    tiempo: conPos / dias, prom: suma / dias, max, ops: entradas / years / series.length,
    hoy: series.filter(s => s.abierta).map(s => s.sym),
  };
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
  g.font = '500 11px Manrope, system-ui, sans-serif';
  if (all.length < 2) { g.fillStyle = tc('--muted'); g.fillText('No hay suficientes bonos con TIR en este grupo.', 10, 20); return; }
  const padL = 44, padR = 14, top = 10, bot = 26, pw = W - padL - padR, ph = H - top - bot;
  const x0 = 0, x1 = Math.max(...all.map(p => p.x)) * 1.08;
  let y0 = Math.min(...all.map(p => p.y)), y1 = Math.max(...all.map(p => p.y));
  const pad = (y1 - y0) * 0.15 || 0.01; y0 -= pad; y1 += pad;
  const X = x => padL + (x - x0) / (x1 - x0) * pw, Y = y => top + (1 - (y - y0) / (y1 - y0)) * ph;
  g.strokeStyle = tc('--line'); g.fillStyle = tc('--muted');
  for (let k = 0; k <= 4; k++) {
    const y = y0 + (y1 - y0) * k / 4; g.beginPath(); g.moveTo(padL, Y(y)); g.lineTo(padL + pw, Y(y)); g.stroke();
    g.textBaseline = 'middle'; g.fillText((y * 100).toFixed(1) + '%', 4, Y(y));
  }
  g.textBaseline = 'top';
  for (let k = 0; k <= 5; k++) { const x = x0 + (x1 - x0) * k / 5; g.fillText(x.toFixed(1), X(x) - 8, H - bot + 6); }
  g.fillText('duration (años)', padL + pw - 80, H - 12);
  const COLORS = { local: tc('--c-fast'), NY: tc('--up'), all: tc('--c-fast'), BOPREAL: tc('--c-slow') };
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
    g.fillStyle = COLORS[p.sub] || tc('--c-fast');
    g.beginPath(); g.arc(X(p.x), Y(p.y), 4, 0, 7); g.fill();
    g.fillStyle = tc('--text'); g.textBaseline = 'bottom';
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
/* Íconos de trazo fino (SVG propios) */
const svgI = d => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  bell: svgI('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
  sun: svgI('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svgI('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  refresh: svgI('<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 21v-5h-5"/>'),
  sliders: svgI('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  download: svgI('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'),
};
(function ponerIconos() {
  const pre = (sel, ic) => { const b = document.querySelector(sel); if (b && !b.querySelector('svg')) b.insertAdjacentHTML('afterbegin', ic); };
  pre('#btnRefresh', ICON.refresh); pre('#btnParams', ICON.sliders); pre('#btnCsv', ICON.download);
})();

S.alertas = store.get('alertas', []);
S.alertState = store.get('alertState', {});

function renderBell() {
  const unread = S.alertas.filter(a => !a.leida).length;
  $('#btnBell').innerHTML = `${ICON.bell}${unread ? ` <span class="badge">${unread}</span>` : ''}`;
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
  if (missing.length) await analyzeMany(missing, { front: true });
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
  refreshNewsLive();
}

// El archivo de noticias lo actualiza GitHub cada varias horas. Si quedó viejo, la página lee los RSS por su cuenta:
// los de EE.UU. directo, y los argentinos (que no permiten lectura desde otro sitio) a través de un servicio público de retransmisión.
const NEWS_MAX_MIN = 20;
let newsBusy = false;
async function refreshNewsLive() {
  if (SNAP || newsBusy || typeof NEWS === 'undefined') return;
  const edad = S.noticias && S.noticias.actualizado ? (Date.now() - Date.parse(S.noticias.actualizado)) / 60000 : Infinity;
  if (edad < NEWS_MAX_MIN) return;
  newsBusy = true;
  try {
    const limite = Date.now() - NEWS.HORAS * 3600e3;
    const texto = async url => {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
      try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
      finally { clearTimeout(t); }
    };
    const res = await Promise.all(NEWS.FEEDS.map(async f => {
      const u = encodeURIComponent(f.url);
      // En orden: lectura directa, rss2json.com y, si falla, allorigins.win
      const vias = f.cors ? [async () => NEWS.parse(await texto(f.url), f, limite)] : [
        async () => NEWS.deJSON(JSON.parse(await texto('https://api.rss2json.com/v1/api.json?rss_url=' + u)), f, limite),
        async () => NEWS.parse(await texto('https://api.allorigins.win/raw?url=' + u), f, limite),
      ];
      for (const via of vias) {
        try { const items = await via(); if (items.length) return items; } catch { /* prueba la siguiente */ }
      }
      return null;
    }));
    const okN = res.filter(Boolean).length;
    if (!okN) return;
    const items = NEWS.unir([...res.filter(Boolean), (S.noticias && S.noticias.items) || []]);
    // Solo se marca como "recién actualizado" si respondió la mayoría de las fuentes
    const actualizado = okN > NEWS.FEEDS.length / 2 ? new Date().toISOString() : (S.noticias && S.noticias.actualizado) || new Date().toISOString();
    S.noticias = { actualizado, items };
    renderNews();
    if (typeof renderResumenSoon === 'function') renderResumenSoon();
  } finally { newsBusy = false; }
}
if (!SNAP) setInterval(() => { if (document.visibilityState === 'visible') refreshNewsLive(); }, 10 * 60 * 1000);
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
/* ============================================================
   Resumen: el mercado de un vistazo (pantalla de inicio)
   ============================================================ */
S.mercado = {};
let resTimer;
function renderResumenSoon() { clearTimeout(resTimer); resTimer = setTimeout(drawResumen, 200); }

async function renderResumen() {
  drawResumen();
  await Promise.all(['acciones', 'cedears'].map(t => loadLive(t).catch(() => { })));
  drawResumen();
  loadMercado();
  // Cotizaciones de lo que haya en la cartera (bonos, ONs)
  const faltan = [...new Set(S.cartera.map(p => p.tab))].filter(t => !S.live[t]);
  if (faltan.length) Promise.all(faltan.map(t => loadLive(t).catch(() => { }))).then(renderResumenSoon);
  // Analiza todo en segundo plano: primero las acciones, después los CEDEARs
  autoAnalyze('cedears');
  autoAnalyze('acciones');
}

// Datos de contexto: riesgo país y S&P 500 (se piden una sola vez)
async function loadMercado() {
  if (S.mercado.pedido) return;
  S.mercado.pedido = true;
  fetchJSON('https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais', 20000).then(d => {
    const u = d[d.length - 1], p = d[d.length - 2];
    if (u && u.valor > 0) { S.mercado.rp = { v: u.valor, ant: p && p.valor, d: u.fecha }; renderResumenSoon(); renderMktBar(); }
  }).catch(() => { });
  getUSA('SPY').then(r => {
    const u = r[r.length - 1], p = r[r.length - 2];
    if (u && p) { S.mercado.spy = { chg: u.c / p.c - 1, d: u.d }; renderResumenSoon(); }
  }).catch(() => { });
  loadCCL().then(renderResumenSoon).catch(() => { });
}

const SIG_ORD = ['VENDER', 'REDUCIR', 'MANTENER', 'ACUMULAR', 'COMPRAR'];
const sigBadge = s => `<span class="sig s-${s}">${s}</span>`;
const dm = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '';

function drawResumen() {
  const v = $('#viewResumen');
  if (!v || S.tab !== 'resumen') return;
  const acc = (S.live.acciones || []).filter(r => !r.variant && r.v > 0 && r.c > 0);
  const ced = (S.live.cedears || []).filter(r => !r.variant && r.v > 0 && r.c > 0);
  if (!acc.length && !ced.length) { v.innerHTML = '<p class="muted">Cargando cotizaciones…</p>'; return; }
  const kv = (k, val, sub) => `<div class="kv"><div class="k">${k}</div><div class="v">${val}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;

  // ---- Mercado hoy ----
  const lid = acc.filter(r => LIDER.has(r.sym) && ok(r.chg));
  const lidChg = lid.length ? lid.reduce((s, r) => s + r.chg, 0) / lid.length : null;
  const suben = acc.filter(r => r.chg > 0).length, bajan = acc.filter(r => r.chg < 0).length;
  const ccl = currentCCL(), serie = S.cclSeries;
  const cclAnt = serie && serie.filter(x => x.d < today()).pop();
  const cclChg = ccl && cclAnt ? ccl / cclAnt.v - 1 : null;
  const M = S.mercado;
  const tiles = [
    kv('Panel líder', `<span class="${cls(lidChg)}">${pct(lidChg, 2)}</span>`, 'promedio del día, en pesos'),
    kv('Acciones argentinas', `<span class="up">${suben} ▲</span> <span class="down">${bajan} ▼</span>`, 'suben / bajan'),
    M.spy ? kv('S&P 500', `<span class="${cls(M.spy.chg)}">${pct(M.spy.chg, 2)}</span>`, 'última rueda (' + dm(M.spy.d) + ')') : '',
    ccl ? kv('Dólar CCL', '$' + fmt(ccl, 0), ok(cclChg) ? `<span class="${cls(cclChg)}">${pct(cclChg, 1)}</span> vs ayer` : '') : '',
    M.rp ? kv('Riesgo país', fmt(M.rp.v, 0), (M.rp.ant ? `<span class="${cls(M.rp.ant - M.rp.v)}">${M.rp.v - M.rp.ant > 0 ? '+' : ''}${M.rp.v - M.rp.ant}</span> · ` : '') + dm(M.rp.d)) : '',
  ].join('');

  // ---- Las que más se movieron ----
  const fila = r => {
    const a = an(r);
    return `<div class="rs-row" data-key="${r.tab}:${esc(r.sym)}"><b class="rs-tk">${esc(r.sym)}</b>
      <span class="rs-sp">${a ? sparkSVG(a, 60, 20) : ''}</span>
      <span class="rs-px">$ ${fmt(r.c)}</span><span class="rs-chg ${cls(r.chg)}">${pct(r.chg, 1)}</span>
      <span class="rs-sig">${a ? sigBadge(a.signal) : ''}</span></div>`;
  };
  const movers = (rows, n, titulo, nota) => {
    const top = rows.slice().sort((a, b) => b.monto - a.monto).slice(0, n).filter(r => ok(r.chg) && Math.abs(r.chg) < 0.6); // más de 60% en un día es un error de datos
    const up = top.slice().sort((a, b) => b.chg - a.chg).slice(0, 5).filter(r => r.chg > 0);
    const dn = top.slice().sort((a, b) => a.chg - b.chg).slice(0, 5).filter(r => r.chg < 0);
    return `<div class="card rs-card"><h3>${titulo} <span class="muted">${nota}</span></h3>
      <div class="rs-two"><div><div class="rs-sub up">Las que más subieron</div>${up.map(fila).join('') || '<p class="muted">Ninguna subió.</p>'}</div>
      <div><div class="rs-sub down">Las que más bajaron</div>${dn.map(fila).join('') || '<p class="muted">Ninguna bajó.</p>'}</div></div></div>`;
  };

  // ---- Rupturas: superaron su máximo anual en las últimas 5 ruedas, ordenadas por fuerza relativa ----
  const rupturas = rows => {
    const L = rows.map(r => ({ r, a: an(r), rs: rsOf(r) })).filter(x => x.a && x.a.ruptura && x.r.monto > 0).sort((x, y) => (y.rs || 0) - (x.rs || 0));
    return `<div class="card rs-card"><h3>Rupturas <span class="muted">superaron su máximo anual en la última semana</span></h3>
      ${L.length ? L.slice(0, 10).map(x => `<div class="rs-row" data-key="${x.r.tab}:${esc(x.r.sym)}"><b class="rs-tk">${esc(x.r.sym)}</b>
        <span class="muted" style="font-size:12px">${x.r.tab === 'cedears' ? 'CEDEAR' : 'Acción'} · ${x.a.ruptura.hace ? 'hace ' + x.a.ruptura.hace + (x.a.ruptura.hace > 1 ? ' ruedas' : ' rueda') : 'hoy'}</span>
        <span class="rs-px">RS <b class="${x.rs >= 80 ? 'up' : ''}">${x.rs ?? '—'}</b></span><span class="rs-sig">${sigBadge(x.a.signal)}</span></div>`).join('')
        + (L.length > 10 ? `<p class="muted rs-mas">y ${L.length - 10} más</p>` : '')
        : '<p class="muted">Ninguna por ahora' + (AQ.running ? ' (todavía se están analizando)' : '') + '.</p>'}
      <p class="note" style="margin:8px 0 0">RS = fuerza relativa de 1 a 99: qué tan bien viene rindiendo contra el resto (99 = de las mejores). Las rupturas con RS alto son las más seguidas por los traders de tendencia.</p></div>`;
  };

  // ---- Señales ----
  const barra = (rows, titulo) => {
    const A = rows.map(an).filter(Boolean);
    const n = A.length;
    const cnt = Object.fromEntries(SIG_ORD.map(s => [s, A.filter(a => a.signal === s).length]));
    const orden = SIG_ORD.slice().reverse();
    return `<div class="rs-bar-t"><b>${titulo}</b> <span class="muted">${n} de ${rows.length} analizadas${n < rows.length && AQ.running ? '…' : ''}</span></div>
      <div class="rs-bar">${n ? orden.filter(s => cnt[s]).map(s => `<i class="s-${s}" style="flex:${cnt[s]}" title="${s}: ${cnt[s]}"></i>`).join('') : ''}</div>
      <div class="rs-leg">${orden.filter(s => cnt[s]).map(s => `<span><i class="s-${s}"></i>${s[0] + s.slice(1).toLowerCase()} ${cnt[s]}</span>`).join('')}</div>`;
  };
  const cambios = [...acc, ...ced].map(r => ({ r, a: an(r) })).filter(x => x.a && x.a.prevSignal && x.a.prevSignal !== x.a.signal)
    .sort((x, y) => y.r.monto - x.r.monto);
  const mejor = cambios.filter(x => SIG_ORD.indexOf(x.a.signal) > SIG_ORD.indexOf(x.a.prevSignal));
  const peor = cambios.filter(x => SIG_ORD.indexOf(x.a.signal) < SIG_ORD.indexOf(x.a.prevSignal));
  const filaCambio = x => `<div class="rs-row" data-key="${x.r.tab}:${esc(x.r.sym)}"><b class="rs-tk">${esc(x.r.sym)}</b>
    <span class="rs-cmb">${sigBadge(x.a.prevSignal)} → ${sigBadge(x.a.signal)}</span></div>`;
  const listaCambios = (L, vacio) => L.length
    ? L.slice(0, 6).map(filaCambio).join('') + (L.length > 6 ? `<p class="muted rs-mas">y ${L.length - 6} más</p>` : '')
    : `<p class="muted">${vacio}</p>`;

  // ---- Mi cartera ----
  let cartera;
  if (S.cartera.length) {
    const pos = S.cartera.map(posCalc);
    const totARS = pos.reduce((s, x) => s + (x.valARS || 0), 0), totUSD = pos.reduce((s, x) => s + (x.valUSD || 0), 0);
    const dia = pos.reduce((s, x) => s + (x.r && ok(x.r.chg) && x.valARS ? x.valARS - x.valARS / (1 + x.r.chg) : 0), 0);
    const nuevas = S.alertas.filter(a => !a.leida);
    cartera = `<div class="card rs-card"><h3>Mi cartera <a class="rs-link" data-go="cartera">ver todo →</a></h3>
      <div class="plan">
        ${kv('Valor', '$ ' + compact(totARS), 'US$ ' + compact(totUSD))}
        ${kv('Hoy', `<span class="${cls(dia)}">${dia >= 0 ? '+' : '−'}$ ${compact(Math.abs(dia))}</span>`, totARS > 0 ? pct(dia / (totARS - dia), 2) : '')}
      </div>
      ${pos.filter(x => x.r).sort((a, b) => (b.valARS || 0) - (a.valARS || 0)).slice(0, 8).map(x => `<div class="rs-row" data-key="${x.p.tab}:${esc(x.p.sym)}">
        <b class="rs-tk">${esc(x.p.sym)}</b><span class="rs-chg ${cls(x.r.chg)}">${pct(x.r.chg, 1)} hoy</span>
        <span class="rs-px ${cls(x.res)}">${ok(x.res) ? pct(x.res, 0) + ' total' : ''}</span>
        <span class="rs-sig">${x.A ? sigBadge(x.A.signal) : ''}</span></div>`).join('')}
      ${nuevas.length ? `<p class="rs-alerta">🔔 ${nuevas.length} alerta${nuevas.length > 1 ? 's' : ''} sin leer: ${esc(nuevas[nuevas.length - 1].txt)}</p>` : ''}</div>`;
  } else {
    cartera = `<div class="card rs-card"><h3>Mi cartera</h3>
      <p class="muted">Cargá lo que tenés (cantidad y precio de compra) para ver acá cuánto vale, cuánto ganó hoy y qué señal tiene cada posición.</p>
      <button class="primary" data-go="cartera">Cargar mi cartera</button></div>`;
  }

  // ---- Noticias ----
  const noticias = S.noticias && S.noticias.items.length
    ? `<div class="card rs-card"><h3>Noticias <span class="muted">actualizadas ${hace(S.noticias.actualizado)}</span></h3>
        ${S.noticias.items.slice(0, 6).map(newsItem).join('')}</div>` : '';

  v.innerHTML = `
    <div class="rs-head"><h2>Mercado hoy</h2>
      <span class="muted">${S.liveTime ? 'Cotizaciones de las ' + S.liveTime.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''} · estrategia ${ESTRATEGIAS[S.params.estrategia] || 'TMR'}</span></div>
    <div class="plan rs-tiles">${tiles}</div>
    <div class="rs-grid">
      ${cartera}
      <div class="card rs-card"><h3>Señales <span class="muted">según la estrategia elegida</span></h3>
        ${barra(acc, 'Acciones argentinas')}${barra(ced, 'CEDEARs')}
        <div class="rs-two" style="margin-top:12px"><div><div class="rs-sub up">Mejoraron desde la rueda anterior</div>${listaCambios(mejor, 'Ninguna.')}</div>
        <div><div class="rs-sub down">Empeoraron</div>${listaCambios(peor, 'Ninguna.')}</div></div></div>
      ${rupturas([...acc, ...ced])}
      ${movers(acc, 60, 'Acciones argentinas', 'las 60 más operadas')}
      ${movers(ced, 100, 'CEDEARs', 'los 100 más operados')}
      ${noticias}
    </div>
    <p class="note">Tocá cualquier activo para ver su análisis completo. Precios en pesos, demorados.</p>`;
}
document.addEventListener('click', e => {
  const v = e.target.closest('#viewResumen');
  if (!v) return;
  const go = e.target.closest('[data-go]');
  if (go) return setTab(go.dataset.go);
  const row = e.target.closest('[data-key]');
  if (row) openDetail(row.dataset.key);
});

/* ============================================================
   Variación en dólares de un CEDEAR: la variación en pesos menos la del CCL del día
   ============================================================ */
function cclVarHoy() {
  const ccl = currentCCL(), serie = S.cclSeries;
  const ant = serie && serie.filter(x => x.d < today()).pop();
  return ccl && ant ? ccl / ant.v - 1 : null;
}
function chgUSD(r) {
  if (!r || !ok(r.chg)) return null;
  const v = cclVarHoy();
  return ok(v) ? (1 + r.chg) / (1 + v) - 1 : r.chg;
}

/* ============================================================
   Barra de mercados: el mundo y Argentina de un vistazo
   ============================================================ */
const BARRA = [
  ['SPY', 'S&P 500'], ['QQQ', 'Nasdaq'], ['EWZ', 'Brasil'], ['EEM', 'Emergentes'],
  ['GLD', 'Oro'], ['SLV', 'Plata'], ['XLE', 'Energía'], ['IBIT', 'Bitcoin'], ['ETHA', 'Ethereum'],
];
function renderMktBar() {
  const el = $('#mktBar');
  if (!el) return;
  const ced = Object.fromEntries((S.live.cedears || []).map(r => [r.sym, r]));
  const it = (lbl, val, cl, key, tip) => `<span class="mk${key ? ' clk' : ''}"${key ? ` data-key="${key}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}><span class="mk-l">${lbl}</span><b class="${cl || ''}">${val}</b></span>`;
  const glob = BARRA.map(([s, l]) => {
    const r = ced[s], v = chgUSD(r);
    return ok(v) ? it(l, pct(v, 2), cls(v), 'cedears:' + s, `${l}: variación de hoy en dólares, estimada con el CEDEAR ${s} y el CCL`) : '';
  }).join('');
  const lid = (S.live.acciones || []).filter(r => !r.variant && LIDER.has(r.sym) && ok(r.chg));
  const lidChg = lid.length ? lid.reduce((s, r) => s + r.chg, 0) / lid.length : null;
  const of = S.fx.oficial, mep = S.fx.bolsa, ccl = S.fx.contadoconliqui, M = S.mercado || {};
  const ar = [
    ok(lidChg) ? it('Panel líder', pct(lidChg, 2), cls(lidChg), null, 'Promedio de la variación de hoy de las acciones del panel líder, en pesos') : '',
    M.rp ? it('Riesgo país', fmt(M.rp.v, 0) + (M.rp.ant ? ` <small>${M.rp.v - M.rp.ant > 0 ? '+' : ''}${M.rp.v - M.rp.ant}</small>` : ''), M.rp.ant ? cls(M.rp.ant - M.rp.v) : '', null, 'Riesgo país (puntos básicos) y cambio contra el día anterior') : '',
    of && ccl ? it('Brecha CCL', pct(ccl / of - 1, 1, false), '', null, 'Cuánto más caro está el dólar CCL que el oficial') : '',
    of && mep ? it('Brecha MEP', pct(mep / of - 1, 1, false), '', null, 'Cuánto más caro está el dólar MEP que el oficial') : '',
    mep && ccl ? it('Canje', pct(ccl / mep - 1, 2, false), '', null, 'Diferencia entre el dólar cable (CCL, afuera) y el MEP (dólares en Argentina)') : '',
  ].join('');
  el.innerHTML = (glob ? `<span class="mk-g">Mundo</span>${glob}` : '') + (ar ? `<span class="mk-g">Argentina</span>${ar}` : '');
  el.hidden = !glob && !ar;
}
document.addEventListener('click', e => {
  const k = e.target.closest('#mktBar [data-key]');
  if (k) openDetail(k.dataset.key);
});
async function setupMktBar() {
  if (!$('#mktBar')) return;
  renderMktBar();
  await Promise.all([loadLive('cedears').catch(() => { }), loadLive('acciones').catch(() => { }), loadCCL().catch(() => { })]);
  loadMercado();
  renderMktBar();
}

/* ============================================================
   Fuerza relativa (RS): 1 a 99 contra el resto de la misma pestaña
   ============================================================ */
// Igual que el "RS rating" clásico: pesa doble los últimos 3 meses
function rsRaw(a) {
  if (!a || !ok(a.r3m) || !ok(a.r6m)) return null;
  const r9 = ok(a.r9m) ? a.r9m : a.r6m, r12 = ok(a.r12m) ? a.r12m : r9;
  return 0.4 * a.r3m + 0.2 * a.r6m + 0.2 * r9 + 0.2 * r12;
}
let rsCache = {};
function rsMapa(tab) {
  const rows = (S.live[tab] || []).filter(r => !r.variant);
  const vals = rows.map(r => [r.sym, rsRaw(an(r))]).filter(x => ok(x[1]));
  const sig = vals.length + ':' + vals.reduce((s, x) => s + x[1], 0).toFixed(4);
  if (rsCache[tab] && rsCache[tab].sig === sig) return rsCache[tab].m;
  vals.sort((a, b) => a[1] - b[1]);
  const m = {};
  vals.forEach(([s], i) => { m[s] = vals.length > 1 ? Math.max(1, Math.min(99, Math.round(1 + i / (vals.length - 1) * 98))) : 50; });
  rsCache[tab] = { sig, m };
  return m;
}
const rsOf = r => r && !r.variant && (r.tab === 'acciones' || r.tab === 'cedears') ? rsMapa(r.tab)[r.sym] ?? null : null;

/* ============================================================
   Carry trade e inflación implícita (LECAP/BONCAP vs dólar y vs CER)
   ============================================================ */
function renderCarryBox() {
  let box = $('#carryBox');
  if (S.tab !== 'bonos') { if (box) box.hidden = true; return; }
  if (!box) {
    box = document.createElement('details');
    box.id = 'carryBox'; box.className = 'chartbox curvebox';
    box.open = store.get('carryAbierto', false);
    box.addEventListener('toggle', () => { store.set('carryAbierto', box.open); if (box.open) renderCarryBox(); });
    ($('#curveBox') || $('#summary')).after(box);
  }
  box.hidden = false;
  const mep = S.fx.bolsa;
  const rows = (S.live.bonos || []).filter(r => !r.variant).map(r => ({ r, B: bondInfo(r) })).filter(x => x.B);
  const lecaps = rows.filter(x => x.B.kind === 'lecap' && !x.B.raro && x.B.dias > 3).sort((a, b) => a.B.dias - b.B.dias);
  const cers = rows.filter(x => x.B.kind === 'cer' && !x.B.raro && x.B.dur > 0.08);
  const head = '<summary>Carry trade e inflación implícita (LECAP y BONCAP)</summary>';
  if (!box.open) { box.innerHTML = head; return; }
  if (!lecaps.length || !mep) { box.innerHTML = head + '<p class="muted">Cargando LECAP, CER y dólar MEP…</p>'; return; }
  const esc2 = [0, 0.05, 0.10];
  const filas = lecaps.map(({ r, B }) => {
    const g = B.next.total / B.price;                 // cuánto multiplica los pesos hasta el vencimiento
    const eq = mep * g;                               // dólar de salida que empata con haber comprado dólares hoy
    // Bono CER de duración más parecida, para la inflación implícita
    let c = null;
    for (const x of cers) if (!c || Math.abs(x.B.dur - B.dur) < Math.abs(c.B.dur - B.dur)) c = x;
    const infl = c && Math.abs(c.B.dur - B.dur) < Math.max(0.25, B.dur * 0.5) ? (1 + B.tir) / (1 + c.B.tir) - 1 : null;
    const inflM = ok(infl) ? Math.pow(1 + infl, 1 / 12) - 1 : null;
    return `<tr data-key="bonos:${esc(r.sym)}"><td class="l"><b>${esc(r.sym)}</b></td><td class="l">${B.venc.split('-').reverse().join('/')}</td><td>${B.dias}</td>
      <td>${pct(B.tem, 2, false)}</td><td>${pct(B.tir, 1, false)}</td>
      <td><b>$${fmt(eq, 0)}</b> <small class="muted">${pct(eq / mep - 1, 1)}</small></td>
      ${esc2.map(s => { const u = g / (1 + s) - 1; return `<td class="${cls(u)}">${pct(u, 1)}</td>`; }).join('')}
      <td>${ok(inflM) ? `${pct(inflM, 2, false)} <small class="muted">vs ${esc(c.r.sym)}</small>` : '—'}</td></tr>`;
  }).join('');
  box.innerHTML = head + `
    <div class="tablewrap" style="max-height:none"><table class="simple carry">
      <tr><th>LECAP</th><th>Vence</th><th>Días</th><th>Tasa mensual</th><th>Tasa anual</th><th>Dólar de equilibrio</th>
        <th>En US$ si el MEP no se mueve</th><th>…si sube 5%</th><th>…si sube 10%</th><th>Inflación implícita mensual</th></tr>
      ${filas}
    </table></div>
    <p class="note" style="margin:6px 0 0"><b>Carry trade</b>: pasar dólares a pesos, comprar la LECAP y volver al dólar al vencimiento. El <b>dólar de equilibrio</b> es el MEP al que
      ganarías lo mismo que quedándote en dólares (hoy el MEP está en $${fmt(mep, 0)}): si al vencimiento el dólar está por debajo, el carry ganó. Las columnas "En US$" muestran
      cuánto rendiría en dólares en todo el período según cuánto suba el MEP. La <b>inflación implícita</b> compara la tasa de la LECAP con la tasa real del bono CER de plazo
      más parecido: es la inflación mensual promedio que descuenta el mercado. Por encima de ella conviene el CER; por debajo, la tasa fija.</p>`;
}
document.addEventListener('click', e => {
  const tr = e.target.closest('#carryBox tr[data-key]');
  if (tr) openDetail(tr.dataset.key);
});

/* ============================================================
   Mapa de calor de CEDEARs por sector
   ============================================================ */
const SECTOR_ORD = ['Tecnología', 'Comunicaciones', 'Consumo discrecional', 'Consumo básico', 'Finanzas', 'Salud', 'Energía', 'Materiales', 'Industria', 'Servicios públicos', 'Inmobiliario', 'ETFs y otros'];
function heatColor(v) {
  if (!ok(v)) return 'var(--heat0)';
  const k = Math.min(1, Math.abs(v) / 0.03);
  return `color-mix(in srgb, var(${v >= 0 ? '--up' : '--down'}) ${Math.round(22 + 70 * k)}%, var(--heat0))`;
}
// Reparte un rectángulo en rectángulos de área proporcional a cada valor, lo más cuadrados posible
// (algoritmo "squarified treemap", Bruls, Huizing y van Wijk, 2000)
function squarify(vals, x, y, w, h) {
  const tot = vals.reduce((s, v) => s + v, 0);
  const out = new Array(vals.length);
  if (!tot || w <= 0 || h <= 0) return out.fill({ x, y, w: 0, h: 0 });
  const k = w * h / tot;
  const items = vals.map((v, i) => ({ i, a: v * k })).sort((p, q) => q.a - p.a);
  const peor = (fila, lado) => {
    const s = fila.reduce((t, r) => t + r.a, 0), mx = Math.max(...fila.map(r => r.a)), mn = Math.min(...fila.map(r => r.a));
    return Math.max(lado * lado * mx / (s * s), s * s / (lado * lado * mn));
  };
  let fila = [], j = 0;
  const ubicar = () => {
    const s = fila.reduce((t, r) => t + r.a, 0);
    if (w >= h) { // columna a la izquierda
      const cw = s / h; let yy = y;
      for (const r of fila) { const rh = r.a / cw; out[r.i] = { x, y: yy, w: cw, h: rh }; yy += rh; }
      x += cw; w -= cw;
    } else {      // fila arriba
      const rh = s / w; let xx = x;
      for (const r of fila) { const rw = r.a / rh; out[r.i] = { x: xx, y, w: rw, h: rh }; xx += rw; }
      y += rh; h -= rh;
    }
    fila = [];
  };
  while (j < items.length) {
    const lado = Math.min(w, h), it = items[j];
    if (!fila.length || peor(fila.concat(it), lado) <= peor(fila, lado)) { fila.push(it); j++; }
    else ubicar();
  }
  if (fila.length) ubicar();
  return out;
}

function renderHeatBox() {
  let box = $('#heatBox');
  if (S.tab !== 'cedears') { if (box) box.hidden = true; return; }
  if (!box) {
    box = document.createElement('details');
    box.id = 'heatBox'; box.className = 'chartbox curvebox';
    box.open = store.get('heatAbierto', true);
    box.addEventListener('toggle', () => { store.set('heatAbierto', box.open); if (box.open) renderHeatBox(); });
    $('#summary').before(box);
  }
  box.hidden = false;
  const head = '<summary>Mapa de calor por sector</summary>';
  if (!box.open) { box.innerHTML = head; return; }
  const sect = (S.fund && S.fund.sectores) || {};
  const rows = (S.live.cedears || []).filter(r => !r.variant && r.v > 0 && r.monto > 0).sort((a, b) => b.monto - a.monto).slice(0, 150);
  if (!rows.length) { box.innerHTML = head + '<p class="muted">Cargando…</p>'; return; }
  // Tamaño: monto operado "suavizado", para que las más operadas no tapen al resto
  const peso = r => Math.pow(r.monto, 0.45);
  const grupos = {};
  for (const r of rows) (grupos[sect[r.sym] || 'ETFs y otros'] ||= []).push(r);
  const tot = L => L.reduce((s, r) => s + peso(r), 0);
  // Sectores de mayor a menor; los ETFs al final, para que las empresas queden adelante
  const orden = Object.keys(grupos).sort((a, b) => (a === 'ETFs y otros') - (b === 'ETFs y otros') || tot(grupos[b]) - tot(grupos[a]));
  if (!box.querySelector('.tm')) box.innerHTML = head + `<div class="tm"></div>
    <p class="note" style="margin:6px 0 0">Los 150 CEDEARs más operados hoy. Tamaño = monto operado; color = variación del día <b>en dólares</b> (la variación en pesos menos la del CCL).
      Sectores según la actividad que cada empresa declara ante la SEC. Tocá un cuadro para ver su análisis.</p>`;
  const tm = box.querySelector('.tm');
  const W = tm.clientWidth || 800;
  const H = Math.round(Math.max(460, Math.min(760, W * 0.62)) * (W < 600 ? 1.8 : 1));
  tm.style.height = H + 'px';
  // Primero los sectores (con los ETFs aparte, en una franja proporcional abajo) y adentro de cada uno, sus CEDEARs
  const sRects = squarify(orden.map(s => tot(grupos[s])), 0, 0, W, H);
  const HEAD = 17, GAP = 2;
  let html = '';
  orden.forEach((s, si) => {
    const R = sRects[si], L = grupos[s];
    if (!R || R.w < 4 || R.h < 4) return;
    const prom = L.reduce((t, r) => t + (chgUSD(r) || 0) * r.monto, 0) / L.reduce((t, r) => t + r.monto, 0);
    const conTitulo = R.h > 40 && R.w > 60;
    html += `<div class="tm-s" style="left:${R.x}px;top:${R.y}px;width:${R.w}px;height:${R.h}px">`
      + (conTitulo ? `<div class="tm-h" title="${esc(s)}"><span>${esc(s)}</span> <b class="${cls(prom)}">${pct(prom, 1)}</b></div>` : '');
    const ih = R.h - (conTitulo ? HEAD : 0) - GAP, iw = R.w - GAP;
    const tRects = squarify(L.map(peso), 0, 0, iw, ih);
    L.forEach((r, i) => {
      const t = tRects[i];
      if (!t || t.w < 2 || t.h < 2) return;
      const v = chgUSD(r), lado = Math.sqrt(t.w * t.h);
      const fs = Math.max(9, Math.min(18, lado / 5.5));
      const sym = t.w > fs * r.sym.length * 0.62 && t.h > fs + 2, num = sym && t.h > fs * 2.3;
      html += `<div class="ht${Math.abs(v || 0) < 0.012 ? ' ht-l' : ''}" data-key="cedears:${esc(r.sym)}" style="left:${t.x + 1}px;top:${t.y + (conTitulo ? HEAD : 0) + 1}px;width:${Math.max(0, t.w - GAP)}px;height:${Math.max(0, t.h - GAP)}px;background:${heatColor(v)};font-size:${fs.toFixed(1)}px"
        title="${esc(r.sym)}: ${pct(v, 2)} en dólares hoy · operado $ ${compact(r.monto)}">${sym ? `<b>${esc(r.sym)}</b>` : ''}${num ? `<span>${pct(v, 1)}</span>` : ''}</div>`;
    });
    html += '</div>';
  });
  tm.innerHTML = html;
}
let heatResize;
window.addEventListener('resize', () => { clearTimeout(heatResize); heatResize = setTimeout(() => { if (S.tab === 'cedears') renderHeatBox(); }, 250); });
document.addEventListener('click', e => {
  const t = e.target.closest('#heatBox [data-key]');
  if (t) openDetail(t.dataset.key);
});

/* ============================================================
   Descargar la tabla a Excel (CSV que Excel abre directo)
   ============================================================ */
function descargarTabla() {
  const ths = [...document.querySelectorAll('#tbl thead th')];
  const skip = new Set(['c-fav', 'c-spark', 'c-r52']);
  const idx = ths.map((th, i) => [...th.classList].some(c => skip.has(c)) ? -1 : i).filter(i => i >= 0);
  const q = s => /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  const lineas = [idx.map(i => q(ths[i].textContent.replace(/[▲▼]/g, '').trim())).join(';')];
  for (const tr of document.querySelectorAll('#tbl tbody tr[data-key]')) {
    const tds = tr.children;
    lineas.push(idx.map(i => q((tds[i] ? tds[i].innerText : '').replace(/\s+/g, ' ').trim())).join(';'));
  }
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `panel-${S.tab}-${today()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function afterTab(tab) { renderCurveBox(); renderCarryBox(); renderHeatBox(); renderNews(); }
function afterRefresh() { curveCache = null; renderCurveBox(); renderCarryBox(); renderHeatBox(); renderMktBar(); checkAlerts(); }
function afterInit() { checkAlerts(); }

setupStrategyBacktest();
setupMktBar();
setupAlerts();
loadNews();
checkImportHash();
setupCloud();

/* ============================================================
   Modo día / noche y fecha en la cabecera
   ============================================================ */
function setupTema() {
  const sub = document.querySelector('.brand .sub');
  if (sub) sub.textContent = new Date((SNAP && SNAP.time) || Date.now()).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const btn = document.createElement('button');
  btn.id = 'btnTema';
  const pintar = () => {
    const osc = document.documentElement.dataset.theme === 'dark';
    btn.innerHTML = osc ? ICON.sun : ICON.moon;
    btn.title = osc ? 'Pasar a modo día' : 'Pasar a modo noche';
  };
  pintar();
  btn.addEventListener('click', () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    store.set('tema', t);
    pintar();
    // Redibuja lo que está en canvas o usa colores calculados
    try { drawChart(); } catch { }
    try { if (typeof drawCurve === 'function') drawCurve(); } catch { }
    try { renderHeatBox(); } catch { }
    try { if (S.tab === 'cartera') renderCartera(); } catch { }
    try { if (curDetail && !$('#detail').hidden) renderDetail(findRow(curDetail.tab + ':' + curDetail.sym), curDetail); } catch { }
  });
  $('#btnParams').before(btn);
}
setupTema();
