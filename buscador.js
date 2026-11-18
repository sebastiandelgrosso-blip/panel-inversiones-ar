'use strict';
/* ============================================================
   Buscador de estrategias
   - Por activo: prueba 167 reglas de compra/venta (7 familias), elige la mejor con la
     parte vieja de la historia ("entrenamiento") y la mide en la parte reciente que
     nunca vio ("validación"), siempre contra comprar y mantener.
   - Rotación: cada fin de mes se queda con los K activos que más subieron en N ruedas.
   Señal al cierre de una rueda, operación al cierre de la siguiente, comisión en cada
   compra y venta. Usa funciones y estado de app.js / extras.js.
   ============================================================ */
const BX = { det: {}, last: null, running: false };

const BX_FAM = {
  'Cruce de medias': 'comprado mientras la media rápida está sobre la lenta',
  'Precio sobre media': 'comprado mientras el precio cierra sobre su media',
  'RSI rebote': 'compra cuando el RSI cae bajo un nivel (sobreventa) y vende cuando sube sobre otro; "+F200" = solo compra si el precio está sobre la media de 200 ruedas',
  'Bollinger rebote': 'compra al cerrar bajo la banda inferior; vende al volver a la media o a la banda superior',
  'Ruptura de canal': 'compra al superar el máximo de N ruedas; vende al perder el mínimo de M ruedas',
  'MACD': 'comprado mientras el MACD está sobre su línea de señal (">0" = además MACD positivo)',
  'Momentum': 'comprado mientras el precio está más alto que hace N ruedas',
};
const BX_CRIT = { sharpe: 'rendimiento / riesgo (Sharpe)', cagr: 'rendimiento anual', calmar: 'rendimiento / peor caída' };

/* ---------------- Indicadores (solo cierres, con memoria) ---------------- */
const bxGt = (a, b) => a != null && b != null && a > b;
const bxLt = (a, b) => a != null && b != null && a < b;
const bxCmp = (a, b) => ok(a) && ok(b) ? (a > b ? '>' : '<') : '?';
const bxF = v => ok(v) ? fmt(v) : '–';

function bxRoll(c, k, f) {
  const o = new Array(c.length).fill(null);
  for (let i = k; i < c.length; i++) { let v = c[i - k]; for (let j = i - k + 1; j < i; j++) v = f(v, c[j]); o[i] = v; }
  return o; // extremo de las k ruedas ANTERIORES (sin la de hoy)
}
function bxInd(c) {
  const m = new Map(), n = c.length;
  const memo = (k, f) => { if (!m.has(k)) m.set(k, f()); return m.get(k); };
  return {
    c, n,
    sma: k => memo('s' + k, () => sma(c, k)),
    ema: k => memo('e' + k, () => { const e = ema(c, k); for (let i = 0; i < Math.min(k - 1, n); i++) e[i] = null; return e; }),
    rsi: k => memo('r' + k, () => rsi(c, k)),
    std: k => memo('d' + k, () => {
      const s = sma(c, k), o = new Array(n).fill(null);
      for (let i = k - 1; i < n; i++) { let q = 0; for (let j = i - k + 1; j <= i; j++) q += (c[j] - s[i]) ** 2; o[i] = Math.sqrt(q / (k - 1)); }
      return o;
    }),
    hi: k => memo('h' + k, () => bxRoll(c, k, Math.max)),
    lo: k => memo('l' + k, () => bxRoll(c, k, Math.min)),
  };
}
const bxIf = (n, f) => { const s = new Uint8Array(n); for (let i = 0; i < n; i++) s[i] = f(i) ? 1 : 0; return s; };
// 1 desde que se cumple la entrada hasta que se cumple la salida (la salida manda)
const bxHold = (n, ent, sal) => { const s = new Uint8Array(n); let st = 0; for (let i = 0; i < n; i++) { if (sal(i)) st = 0; else if (ent(i)) st = 1; s[i] = st; } return s; };

/* ---------------- Catálogo de reglas ---------------- */
function bxCatalog() {
  const R = [], add = (fam, name, run) => R.push({ fam, name, run });
  for (const f of [10, 20, 50]) for (const l of [50, 100, 150, 200]) if (f < l)
    add('Cruce de medias', `Cruce de medias ${f}/${l}`, I => {
      const a = I.sma(f), b = I.sma(l);
      return { sig: bxIf(I.n, i => bxGt(a[i], b[i])), txt: i => `media ${f} ${bxF(a[i])} ${bxCmp(a[i], b[i])} media ${l} ${bxF(b[i])}` };
    });
  for (const k of [20, 50, 100, 150, 200])
    add('Precio sobre media', `Precio > media ${k}`, I => {
      const m = I.sma(k), c = I.c;
      return { sig: bxIf(I.n, i => bxGt(c[i], m[i])), txt: i => `precio ${bxF(c[i])} ${bxCmp(c[i], m[i])} media ${k} ${bxF(m[i])}` };
    });
  const f200 = (I, i) => bxGt(I.c[i], I.sma(200)[i]);
  const t200 = (I, i) => `; precio ${f200(I, i) ? 'sobre' : 'bajo'} la media 200`;
  for (const k of [2, 3, 5, 14]) for (const lo of [5, 10, 20, 30]) for (const hi of [50, 65, 80]) for (const fl of [false, true])
    add('RSI rebote', `RSI ${k} <${lo} → >${hi}${fl ? ' +F200' : ''}`, I => {
      const x = I.rsi(k);
      return {
        sig: bxHold(I.n, i => bxLt(x[i], lo) && (!fl || f200(I, i)), i => bxGt(x[i], hi)),
        txt: i => `RSI ${k} = ${ok(x[i]) ? fmt(x[i], 1) : '–'} (compra <${lo}, vende >${hi})${fl ? t200(I, i) : ''}`,
      };
    });
  for (const k of [10, 20, 30]) for (const z of [1.5, 2, 2.5]) for (const out of ['media', 'banda sup.']) for (const fl of [false, true])
    add('Bollinger rebote', `Bollinger ${k}·${fmt(z, 1)} → ${out}${fl ? ' +F200' : ''}`, I => {
      const m = I.sma(k), sd = I.std(k), c = I.c;
      const inf = i => ok(m[i]) && ok(sd[i]) ? m[i] - z * sd[i] : null, sup = i => ok(m[i]) && ok(sd[i]) ? m[i] + z * sd[i] : null;
      return {
        sig: bxHold(I.n, i => bxLt(c[i], inf(i)) && (!fl || f200(I, i)), i => bxGt(c[i], out === 'media' ? m[i] : sup(i))),
        txt: i => `precio ${bxF(c[i])}; banda inf. ${bxF(inf(i))}, media ${bxF(m[i])}, sup. ${bxF(sup(i))}${fl ? t200(I, i) : ''}`,
      };
    });
  for (const [e, s] of [[20, 10], [55, 10], [55, 20], [55, 50], [100, 10], [100, 20], [100, 50]])
    add('Ruptura de canal', `Ruptura ${e}/${s} ruedas`, I => {
      const h = I.hi(e), l = I.lo(s), c = I.c;
      return { sig: bxHold(I.n, i => bxGt(c[i], h[i]), i => bxLt(c[i], l[i])), txt: i => `precio ${bxF(c[i])}; máx. ${e} ruedas ${bxF(h[i])}, mín. ${s} ruedas ${bxF(l[i])}` };
    });
  for (const [a, b, s] of [[12, 26, 9], [8, 17, 9], [5, 35, 5], [19, 39, 9]]) for (const z of [false, true])
    add('MACD', `MACD ${a}/${b}/${s}${z ? ' >0' : ''}`, I => {
      const ea = I.ema(a), eb = I.ema(b);
      const line = ea.map((v, i) => ok(v) && ok(eb[i]) ? v - eb[i] : null);
      const sg = ema(line, s);
      const okI = i => i >= b + s && ok(line[i]) && ok(sg[i]);
      return { sig: bxIf(I.n, i => okI(i) && line[i] > sg[i] && (!z || line[i] > 0)), txt: i => `MACD ${ok(line[i]) ? fmt(line[i], 3) : '–'} ${bxCmp(line[i], sg[i])} señal ${ok(sg[i]) ? fmt(sg[i], 3) : '–'}` };
    });
  for (const d of [21, 63, 126, 252])
    add('Momentum', `Momentum ${d} ruedas`, I => {
      const c = I.c;
      return { sig: bxIf(I.n, i => i >= d && c[i] > c[i - d]), txt: i => `rendimiento ${d} ruedas ${i >= d ? pct(c[i] / c[i - d] - 1) : '–'}` };
    });
  return R;
}
const BX_RULES = bxCatalog();

/* ---------------- Métricas ---------------- */
function bxAcc(dates) {
  return {
    n: 0, s: 0, s2: 0, eq: 1, pk: 1, mdd: 0, inn: 0, tr: [], t: null, i0: -1, i1: -1,
    add(j, ret, p) {
      if (this.i0 < 0) this.i0 = j;
      this.i1 = j; this.n++; this.s += ret; this.s2 += ret * ret;
      this.eq *= 1 + ret;
      if (this.eq > this.pk) this.pk = this.eq;
      if (this.eq / this.pk - 1 < this.mdd) this.mdd = this.eq / this.pk - 1;
      if (p) this.inn++;
      if (p && this.t === null) this.t = 1;
      if (this.t !== null) { this.t *= 1 + ret; if (!p) { this.tr.push(this.t - 1); this.t = null; } }
    },
    done() {
      if (this.t !== null) { this.tr.push(this.t - 1); this.t = null; }
      if (this.n < 20) return null;
      const yrs = Math.max((Date.parse(dates[this.i1]) - Date.parse(dates[Math.max(0, this.i0 - 1)])) / 864e5 / 365.25, 0.05);
      const mu = this.s / this.n, sd = Math.sqrt(Math.max(this.s2 / this.n - mu * mu, 0));
      const cagr = this.eq > 0 ? Math.pow(this.eq, 1 / yrs) - 1 : -1;
      return {
        cagr, sharpe: sd > 0 ? mu / sd * Math.sqrt(252) : 0, mdd: this.mdd, calmar: this.mdd < 0 ? cagr / -this.mdd : null,
        ops: this.tr.length, win: this.tr.length ? this.tr.filter(x => x > 0).length / this.tr.length : null,
        expo: this.inn / this.n, yrs,
      };
    },
  };
}
// sig[i] = 1 si al cierre i la regla dice "comprado"; se opera al cierre i+1 → rinde desde i+2
function bxEval(sig, c, dates, cost, cut, curve) {
  const A = [bxAcc(dates), bxAcc(dates)], cv = curve ? [] : null;
  let prev = 0, eq = 1, bh = 1;
  for (let j = 2; j < c.length; j++) {
    const p = sig[j - 2], r = c[j] / c[j - 1] - 1;
    const ret = p * r - (p !== prev ? cost : 0);
    A[j < cut ? 0 : 1].add(j, ret, p);
    prev = p;
    if (cv) { eq *= 1 + ret; bh *= 1 + r; if (j % 5 === 0 || j === c.length - 1) cv.push({ d: dates[j], s: eq, b: bh }); }
  }
  return { ent: A[0].done(), val: A[1].done(), curve: cv };
}
function bxHoy(sig) {
  const n = sig.length, h = sig[n - 1], a = sig[n - 2];
  return h && !a ? 'COMPRAR' : !h && a ? 'VENDER' : h ? 'COMPRADO' : 'AFUERA';
}
const BX_SIG_CLS = { COMPRAR: 's-COMPRAR', VENDER: 's-VENDER', COMPRADO: 's-ACUMULAR', AFUERA: 's-MANTENER' };
const bxSig = s => `<span class="sig ${BX_SIG_CLS[s] || 's-ERR'}">${s}</span>`;
const bxScore = (m, k) => m && ok(m[k]) ? m[k] : -1e9;

/* ---------------- Opciones actuales ---------------- */
function bxOpts() {
  const crit = ($('#bxCrit') && $('#bxCrit').value) || 'sharpe';
  const train = +(($('#bxTrain') && $('#bxTrain').value) || 0.7);
  return { crit, train, minOps: 6, cost: (S.params.comision || 0) / 100, sig: [crit, train, S.params.comision, S.params.moneda].join('|') };
}

/* ---------------- Un activo ---------------- */
function bxAnalyze(a, opt) {
  const key = a.tab + ':' + a.sym, hit = BX.det[key];
  if (hit && hit.sig === opt.sig && hit.rows === a.rows) return hit;
  const rows = a.rows, n = rows.length;
  if (n < 500) return (BX.det[key] = { sig: opt.sig, rows, err: `historia corta (${n} ruedas; hacen falta ~2 años)` });
  const c = rows.map(r => r.c), dates = rows.map(r => r.d);
  const I = bxInd(c), cut = Math.floor(n * opt.train);
  const bh = bxEval(new Uint8Array(n).fill(1), c, dates, 0, cut);
  const all = BX_RULES.map((R, ix) => {
    const o = R.run(I), e = bxEval(o.sig, c, dates, opt.cost, cut);
    return { ix, R, txt: o.txt, ent: e.ent, val: e.val, hoy: bxHoy(o.sig) };
  });
  const valid = all.filter(x => x.ent && x.val && x.ent.ops >= opt.minOps)
    .sort((x, y) => bxScore(y.ent, opt.crit) - bxScore(x.ent, opt.crit));
  return (BX.det[key] = { sig: opt.sig, rows, key, a, I, c, dates, n, cut, bh, all, valid, best: valid[0] || null, crit: opt.crit, cost: opt.cost });
}

/* ---------------- Rotación entre activos ---------------- */
function bxRotacion(list, opt) {
  const all = [...new Set(list.flatMap(x => x.rows.map(r => r.d)))].sort();
  const N = all.length, M = list.length;
  if (M < 4 || N < 500) return null;
  const at = new Map(all.map((d, i) => [d, i]));
  const C = list.map(x => {
    const a = new Float64Array(N).fill(NaN);
    for (const r of x.rows) a[at.get(r.d)] = r.c;
    let lv = NaN; for (let i = 0; i < N; i++) { if (isNaN(a[i])) a[i] = lv; else lv = a[i]; }
    return a;
  });
  const R = C.map(a => { const r = new Float64Array(N); for (let i = 1; i < N; i++) r[i] = a[i] > 0 && a[i - 1] > 0 ? a[i] / a[i - 1] - 1 : 0; return r; });
  const fin = []; for (let j = 0; j < N - 1; j++) if (all[j].slice(0, 7) !== all[j + 1].slice(0, 7)) fin.push(j);
  const cut = Math.floor(N * opt.train);
  const pick = (j, L, K, abs) => {
    const sc = [];
    for (let m = 0; m < M; m++) { const a = C[m][j], b = C[m][j - L]; if (a > 0 && b > 0) { const s = a / b - 1; if (!abs || s > 0) sc.push([m, s]); } }
    return sc.sort((x, y) => y[1] - x[1]).slice(0, K);
  };
  // Referencia: todos los activos por partes iguales (sin comisión)
  const bench = () => {
    const A = [bxAcc(all), bxAcc(all)];
    for (let t = 1; t < N; t++) {
      let s = 0, k = 0;
      for (let m = 0; m < M; m++) if (C[m][t - 1] > 0) { s += R[m][t]; k++; }
      A[t < cut ? 0 : 1].add(t, k ? s / k : 0, k ? 1 : 0);
    }
    return { ent: A[0].done(), val: A[1].done() };
  };
  const run = (L, K, abs, withCurve) => {
    const A = [bxAcc(all), bxAcc(all)], w = new Float64Array(M), cv = withCurve ? [] : null;
    let next = null, act = -1, fi = 0, eq = 1, beq = 1, cambios = 0;
    for (let t = 1; t < N; t++) {
      let ret = 0;
      if (next && t >= act) {
        let to = 0; for (let m = 0; m < M; m++) { to += Math.abs(next[m] - w[m]); w[m] = next[m]; }
        if (to > 1e-9) cambios++;
        ret -= to * opt.cost; next = null;
      }
      let inv = 0;
      for (let m = 0; m < M; m++) if (w[m]) { ret += w[m] * R[m][t]; inv = 1; }
      A[t < cut ? 0 : 1].add(t, ret, inv);
      if (cv) {
        let s = 0, k = 0; for (let m = 0; m < M; m++) if (C[m][t - 1] > 0) { s += R[m][t]; k++; }
        eq *= 1 + ret; beq *= 1 + (k ? s / k : 0);
        if (t % 5 === 0 || t === N - 1) cv.push({ d: all[t], s: eq, b: beq });
      }
      while (fi < fin.length && fin[fi] < t) fi++;
      if (fin[fi] === t && t >= L) {
        next = new Float64Array(M);
        pick(t, L, K, abs).forEach(([m]) => next[m] = 1 / K);
        act = t + 2;
      }
    }
    return { L, K, abs, ent: A[0].done(), val: A[1].done(), curve: cv, cambios };
  };
  const grid = [];
  // Mínimo 3 activos: quedarse con uno solo es apostar, no rotar
  for (const L of [63, 126, 252]) for (const K of [3, 5, 8]) for (const abs of [false, true])
    if (K < M) { const r = run(L, K, abs); if (r.ent && r.val) grid.push(r); }
  if (!grid.length) return null;
  grid.sort((x, y) => bxScore(y.ent, opt.crit) - bxScore(x.ent, opt.crit));
  const g = grid[0], best = run(g.L, g.K, g.abs, true);
  const hoy = pick(N - 1, g.L, g.K, g.abs).map(([m, s]) => ({ row: list[m].row, s }));
  return { best, grid, bench: bench(), hoy, cutD: all[cut], d0: all[0], d1: all[N - 1], M };
}
const bxRotName = g => `Top ${g.K} por suba de ${g.L} ruedas${g.abs ? ', solo si suben' : ''}`;

/* ---------------- Pestaña "Buscador" ---------------- */
function bxView() {
  const sec = $('#viewBuscador');
  if (sec.dataset.ready) return;
  sec.dataset.ready = '1';
  sec.innerHTML = `
    <h1>Buscador de estrategias</h1>
    <p class="lead">Prueba <b>${BX_RULES.length} reglas de compra y venta</b> en cada activo (7 familias con distintos parámetros) y una
      <b>rotación mensual</b> entre activos. Para no engañarse con reglas que solo "calzan" con el pasado, cada regla se elige con la
      parte vieja de la historia (<i>entrenamiento</i>) y se mide en la parte reciente que nunca vio (<i>validación</i>), siempre contra comprar y mantener.</p>
    <div class="toolbar">
      <label>Activos <select id="bxUni">
        <option value="lider">Panel líder (acciones AR)</option>
        <option value="cedears">CEDEARs: los 30 más operados</option>
        <option value="acciones">Todas las acciones AR con historia</option>
        <option value="favoritos">★ Favoritos</option>
      </select></label>
      <label>Elegir la regla por <select id="bxCrit">
        ${Object.entries(BX_CRIT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
      </select></label>
      <label>Validación <select id="bxTrain">
        <option value="0.7">último 30% de la historia</option>
        <option value="0.6">último 40% de la historia</option>
      </select></label>
      <button id="bxRun" class="primary">Buscar estrategias</button>
    </div>
    <div id="bxOut"><p class="muted">Elegí los activos y tocá <b>Buscar estrategias</b>. Usa la comisión y la moneda de ⚙ Parámetros
      (ahora: ${fmt(S.params.comision, 2)}% por operación, ${S.params.moneda === 'USD' ? 'en dólares CCL' : 'en pesos'}).</p></div>`;
  $('#bxRun').addEventListener('click', bxRunAll);
  sec.addEventListener('click', async e => {
    const tr = e.target.closest('tr[data-bxkey]');
    if (!tr) return;
    await openDetail(tr.dataset.bxkey);
    bxRenderDetail();
  });
}

async function bxUniverse(u) {
  await Promise.all([loadLive('acciones'), loadLive('cedears')]);
  const base = r => r && !r.variant && (r.tab === 'acciones' || r.tab === 'cedears');
  if (u === 'lider') return (S.live.acciones || []).filter(r => base(r) && LIDER.has(r.sym));
  if (u === 'acciones') return (S.live.acciones || []).filter(base);
  if (u === 'cedears') return (S.live.cedears || []).filter(r => base(r) && r.v > 0).sort((a, b) => b.monto - a.monto).slice(0, 30);
  return [...S.fav].map(findRow).filter(base);
}

async function bxRunAll() {
  if (BX.running) return;
  const out = $('#bxOut'), btn = $('#bxRun');
  BX.running = true; btn.disabled = true;
  try {
    const opt = bxOpts(), uni = $('#bxUni').value;
    out.innerHTML = '<p class="muted">Cargando históricos…</p>';
    const rows = await bxUniverse(uni);
    if (!rows.length) { out.innerHTML = `<p class="muted">${uni === 'favoritos' ? 'No tenés acciones ni CEDEARs en favoritos (marcalos con ★).' : 'No hay activos para probar.'}</p>`; return; }
    await analyzeMany(rows, { front: true });
    const list = [], fallan = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], a = S.an[r.tab + ':' + r.sym];
      out.innerHTML = `<p class="muted">Probando reglas: ${i + 1} de ${rows.length} (${esc(r.sym)})…</p>`;
      progress((i + 1) / rows.length);
      await new Promise(res => setTimeout(res, 0));
      if (!a || a.err || !a.rows) { fallan.push(`${r.sym}: ${a && a.err || 'sin datos'}`); continue; }
      const res = bxAnalyze(a, opt);
      if (res.err || !res.best) { fallan.push(`${r.sym}: ${res.err || 'ninguna regla con suficientes operaciones'}`); continue; }
      list.push({ row: r, res });
    }
    out.innerHTML = '<p class="muted">Probando la rotación entre activos…</p>';
    await new Promise(res => setTimeout(res, 0));
    const rot = bxRotacion(list.map(x => ({ row: x.row, rows: x.res.rows })), opt);
    BX.last = { list, rot, opt, uni, fallan };
    bxRenderAll();
  } catch (e) {
    out.innerHTML = `<p class="muted">Error: ${esc(e.message || e)}</p>`;
  } finally {
    BX.running = false; btn.disabled = false; progress(null);
  }
}

const bxKv = (k, v, sub) => `<div class="kv"><div class="k">${k}</div><div class="v">${v}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;
const bxP = (x, d = 1) => `<span class="${cls(x)}">${pct(x, d)}</span>`;

function bxRenderAll() {
  const { list, rot, opt, fallan } = BX.last, out = $('#bxOut');
  if (!list.length) { out.innerHTML = `<p class="muted">Ningún activo tenía historia suficiente.</p>${fallan.length ? `<p class="note">${esc(fallan.join(' · '))}</p>` : ''}`; return; }
  const N = list.length;
  const v = x => x.res.best.val, b = x => x.res.bh.val;
  const ganaC = list.filter(x => v(x).cagr > b(x).cagr).length;
  const ganaS = list.filter(x => v(x).sharpe > b(x).sharpe).length;
  const menosC = list.filter(x => v(x).mdd > b(x).mdd).length;
  const med = a => { const s = a.filter(ok).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const cut0 = list[0].res.dates[list[0].res.cut];

  // Familias: mejor regla de cada familia (elegida en entrenamiento), medida en validación
  const fams = Object.keys(BX_FAM).map(f => {
    const sel = list.map(x => ({ x, g: x.res.valid.find(y => y.R.fam === f) })).filter(o => o.g);
    return {
      f, n: sel.length,
      sh: med(sel.map(o => o.g.val.sharpe)), cg: med(sel.map(o => o.g.val.cagr)), ex: med(sel.map(o => o.g.val.expo)),
      gc: sel.filter(o => o.g.val.cagr > o.x.res.bh.val.cagr).length,
      gs: sel.filter(o => o.g.val.sharpe > o.x.res.bh.val.sharpe).length,
      gd: sel.filter(o => o.g.val.mdd > o.x.res.bh.val.mdd).length,
    };
  }).filter(o => o.n);
  const bhSh = med(list.map(x => b(x).sharpe)), bhCg = med(list.map(x => b(x).cagr));

  const sorted = [...list].sort((x, y) => (v(y).cagr - b(y).cagr) - (v(x).cagr - b(x).cagr));
  const nuevas = list.filter(x => x.res.best.hoy === 'COMPRAR' || x.res.best.hoy === 'VENDER');

  let rotHTML = '';
  if (rot) {
    const g = rot.best, be = rot.bench;
    const gana = g.val.cagr > be.val.cagr, menos = g.val.mdd > be.val.mdd;
    rotHTML = `
      <h2>Rotación entre activos (momentum de cartera)</h2>
      <p>Cada fin de mes se queda con los que más subieron y vende el resto. Se probaron ${rot.grid.length} combinaciones sobre estos ${rot.M} activos;
        la elegida en entrenamiento fue <b>${bxRotName(g)}</b>. Se compara con tener todos por partes iguales.</p>
      <div class="plan">
        ${bxKv('Rotación · validación', bxP(g.val.cagr), `anual · Sharpe ${fmt(g.val.sharpe, 2)}`)}
        ${bxKv('Todos por igual · validación', bxP(be.val.cagr), `anual · Sharpe ${fmt(be.val.sharpe, 2)}`)}
        ${bxKv('Peor caída rotación', `<span class="down">${pct(g.val.mdd, 0)}</span>`, `vs ${pct(be.val.mdd, 0)} todos por igual`)}
        ${bxKv('Entrenamiento', bxP(g.ent.cagr), `vs ${pct(be.ent.cagr)} todos por igual`)}
        ${bxKv('Si rebalanceás hoy', rot.hoy.length ? rot.hoy.map(h => `<b>${esc(h.row.sym)}</b> <small>${pct(h.s, 0)}</small>`).join('<br>') : '<span class="muted">liquidez (nada sube)</span>', '')}
      </div>
      <div class="chartbox"><div class="ctrl"><span class="muted" style="font-size:12px">${rot.d0} → ${rot.d1} · validación desde ${rot.cutD}</span>
        <span class="legend"><span><i style="background:#4ea1ff"></i>Rotación</span><span><i style="background:#8b98a8"></i>Todos por igual</span></span></div>
        <canvas id="bxRotChart" style="width:100%;height:220px;display:block"></canvas></div>
      <p class="note">${gana ? '✓ En validación la rotación rindió más que tener todos por igual' : '✗ En validación la rotación rindió menos que tener todos por igual'}${menos ? ', con caídas más chicas.' : '.'}
        Simplificaciones: se rebalancea a partes iguales entre los elegidos, la plata sin asignar no rinde interés y la comisión se cobra sobre lo que cambia.
        Ojo: los activos se eligen por lo que más se opera <i>hoy</i>, y eso infla los resultados del pasado (quedan afuera los que se hundieron).</p>
      <details class="curvebox"><summary>Ver las 5 mejores combinaciones de entrenamiento</summary>
        <div class="bxwrap"><table class="simple bxt">
          <tr><th>Combinación</th><th>Entrenamiento</th><th>Validación</th><th>Caída val.</th><th>Sharpe val.</th></tr>
          ${rot.grid.slice(0, 5).map(r => `<tr><td>${bxRotName(r)}</td><td>${bxP(r.ent.cagr)}</td><td>${bxP(r.val.cagr)}</td><td>${pct(r.val.mdd, 0)}</td><td>${fmt(r.val.sharpe, 2)}</td></tr>`).join('')}
        </table></div></details>`;
  }

  out.innerHTML = `
    <div class="plan" style="margin-top:12px">
      ${bxKv('Activos probados', N, `${N * BX_RULES.length} pruebas`)}
      ${bxKv('Le ganó a mantener', `${ganaC} de ${N}`, 'en rendimiento (validación)')}
      ${bxKv('Mejor rendimiento/riesgo', `${ganaS} de ${N}`, 'Sharpe mayor que mantener')}
      ${bxKv('Con menos caída', `${menosC} de ${N}`, 'peor caída más chica')}
      ${bxKv('Señales nuevas hoy', nuevas.length, nuevas.map(x => esc(x.row.sym)).join(', ') || 'ninguna')}
    </div>
    <p class="note">Regla elegida por <b>${BX_CRIT[opt.crit]}</b> en entrenamiento y medida en validación (desde ~${cut0}).
      ${ganaC < N / 2 ? 'En la mayoría de los activos la mejor regla del pasado <b>no</b> le ganó a comprar y mantener en el período que no vio: es lo habitual, y es justamente lo que este buscador sirve para detectar.' : 'En la mayoría de los activos la regla elegida siguió funcionando en el período que no vio.'}
      ${menosC > N / 2 ? ' Donde más ayudan estas reglas es en <b>reducir las caídas</b>.' : ''}</p>
    ${rotHTML}
    <h2>¿Qué familia de reglas aguanta en datos nuevos?</h2>
    <div class="bxwrap"><table class="simple bxt">
      <tr><th>Familia</th><th>Rinde anual (val.)</th><th>Sharpe (val.)</th><th>Tiempo invertido</th><th>Le gana a mantener</th><th>Mejor Sharpe</th><th>Menos caída</th></tr>
      ${fams.map(o => `<tr><td><b>${o.f}</b></td><td>${bxP(o.cg)}</td><td>${fmt(o.sh, 2)}</td><td>${pct(o.ex, 0, false)}</td>
        <td>${o.gc}/${o.n}</td><td>${o.gs}/${o.n}</td><td>${o.gd}/${o.n}</td></tr>`).join('')}
      <tr><td class="muted">Comprar y mantener</td><td>${bxP(bhCg)}</td><td>${fmt(bhSh, 2)}</td><td>100%</td><td></td><td></td><td></td></tr>
    </table></div>
    <p class="note">Mediana entre activos de la mejor regla de cada familia (elegida en entrenamiento).</p>
    <h2>Mejor regla por activo</h2>
    <div class="bxwrap"><table class="simple bxt bxclick">
      <tr><th>Activo</th><th>Hoy</th><th>Regla elegida</th><th>Rinde estrategia</th><th>Rinde mantener</th><th>Caída estr.</th><th>Caída mant.</th><th>Sharpe</th><th>Ops</th><th></th></tr>
      ${sorted.map(x => {
        const g = x.res.best, bv = b(x), gana = g.val.cagr > bv.cagr;
        return `<tr data-bxkey="${esc(x.row.tab + ':' + x.row.sym)}"><td><b>${esc(x.row.sym)}</b> <span class="muted">${TAB_LABEL[x.row.tab]}</span></td>
          <td>${bxSig(g.hoy)}</td><td>${esc(g.R.name)}</td>
          <td>${bxP(g.val.cagr)}</td><td>${bxP(bv.cagr)}</td>
          <td>${pct(g.val.mdd, 0)}</td><td>${pct(bv.mdd, 0)}</td>
          <td>${fmt(g.val.sharpe, 2)} <span class="muted">vs ${fmt(bv.sharpe, 2)}</span></td><td>${g.val.ops}</td>
          <td title="${gana ? 'le ganó a mantener en validación' : 'no le ganó a mantener en validación'}">${gana ? '<span class="up">✓</span>' : '<span class="down">✗</span>'}</td></tr>`;
      }).join('')}
    </table></div>
    <p class="note">Rendimientos anuales del período de validación${S.params.moneda === 'USD' ? ', en dólares' : ', en pesos'}, con comisión de ${fmt(S.params.comision, 2)}% por operación.
      Tocá un activo para ver sus 10 mejores reglas y la curva. <b>Hoy</b>: COMPRAR / VENDER = la regla cambió de estado con el último precio;
      COMPRADO / AFUERA = sigue igual.${fallan.length ? `<br>Sin probar: ${esc(fallan.join(' · '))}.` : ''}</p>
    <h2>Las reglas</h2>
    <ul>${Object.entries(BX_FAM).map(([k, t]) => `<li><b>${k}:</b> ${t}.</li>`).join('')}</ul>
    <p class="note">Cómo se simula: la señal sale con el cierre de una rueda y se opera al cierre de la siguiente (sin mirar el futuro).
      Se elige con un mínimo de 6 operaciones en entrenamiento. Al probar tantas reglas, la mejor del pasado casi siempre parece mejor de lo que es:
      por eso lo que vale es la columna de validación.</p>
    <p class="disclaimer">Herramienta educativa. No es asesoramiento financiero. Resultados pasados no garantizan resultados futuros.</p>`;
  if (rot) lineChart($('#bxRotChart'), [
    { y: rot.best.curve.map(p => p.b), color: '#8b98a8' },
    { y: rot.best.curve.map(p => p.s), color: '#4ea1ff' },
  ], { labels: rot.best.curve.map(p => p.d) });
}

/* ---------------- Detalle de un activo ---------------- */
function bxDetailHTML(row) {
  if (!row || (row.tab !== 'acciones' && row.tab !== 'cedears')) return '';
  const cached = BX.det[row.tab + ':' + row.sym];
  if (cached && !cached.err) setTimeout(() => bxRenderDetail(), 0);
  return `<h4>Buscador de estrategias: ¿qué regla le funcionó a ${esc(row.sym)}?</h4>
    <div id="bxBox"><button id="btnBx" class="primary">Probar ${BX_RULES.length} reglas en ${esc(row.sym)}</button>
      <span class="muted" style="font-size:12px">Elige con la historia vieja y valida con la reciente.</span></div>`;
}

function bxRenderDetail(ruleIx) {
  const box = $('#bxBox'), a = curDetail;
  if (!box || !a) return;
  const opt = bxOpts(), res = bxAnalyze(a, opt);
  if (res.err) { box.innerHTML = `<p class="muted">No se puede: ${esc(res.err)}.</p>`; return; }
  if (!res.best) { box.innerHTML = '<p class="muted">Ninguna regla hizo suficientes operaciones en entrenamiento.</p>'; return; }
  const sel = ruleIx != null ? res.all[ruleIx] : res.best;
  const o = sel.R.run(res.I), e = bxEval(o.sig, res.c, res.dates, res.cost, res.cut, true);
  const bh = res.bh.val, gana = sel.val.cagr > bh.cagr;
  const top = res.valid.slice(0, 10);
  box.innerHTML = `
    <div class="reco" style="border-left-color:${gana ? 'var(--up)' : 'var(--warn)'}">
      <h3>${sel === res.best ? 'Regla elegida' : 'Regla'}: ${esc(sel.R.name)} ${bxSig(sel.hoy)}</h3>
      <ul>
        <li>${esc(BX_FAM[sel.R.fam])}.</li>
        <li>Con el último precio: ${esc(sel.txt(res.n - 1))}.</li>
        <li>Validación (${res.dates[res.cut]} → ${res.dates[res.n - 1]}): ${pct(sel.val.cagr)} anual contra ${pct(bh.cagr)} de comprar y mantener;
          peor caída ${pct(sel.val.mdd, 0)} contra ${pct(bh.mdd, 0)}. ${gana ? '<b class="up">Le ganó a mantener.</b>' : '<b class="down">No le ganó a mantener.</b>'}</li>
      </ul>
    </div>
    <div class="chartbox"><div class="ctrl"><span class="muted" style="font-size:12px">Toda la historia · validación desde ${res.dates[res.cut]}</span>
      <span class="legend"><span><i style="background:#4ea1ff"></i>Regla</span><span><i style="background:#8b98a8"></i>Comprar y mantener</span></span></div>
      <canvas id="bxChart" style="width:100%;height:200px;display:block"></canvas></div>
    <div class="bxwrap"><table class="simple bxt bxclick" style="font-size:12px">
      <tr><th>Regla (mejores en entrenamiento)</th><th>Entren.</th><th>Validación</th><th>Caída val.</th><th>Sharpe val.</th><th>Ops</th><th>Hoy</th></tr>
      <tr class="muted"><td>Comprar y mantener</td><td>${pct(res.bh.ent.cagr)}</td><td>${pct(bh.cagr)}</td><td>${pct(bh.mdd, 0)}</td><td>${fmt(bh.sharpe, 2)}</td><td></td><td></td></tr>
      ${top.map(x => `<tr data-bxr="${x.ix}" class="${x === sel ? 'sel' : ''}"><td>${esc(x.R.name)}</td><td>${bxP(x.ent.cagr)}</td><td>${bxP(x.val.cagr)}</td>
        <td>${pct(x.val.mdd, 0)}</td><td>${fmt(x.val.sharpe, 2)}</td><td>${x.val.ops}</td><td>${bxSig(x.hoy)}</td></tr>`).join('')}
    </table></div>
    <p class="note">Ordenadas por ${BX_CRIT[res.crit]} en entrenamiento (${res.dates[0]} → ${res.dates[res.cut]}); rendimientos anuales${a.cur === 'USD' ? ' en dólares' : ' en pesos'},
      con comisión de ${fmt(S.params.comision, 2)}% por operación. Tocá una regla para ver su curva. No es asesoramiento financiero.</p>`;
  lineChart($('#bxChart'), [
    { y: e.curve.map(p => p.b), color: '#8b98a8' },
    { y: e.curve.map(p => p.s), color: '#4ea1ff' },
  ], { labels: e.curve.map(p => p.d) });
}

$('#detail').addEventListener('click', e => {
  if (e.target.id === 'btnBx' && curDetail) {
    $('#bxBox').innerHTML = '<p class="muted">Probando reglas…</p>';
    setTimeout(() => bxRenderDetail(), 0);
  }
  const tr = e.target.closest('tr[data-bxr]');
  if (tr && curDetail) bxRenderDetail(+tr.dataset.bxr);
});
