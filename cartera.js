'use strict';
/* ============================================================
   Mi cartera  +  Seguir carteras públicas (13F)
   Usa las funciones y el estado (S) definidos en app.js
   ============================================================ */

S.cartera = store.get('cartera', []);
S.seguidas = store.get('seguidas', {});     // id -> fecha desde que se sigue
S.publicas = null;                          // carteras.json
S.perf = {};                                // id -> rendimiento calculado
const saveCartera = () => store.set('cartera', S.cartera);
const FI = tab => tab === 'bonos' || tab === 'ons';   // renta fija: cantidad en VN, precio cada 100

/* ---------- Precios de una fila en pesos y en dólares ---------- */
function pxARS(r) {
  if (!r) return null;
  if (r.variant) return r.c * (r.variant === 'C' ? currentCCL() : (S.fx.bolsa || currentCCL()));
  return r.c;
}
function pxUSD(r) {
  if (!r) return null;
  if (r.variant) return r.c;
  if (FI(r.tab) && r.usdD) return r.usdD;
  return r.c / (currentCCL() || NaN);
}
function cclAt(date) {
  const s = S.cclSeries;
  if (!s || !date) return null;
  let v = null;
  for (const x of s) { if (x.d <= date) v = x.v; else break; }
  return v;
}

/* ---------- Recomendación por posición: combina señal + resultado ---------- */
function posAdvice(res, A, B, stopTxt) {
  if (!A) {
    if (B) return { t: `Renta fija: ${tirLabel(B, 1)}${B.kind === 'usd' ? ' en US$' : ''}. Mantener hasta el vencimiento si el emisor es confiable.`, c: 'MANTENER' };
    return { t: 'Sin análisis técnico disponible.', c: null };
  }
  const g = ok(res) && Math.abs(res) < 0.01 ? null : res; // recién comprada: no se habla de ganancia/pérdida
  const stop = stopTxt ? ` Stop de referencia: ${stopTxt}.` : '';
  switch (A.signal) {
    case 'COMPRAR':
    case 'ACUMULAR':
      if (ok(g) && g > 0.5 && A.R >= S.params.rsiOB) return { t: `Ganás ${pct(g, 0)} y está sobrecomprada: tomá una parte (20–30%) y dejá correr el resto.${stop}`, c: A.signal };
      return { t: ok(g) && g < 0 ? `Tendencia a favor aunque vas ${pct(g, 0)}: mantener; sumar solo en retrocesos.${stop}` : `Tendencia a favor: mantener y sumar en retrocesos.${stop}`, c: A.signal };
    case 'MANTENER':
      return { t: `Sin ventaja clara: mantener con stop.${stop}`, c: 'MANTENER' };
    case 'REDUCIR':
      return { t: ok(g) && g > 0 ? `Ganás ${pct(g, 0)} pero la tendencia se debilita: asegurá ganancia vendiendo 30–50%.${stop}`
        : ok(g) ? `Tendencia débil y vas ${pct(g, 0)}: reducí exposición; si pierde el stop, salir.${stop}`
        : `Tendencia débil: no conviene agrandar la posición; si pierde el stop, salir.${stop}`, c: 'REDUCIR' };
    default:
      return { t: ok(g) && g > 0 ? `Tendencia bajista: vendé y asegurá la ganancia de ${pct(g, 0)}.`
        : ok(g) ? `Tendencia bajista y vas ${pct(g, 0)}: cortá la pérdida, no promedies a la baja.`
        : `Tendencia bajista: la estrategia no la compraría hoy. Si la querés igual, posición chica y stop corto.${stop}`, c: 'VENDER' };
  }
}

/* ---------- Cálculo de cada posición ---------- */
function posCalc(p) {
  const r = findRow(p.tab + ':' + p.sym);
  const f = FI(p.tab) ? 1 / 100 : 1;
  const nowCur = r ? (p.cur === 'USD' ? pxUSD(r) : pxARS(r)) : null;
  const valARS = r ? p.qty * pxARS(r) * f : null, valUSD = r ? p.qty * pxUSD(r) * f : null;
  const cost = p.qty * p.px * f;
  const res = ok(nowCur) ? nowCur / p.px - 1 : null;
  // Resultado en dólares: el costo en pesos se pasa al CCL del día de compra
  let resUSD = null;
  if (p.cur === 'USD') resUSD = res;
  else if (p.fecha && ok(valUSD)) { const c = cclAt(p.fecha); if (c) resUSD = valUSD / (cost / c) - 1; }
  const A = r ? an(r) : null, B = r ? bondInfo(r) : null;
  // El stop del análisis está en la moneda analizada (US$): se lleva a la moneda de la posición
  let stopTxt = null;
  if (A && ok(A.stop) && ok(nowCur) && A.px > 0) {
    const scaled = A.stop * nowCur / A.px;
    stopTxt = (p.cur === 'USD' ? 'US$ ' : '$ ') + fmt(scaled);
  }
  return { p, r, valARS, valUSD, cost, res, resUSD, A, B, adv: posAdvice(res, A, B, stopTxt) };
}

/* ============================================================
   Vista: Mi cartera
   ============================================================ */
async function renderCartera() {
  const v = $('#viewCartera');
  const tabs = [...new Set(S.cartera.map(p => p.tab).concat(['acciones', 'cedears']))];
  v.innerHTML = '<p class="muted">Cargando cotizaciones…</p>';
  try { await Promise.all(tabs.map(t => loadLive(t))); } catch { }
  try { await loadCCL(); } catch { }
  drawCartera();
  // Analiza las posiciones que todavía no tienen señal
  const pend = S.cartera.map(p => findRow(p.tab + ':' + p.sym)).filter(r => r && r.tab !== 'ons' && !S.an[r.tab + ':' + r.sym]);
  if (pend.length) { await analyzeMany(pend, { front: true }); if (S.tab === 'cartera') drawCartera(); }
}

function drawCartera() {
  const v = $('#viewCartera');
  const rows = S.cartera.map(posCalc);
  const totARS = rows.reduce((s, x) => s + (x.valARS || 0), 0);
  const totUSD = rows.reduce((s, x) => s + (x.valUSD || 0), 0);
  const costARS = rows.filter(x => x.p.cur === 'ARS').reduce((s, x) => s + x.cost, 0);
  const valARSofARS = rows.filter(x => x.p.cur === 'ARS').reduce((s, x) => s + (x.valARS || 0), 0);
  const withUSD = rows.filter(x => ok(x.resUSD) && ok(x.valUSD));
  const resUSDtot = withUSD.length ? withUSD.reduce((s, x) => s + x.valUSD, 0) / withUSD.reduce((s, x) => s + x.valUSD / (1 + x.resUSD), 0) - 1 : null;

  // Distribución por tipo y alertas
  const byTab = {};
  rows.forEach(x => byTab[x.p.tab] = (byTab[x.p.tab] || 0) + (x.valARS || 0));
  const COL = { acciones: '#4ea1ff', cedears: '#b48ef0', bonos: '#2fbf71', ons: '#e8b339' };
  const alerts = [];
  rows.forEach(x => { if (totARS && x.valARS / totARS > 0.25) alerts.push(`${x.p.sym} pesa ${pct(x.valARS / totARS, 0, false)} de la cartera: mucha concentración en un solo activo (ideal: menos de 20–25%).`); });
  const sells = rows.filter(x => x.A && (x.A.signal === 'VENDER' || x.A.signal === 'REDUCIR'));
  if (sells.length) alerts.push(`${sells.length} posición(es) con señal de reducir o vender: ${sells.map(x => x.p.sym).join(', ')}.`);
  if (rows.length && rows.length < 5) alerts.push('Menos de 5 posiciones: considerá diversificar entre más activos y sectores.');
  if (totARS && (byTab.bonos || 0) + (byTab.ons || 0) === 0 && rows.length) alerts.push('No tenés renta fija: bonos u ONs en dólares bajan la volatilidad de la cartera.');

  const card = (k, val, sub, c = '') => `<div class="kv"><div class="k">${k}</div><div class="v ${c}">${val}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;
  const all = ['acciones', 'cedears', 'bonos', 'ons'].flatMap(t => (S.live[t] || []).map(r => `<option value="${esc(r.sym)}">${TAB_LABEL[t]}</option>`)).join('');

  v.innerHTML = `
    <h2 class="vt">Mi cartera</h2>
    <p class="muted">Cargá lo que tenés y el panel te dice cómo va cada posición y qué sugiere la estrategia.</p>
    ${typeof syncBlock === 'function' ? syncBlock() : ''}
    <div class="plan">
      ${card('Valor total', '$ ' + fmt(totARS, 0), 'US$ ' + fmt(totUSD, 0))}
      ${card('Resultado en pesos', pct(costARS ? valARSofARS / costARS - 1 : null), 'posiciones cargadas en $', cls(costARS ? valARSofARS / costARS - 1 : null))}
      ${card('Resultado en dólares', ok(resUSDtot) ? pct(resUSDtot) : '—', ok(resUSDtot) ? 'según CCL de la fecha de compra' : 'cargá la fecha de compra', cls(resUSDtot))}
      ${card('Posiciones', rows.length, sells.length ? `${sells.length} para revisar` : '')}
    </div>
    ${totARS ? `<div class="alloc">${Object.entries(byTab).map(([t, x]) => `<i style="width:${(x / totARS * 100).toFixed(2)}%;background:${COL[t]}" title="${TAB_LABEL[t]} ${pct(x / totARS, 0, false)}"></i>`).join('')}</div>
      <div class="legend2">${Object.entries(byTab).map(([t, x]) => `<span><i style="background:${COL[t]}"></i>${TAB_LABEL[t]} ${pct(x / totARS, 0, false)}</span>`).join('')}</div>` : ''}
    ${alerts.length ? `<div class="reco"><h3>Para revisar</h3><ul>${alerts.map(a => `<li>${a}</li>`).join('')}</ul></div>` : ''}

    <form id="posForm" class="posform">
      <input type="hidden" name="pid">
      <label>Ticker<input name="sym" list="symList" required placeholder="GGAL, AAPL, AL30…" autocomplete="off"></label>
      <label>Cantidad<input name="qty" type="number" step="any" min="0" required></label>
      <label>Precio promedio<input name="px" type="number" step="any" min="0" required></label>
      <label>Moneda<select name="cur"><option value="ARS">Pesos</option><option value="USD">Dólares</option></select></label>
      <label>Fecha de compra<input name="fecha" type="date"></label>
      <button class="primary" type="submit">Agregar</button>
      <button type="button" id="posCancel" hidden>Cancelar</button>
      <datalist id="symList">${all}</datalist>
      <small class="muted">Bonos y ONs: cantidad en valor nominal y precio cada 100 VN. La fecha permite calcular el resultado en dólares.</small>
    </form>

    <div class="tablewrap" style="max-height:none">
      <table id="tblCartera" class="ctable">
        <thead><tr><th class="l">Ticker</th><th class="l">Tipo</th><th>Cantidad</th><th>P. promedio</th><th>P. actual</th><th>Valor $</th><th>Peso</th>
          <th>Resultado</th><th>En US$</th><th class="l">Señal</th><th class="l">Qué hacer</th><th></th></tr></thead>
        <tbody>${rows.length ? rows.map(x => {
          const r = x.r, cur = x.p.cur;
          const now = r ? (cur === 'USD' ? pxUSD(r) : pxARS(r)) : null;
          return `<tr data-key="${esc(x.p.tab + ':' + x.p.sym)}">
            <td class="l tk">${esc(x.p.sym)}${x.p.origen ? ` <span class="muted" title="Copiada de una cartera pública">⧉</span>` : ''}</td>
            <td class="l">${TAB_LABEL[x.p.tab]}</td>
            <td>${fmt(x.p.qty, x.p.qty % 1 ? 2 : 0)}</td>
            <td>${cur === 'USD' ? 'US$ ' : ''}${fmt(x.p.px)}</td>
            <td>${r ? (cur === 'USD' ? 'US$ ' : '') + fmt(now) : '<span class="muted">sin cotización</span>'}</td>
            <td>${fmt(x.valARS, 0)}</td>
            <td>${totARS && ok(x.valARS) ? pct(x.valARS / totARS, 1, false) : ''}</td>
            <td class="${cls(x.res)}">${pct(x.res)}</td>
            <td class="${cls(x.resUSD)}">${pct(x.resUSD)}</td>
            <td class="l">${x.A ? `<span class="sig s-${x.A.signal}">${x.A.signal}</span>` : x.B ? `<span class="muted">${tirLabel(x.B, 1)}</span>` : '<span class="muted">—</span>'}</td>
            <td class="l wrap">${x.adv.t}</td>
            <td><button class="mini" data-edit="${x.p.id}">✎</button> <button class="mini" data-del="${x.p.id}">✕</button></td></tr>`;
        }).join('') : '<tr><td class="l muted" colspan="12">Todavía no cargaste posiciones. Usá el formulario de arriba, o copiá una cartera desde "Seguir carteras".</td></tr>'}</tbody>
      </table>
    </div>

    <details class="io"><summary>Exportar / importar</summary>
      <p class="muted">Copiá este texto para guardar tu cartera o pasarla a otro navegador. Para importar, pegalo y tocá Importar.</p>
      <textarea id="ioText" rows="5">${esc(JSON.stringify(S.cartera))}</textarea>
      <div><button type="button" id="ioCopy">Copiar</button> <button type="button" id="ioImport">Importar</button> <span id="ioMsg" class="muted"></span></div>
    </details>`;
}

function guessTab(sym) {
  for (const t of ['acciones', 'cedears', 'bonos', 'ons']) if ((S.live[t] || []).some(r => r.sym === sym)) return t;
  return null;
}

function bindCartera() {
  const v = $('#viewCartera');
  v.addEventListener('submit', e => {
    if (e.target.getAttribute('id') !== 'posForm') return;
    e.preventDefault();
    const f = e.target.elements;
    const sym = f.sym.value.trim().toUpperCase();
    const tab = guessTab(sym);
    if (!tab) { setStatus(`No encontré ${sym} en las cotizaciones`); return; }
    const pos = { id: f.pid.value || String(Date.now()), tab, sym, qty: +f.qty.value, px: +f.px.value, cur: f.cur.value, fecha: f.fecha.value || null };
    const i = S.cartera.findIndex(p => p.id === pos.id);
    if (i >= 0) S.cartera[i] = { ...S.cartera[i], ...pos }; else S.cartera.push(pos);
    saveCartera();
    renderCartera();
  });
  v.addEventListener('input', e => {
    if (e.target.name !== 'sym') return;
    const sym = e.target.value.trim().toUpperCase();
    const tab = guessTab(sym), f = e.target.form.elements;
    const r = tab && (S.live[tab] || []).find(x => x.sym === sym);
    if (r && !f.px.value) { f.cur.value = r.variant ? 'USD' : 'ARS'; f.px.placeholder = 'actual: ' + fmt(r.c); }
  });
  v.addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) {
      const p = S.cartera.find(x => x.id === ed.dataset.edit), f = $('#posForm').elements;
      f.pid.value = p.id; f.sym.value = p.sym; f.qty.value = p.qty; f.px.value = p.px; f.cur.value = p.cur; f.fecha.value = p.fecha || '';
      $('#posForm button[type=submit]').textContent = 'Guardar cambios'; $('#posCancel').hidden = false;
      $('#posForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (del) { S.cartera = S.cartera.filter(x => x.id !== del.dataset.del); saveCartera(); drawCartera(); return; }
    if (e.target.id === 'posCancel') { drawCartera(); return; }
    if (e.target.id === 'ioCopy') {
      try { await navigator.clipboard.writeText($('#ioText').value); $('#ioMsg').textContent = 'Copiado'; }
      catch { $('#ioText').select(); $('#ioMsg').textContent = 'Seleccionado: copialo con Ctrl+C'; }
      return;
    }
    if (e.target.id === 'ioImport') {
      try {
        const data = JSON.parse($('#ioText').value);
        if (!Array.isArray(data) || !data.every(p => p.sym && p.tab && ok(p.qty) && ok(p.px))) throw new Error();
        S.cartera = data.map(p => ({ ...p, id: p.id || String(Math.random()).slice(2) }));
        saveCartera(); renderCartera();
      } catch { $('#ioMsg').textContent = 'El texto no tiene el formato correcto'; }
      return;
    }
    const tr = e.target.closest('#tblCartera tr[data-key]');
    if (tr && !e.target.closest('button')) openDetail(tr.dataset.key);
  });
}

/* ============================================================
   Vista: Seguir carteras
   ============================================================ */
async function loadPublicas() {
  if (S.publicas) return S.publicas;
  S.publicas = await fetchJSON(SNAP ? 'carteras.json' : 'carteras.json?v=' + Date.now(), 15000);
  return S.publicas;
}

// Cartera modelo del panel: las de mejor puntaje con señal de compra entre las analizadas
function carteraModelo() {
  const cands = ['acciones', 'cedears'].flatMap(t => (S.live[t] || []).map(r => ({ r, A: an(r) })))
    .filter(x => x.A && (x.A.signal === 'COMPRAR' || x.A.signal === 'ACUMULAR'))
    .sort((a, b) => b.A.score - a.A.score).slice(0, 10);
  return {
    id: 'modelo', nombre: 'Cartera modelo del panel', gestor: 'Estrategia TMR (este panel)', estilo: 'Tendencia + momentum, pesos iguales',
    periodo: today(), presentado: today(), modelo: true,
    posiciones: cands.map(x => ({ ticker: x.r.sym, nombre: TAB_LABEL[x.r.tab], peso: 1 / cands.length, ar: { sym: x.r.sym, tab: x.r.tab }, cambio: null })),
    vendidas: [], pesoEnCedear: 1,
  };
}

// Serie en dólares de un activo local (CEDEAR: acción de EE.UU.; acción AR: pesos ÷ CCL)
async function serieUSD(ar) {
  if (ar.tab === 'cedears') {
    try { const u = await getUSA(ar.usa || ar.sym); if (u.length > 20) return u; } catch { }
    try { const u = await getUSA(ar.sym); if (u.length > 20) return u; } catch { }
  }
  const [raw, ccl] = await Promise.all([getRaw(ar.tab, ar.sym), loadCCL()]);
  return toUSD(raw, ccl);
}
function retDesde(rows, d) {
  const i = rows.findIndex(x => x.d >= d);
  if (i < 0 || i === rows.length - 1) return null;
  return rows[rows.length - 1].c / rows[i].c - 1;
}

// Rendimiento (en US$) de la parte copiable de la cartera desde una fecha, contra el S&P 500
async function perfCartera(c, desde) {
  const key = c.id + ':' + desde;
  if (S.perf[key]) return S.perf[key];
  const pos = c.posiciones.filter(p => p.ar);
  const out = await Promise.all(pos.map(async p => {
    try { const s = await serieUSD(p.ar); return { p, r: retDesde(s, desde) }; } catch { return { p, r: null }; }
  }));
  const okp = out.filter(x => ok(x.r));
  const w = okp.reduce((s, x) => s + x.p.peso, 0);
  let spy = null;
  try { spy = retDesde(await getUSA('SPY'), desde); } catch { }
  S.perf[key] = { ret: w ? okp.reduce((s, x) => s + x.p.peso * x.r, 0) / w : null, spy, por: Object.fromEntries(out.map(x => [x.p.ticker, x.r])), cobertura: w };
  return S.perf[key];
}

async function renderSeguir() {
  const v = $('#viewSeguir');
  v.innerHTML = '<p class="muted">Cargando carteras…</p>';
  try { await Promise.all([loadPublicas(), loadLive('cedears'), loadLive('acciones')]); }
  catch { v.innerHTML = '<p class="muted">No se pudieron cargar las carteras públicas (falta carteras.json: corré "node actualizar-carteras.js").</p>'; return; }
  // La cartera modelo necesita las señales de acciones y CEDEARs: se analizan en segundo plano
  const sinSenal = ['acciones', 'cedears'].flatMap(t => (S.live[t] || []).filter(r => !r.variant && r.v > 0 && !S.an[r.tab + ':' + r.sym]))
    .sort((a, b) => b.monto - a.monto);
  if (sinSenal.length) analyzeMany(sinSenal).then(() => { if (S.tab === 'seguir') renderSeguir(); });
  const list = [carteraModelo(), ...S.publicas.carteras];
  list.sort((a, b) => (!!S.seguidas[b.id] - !!S.seguidas[a.id]));
  v.innerHTML = `
    <h2 class="vt">Seguir carteras</h2>
    <p class="muted">Carteras públicas de inversores conocidos, tomadas del formulario 13F que los fondos de EE.UU. presentan cada trimestre ante la SEC
      (se publica hasta 45 días después del cierre del trimestre, así que muestra posiciones con demora). Solo se puede copiar la parte que cotiza en BYMA como CEDEAR o acción local.
      Datos descargados el ${esc(S.publicas.descargado)}.</p>
    <div class="cards" id="pubCards">${list.map(c => {
      const top = c.posiciones.slice(0, 5).map(p => `<span class="${p.ar ? '' : 'muted'}" title="${p.ar ? 'Se compra en BYMA como ' + esc(p.ar.sym) : 'No cotiza en BYMA'}">${esc(p.ticker)} ${pct(p.peso, 0, false)}</span>`).join(' · ');
      return `<div class="card pub" data-pub="${c.id}">
        <h3>${S.seguidas[c.id] ? '★ ' : ''}${esc(c.gestor)}</h3>
        <div class="muted" style="font-size:12px">${esc(c.nombre)} · ${esc(c.estilo)}</div>
        <p style="margin:8px 0 4px;font-size:13px">${top || '<span class="muted">Se arma sola a medida que se analizan acciones y CEDEARs…</span>'}</p>
        <div class="muted" style="font-size:12px">${c.posiciones.length} posiciones · ${pct(c.pesoEnCedear, 0, false)} comprable en BYMA · ${c.modelo ? 'señales de hoy' : 'al ' + c.periodo}</div>
        <div class="perf" data-perf="${c.id}">${c.modelo ? '' : '<span class="muted">Calculando rendimiento…</span>'}</div>
      </div>`;
    }).join('')}</div>`;
  // Rendimiento desde la publicación, de a una cartera
  for (const c of S.publicas.carteras) {
    const p = await perfCartera(c, c.presentado);
    const el = document.querySelector(`[data-perf="${c.id}"]`);
    if (el) el.innerHTML = `Desde que se publicó (${c.presentado}): <b class="${cls(p.ret)}">${pct(p.ret)}</b> en US$ · S&P 500 <span class="${cls(p.spy)}">${pct(p.spy)}</span>`;
  }
}

async function openPublica(id) {
  const c = id === 'modelo' ? carteraModelo() : S.publicas.carteras.find(x => x.id === id);
  if (!c) return;
  const box = $('#detail');
  box.hidden = false; $('#backdrop').hidden = false;
  curDetail = null;
  box.innerHTML = `<div class="drawer-head"><h2>${esc(c.gestor)}</h2><button class="x" data-close="detail">✕</button></div><div class="detail-body"><p class="muted">Cargando…</p></div>`;
  const perf = c.modelo ? null : await perfCartera(c, c.presentado);
  const seg = S.seguidas[c.id];
  const perfSeg = seg && !c.modelo ? await perfCartera(c, seg) : null;
  const kv = (k, v, sub) => `<div class="kv"><div class="k">${k}</div><div class="v">${v}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;
  const cambioTxt = x => x === 'nueva' ? '<span class="up">nueva</span>' : ok(x) && Math.abs(x) > 0.005 ? `<span class="${cls(x)}">${pct(x, 0)}</span>` : (x === null ? '' : '<span class="muted">=</span>');
  box.querySelector('.detail-body').innerHTML = `
    <div class="muted">${esc(c.nombre)} · ${esc(c.estilo)}${c.modelo ? '' : ` · posiciones al ${c.periodo} (presentado ${c.presentado})`}</div>
    <div style="margin:10px 0"><button id="btnSeguir" data-id="${c.id}" class="${seg ? '' : 'primary'}">${seg ? '★ Siguiendo desde ' + seg + ' — dejar de seguir' : '☆ Seguir esta cartera'}</button></div>
    <div class="plan">
      ${kv('Posiciones', c.posiciones.length, `${c.posiciones.filter(p => p.ar).length} en BYMA`)}
      ${kv('Comprable en BYMA', pct(c.pesoEnCedear, 0, false), 'del valor de la cartera')}
      ${perf ? kv('Rinde desde publicación', `<span class="${cls(perf.ret)}">${pct(perf.ret)}</span>`, `S&P 500 ${pct(perf.spy)}`) : ''}
      ${perfSeg ? kv('Desde que la seguís', `<span class="${cls(perfSeg.ret)}">${pct(perfSeg.ret)}</span>`, `S&P 500 ${pct(perfSeg.spy)}`) : ''}
    </div>

    <div class="reco"><h3>Copiar esta cartera</h3>
      <p style="margin:4px 0 8px">Ingresá cuánto querés invertir y el panel calcula cuántos CEDEARs/acciones comprar de cada uno, respetando los pesos (solo lo que cotiza en BYMA).</p>
      <form id="copyForm" class="posform" style="margin:0">
        <label>Monto en pesos<input name="monto" type="number" min="0" step="any" required placeholder="1000000"></label>
        <label>Peso mínimo<select name="min"><option value="0.01">1%</option><option value="0.02" selected>2%</option><option value="0.05">5%</option><option value="0">Todas</option></select></label>
        <button class="primary" type="submit">Calcular</button>
      </form>
      <div id="copyOut"></div>
    </div>

    <h4>Posiciones</h4>
    <table class="breakdown pubtable">
      <tr class="muted"><td>Activo</td><td>Peso</td><td>Cambio trim.</td><td>En BYMA</td><td>Precio $</td><td>Rinde desde publ.</td><td>Señal</td></tr>
      ${c.posiciones.slice(0, 60).map(p => {
        const r = p.ar && findRow(p.ar.tab + ':' + p.ar.sym), A = r && an(r), pr = perf && perf.por[p.ticker];
        return `<tr><td><b>${esc(p.ticker)}</b> <span class="muted" style="font-size:11px">${esc(p.nombre)}</span></td>
          <td>${pct(p.peso, 1, false)}</td><td>${cambioTxt(p.cambio)}</td>
          <td>${p.ar ? `<a href="#" data-open="${p.ar.tab}:${p.ar.sym}">${p.ar.sym}</a> <span class="muted">${p.ar.tab === 'acciones' ? 'acción' : 'CEDEAR'}</span>` : '<span class="muted">no disponible</span>'}</td>
          <td>${r ? fmt(r.c) : ''}</td><td class="${cls(pr)}">${ok(pr) ? pct(pr) : ''}</td>
          <td>${A ? `<span class="sig s-${A.signal}">${A.signal}</span>` : ''}</td></tr>`;
      }).join('')}
    </table>
    ${c.posiciones.length > 60 ? `<p class="muted">… y ${c.posiciones.length - 60} posiciones más chicas.</p>` : ''}
    ${c.vendidas && c.vendidas.length ? `<p class="note">Vendió por completo en el último trimestre: ${c.vendidas.map(esc).join(', ')}.</p>` : ''}
    <p class="note">${c.modelo ? 'Se arma con las señales COMPRAR/ACUMULAR de mayor puntaje entre los instrumentos ya analizados.' : 'Fuente: SEC EDGAR, formulario 13F. Solo incluye acciones de EE.UU. (no bonos, efectivo ni posiciones cortas). Rendimiento en dólares de la parte que cotiza en BYMA, con pesos fijos.'} No es una recomendación de inversión.</p>`;
  box.dataset.pub = c.id;
  // Señales automáticas: si faltan, se analizan y se vuelve a dibujar
  const faltan = c.posiciones.filter(p => p.ar).map(p => findRow(p.ar.tab + ':' + p.ar.sym)).filter(r => r && !S.an[r.tab + ':' + r.sym]);
  if (faltan.length) analyzeMany(faltan, { front: true }).then(() => {
    if (!box.hidden && box.dataset.pub === c.id) openPublica(c.id);
  });
}

function copyPlan(c, monto, minW) {
  // Une clases de una misma empresa que se compran con el mismo CEDEAR (ej. GOOG + GOOGL)
  const agg = {};
  c.posiciones.filter(p => p.ar).forEach(p => {
    const k = p.ar.tab + ':' + p.ar.sym;
    agg[k] = agg[k] || { k, peso: 0 };
    agg[k].peso += p.peso;
  });
  const pos = Object.values(agg).filter(a => a.peso >= minW).map(a => ({ p: a, r: findRow(a.k) })).filter(x => x.r && x.r.c > 0);
  const w = pos.reduce((s, x) => s + x.p.peso, 0);
  const items = pos.map(x => {
    const peso = x.p.peso / w, qty = Math.floor(monto * peso / x.r.c);
    return { sym: x.r.sym, tab: x.r.tab, peso, px: x.r.c, qty, total: qty * x.r.c };
  });
  return { items, invertido: items.reduce((s, i) => s + i.total, 0) };
}

function bindSeguir() {
  $('#viewSeguir').addEventListener('click', e => { const c = e.target.closest('[data-pub]'); if (c) openPublica(c.dataset.pub); });
  $('#detail').addEventListener('click', async e => {
    const id = $('#detail').dataset.pub;
    if (e.target.id === 'btnSeguir') {
      if (S.seguidas[id]) delete S.seguidas[id]; else S.seguidas[id] = today();
      store.set('seguidas', S.seguidas);
      openPublica(id);
      if (S.tab === 'seguir') renderSeguir();
    }
    const o = e.target.closest('[data-open]');
    if (o) { e.preventDefault(); openDetail(o.dataset.open); }
    if (e.target.id === 'btnAddCopy') {
      const plan = JSON.parse(e.target.dataset.plan);
      plan.forEach(i => S.cartera.push({ id: String(Date.now()) + i.sym, tab: i.tab, sym: i.sym, qty: i.qty, px: i.px, cur: 'ARS', fecha: today(), origen: id }));
      saveCartera();
      $('#copyOut').innerHTML += '<p class="up">Agregado a tu cartera. Lo ves en la pestaña "Mi cartera".</p>';
      e.target.disabled = true;
    }
  });
  $('#detail').addEventListener('submit', e => {
    if (e.target.getAttribute('id') !== 'copyForm') return;
    e.preventDefault();
    const id = $('#detail').dataset.pub;
    const c = id === 'modelo' ? carteraModelo() : S.publicas.carteras.find(x => x.id === id);
    const monto = +e.target.elements.monto.value, minW = +e.target.elements.min.value;
    const plan = copyPlan(c, monto, minW);
    const buy = plan.items.filter(i => i.qty > 0);
    $('#copyOut').innerHTML = `
      <table class="breakdown" style="margin-top:10px">
        <tr class="muted"><td>Comprar</td><td>Peso</td><td>Precio $</td><td>Cantidad</td><td>Total $</td></tr>
        ${plan.items.map(i => `<tr class="${i.qty ? '' : 'muted'}"><td><b>${i.sym}</b></td><td>${pct(i.peso, 1, false)}</td><td>${fmt(i.px)}</td><td>${i.qty || 'no alcanza'}</td><td>${fmt(i.total, 0)}</td></tr>`).join('')}
        <tr><td><b>Total</b></td><td></td><td></td><td></td><td><b>${fmt(plan.invertido, 0)}</b></td></tr>
      </table>
      <p class="muted">Sobrante sin invertir: $ ${fmt(monto - plan.invertido, 0)}. Precios de la última cotización; no incluye comisiones.</p>
      ${buy.length ? `<button id="btnAddCopy" class="primary" data-plan='${esc(JSON.stringify(buy))}'>Agregar a mi cartera (como comprado hoy)</button>` : ''}`;
  });
}

bindCartera();
bindSeguir();
