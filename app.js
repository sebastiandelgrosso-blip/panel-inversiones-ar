'use strict';

/* ============================================================
   Fuentes de datos
   ============================================================ */
const API = {
  live: {
    acciones: 'https://data912.com/live/arg_stocks',
    cedears: 'https://data912.com/live/arg_cedears',
    bonos: 'https://data912.com/live/arg_bonds',
    ons: 'https://data912.com/live/arg_corp',
  },
  hist: {
    acciones: s => `https://data912.com/historical/stocks/${encodeURIComponent(s)}`,
    cedears: s => `https://data912.com/historical/cedears/${encodeURIComponent(s)}`,
    bonos: s => `https://data912.com/historical/bonds/${encodeURIComponent(s)}`,
  },
  notes: 'https://data912.com/live/arg_notes', // LECAP, LECER y otras letras
  cer: 'https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/30?limit=60', // índice CER diario (BCRA)
  ccl: 'https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoconliqui',
  dolares: 'https://dolarapi.com/v1/dolares',
};

// Panel líder (S&P Merval) aproximado
const LIDER = new Set(['ALUA', 'BBAR', 'BMA', 'BYMA', 'CEPU', 'COME', 'CRES', 'CVH', 'EDN', 'GGAL', 'HARG', 'IRSA',
  'LOMA', 'METR', 'MIRG', 'PAMP', 'SUPV', 'TECO2', 'TGNO4', 'TGSU2', 'TRAN', 'TXAR', 'VALO', 'YPFD', 'ECOG', 'BHIP']);

const TAB_LABEL = { acciones: 'Acción AR', cedears: 'CEDEAR', bonos: 'Bono', ons: 'ON' };

/* ============================================================
   Parámetros (editables y guardados en el navegador)
   ============================================================ */
const PARAM_SPEC = [
  { grp: 'Análisis' },
  { k: 'moneda', label: 'Moneda de análisis', type: 'select', opts: [['USD', 'Dólares (CCL)'], ['ARS', 'Pesos nominales']], def: 'USD',
    help: 'En pesos, la inflación distorsiona máximos y mínimos.' },
  { k: 'perfil', label: 'Perfil de riesgo', type: 'select', opts: [['conservador', 'Conservador'], ['moderado', 'Moderado'], ['agresivo', 'Agresivo']], def: 'moderado' },
  { grp: 'Medias móviles' },
  { k: 'smaF', label: 'Media rápida (ruedas)', type: 'number', min: 5, max: 150, def: 50 },
  { k: 'smaS', label: 'Media lenta (ruedas)', type: 'number', min: 50, max: 400, def: 200 },
  { grp: 'RSI' },
  { k: 'rsiN', label: 'Período RSI', type: 'number', min: 2, max: 50, def: 14 },
  { k: 'rsiOB', label: 'Sobrecompra', type: 'number', min: 55, max: 95, def: 70 },
  { k: 'rsiOS', label: 'Sobreventa', type: 'number', min: 5, max: 45, def: 30 },
  { grp: 'Zonas de precio' },
  { k: 'nearHigh', label: '"Cerca de máximo" (%)', type: 'number', min: 1, max: 25, step: 0.5, def: 5, help: 'Distancia máxima al máximo para considerarlo en zona de máximos.' },
  { k: 'nearLow', label: '"Cerca de mínimo" (%)', type: 'number', min: 1, max: 40, step: 0.5, def: 10 },
  { grp: 'Riesgo' },
  { k: 'atrMult', label: 'Stop = k × ATR (k)', type: 'number', min: 1, max: 6, step: 0.5, def: 2.5 },
  { k: 'riesgo', label: 'Riesgo por operación (% cartera)', type: 'number', min: 0.25, max: 5, step: 0.25, def: 1 },
  { k: 'comision', label: 'Comisión por operación (%)', type: 'number', min: 0, max: 3, step: 0.05, def: 0.5, help: 'Se usa en el backtest (compra y venta).' },
  { k: 'btStop', label: 'Backtest: salir también por stop', type: 'select', opts: [['no', 'No, solo por señal'], ['si', 'Sí (stop móvil k × ATR)']], def: 'no',
    help: 'En la prueba de 5 años el stop ajustado empeoró los resultados.' },
];
const DEFAULTS = Object.fromEntries(PARAM_SPEC.filter(p => p.k).map(p => [p.k, p.def]));
const PERFILES = {
  conservador: { buy: 60, acc: 30, red: -15, sell: -40 },
  moderado: { buy: 50, acc: 20, red: -20, sell: -50 },
  agresivo: { buy: 40, acc: 15, red: -25, sell: -60 },
};

// localStorage puede no estar disponible (por ejemplo, dentro de una página embebida)
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { }
    if (typeof onStoreChange === 'function') onStoreChange(k); // sincronización en la nube (extras.js)
  },
};
function loadParams() { return { ...DEFAULTS, ...store.get('params', {}) }; }

/* ============================================================
   Estado
   ============================================================ */
const S = {
  tab: 'acciones',
  live: {},        // tab -> rows
  liveTime: null,
  fx: {},          // casa -> venta
  cclSeries: null, // [{d, v}] ascendente
  raw: {},         // `${tab}:${sym}` -> filas históricas en pesos/USD originales
  an: {},          // `${tab}:${sym}` -> resultado del análisis
  fav: new Set(store.get('fav', [])),
  sort: { k: 'monto', dir: -1 },
  params: loadParams(),
  stop: false,
  busy: false,
};

/* ============================================================
   Utilidades
   ============================================================ */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = x => x != null && isFinite(x);
function fmt(x, d) {
  if (!ok(x)) return '–';
  if (d == null) d = Math.abs(x) >= 1000 ? 0 : Math.abs(x) >= 10 ? 2 : Math.abs(x) >= 1 ? 2 : 4;
  return x.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function pct(x, d = 1, sign = true) {
  if (!ok(x)) return '–';
  return (sign && x > 0 ? '+' : '') + (x * 100).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
}
const cls = x => !ok(x) || x === 0 ? '' : x > 0 ? 'up' : 'down';
function money(x, cur) { return ok(x) ? (cur === 'USD' ? 'US$ ' : '$ ') + fmt(x) : '–'; }
function compact(x) {
  if (!ok(x)) return '–';
  const a = Math.abs(x);
  if (a >= 1e9) return fmt(x / 1e9, 1) + ' MM';
  if (a >= 1e6) return fmt(x / 1e6, 1) + ' M';
  if (a >= 1e3) return fmt(x / 1e3, 1) + ' k';
  return fmt(x, 0);
}
/* ---- Modo "foto del día": los datos vienen embebidos en la página (window.SNAPSHOT) ---- */
const SNAP = window.SNAPSHOT || null;
const today = () => SNAP ? SNAP.date : new Date().toISOString().slice(0, 10);

const DAY = 864e5;
function snapDates(d0, dd) {
  let t = Date.parse(d0 + 'T00:00:00Z');
  return dd.map((x, i) => { if (i) t += x * DAY; return new Date(t).toISOString().slice(0, 10); });
}
function snapGet(url) {
  const p = SNAP.urls[url];
  if (!p) return Promise.reject(Object.assign(new Error('No incluido en la foto'), { final: true }));
  if (p.t === 'raw') return Promise.resolve(p.v);
  const dates = snapDates(p.d0, p.dd);
  if (p.t === 'usa') return Promise.resolve({ dates, prices: p.c });
  if (p.t === 'ccl') return Promise.resolve(dates.map((d, i) => ({ fecha: d, venta: p.c[i] })));
  // histórico OHLC: h/l solo para las últimas ruedas
  const off = p.c.length - p.h.length;
  return Promise.resolve(dates.map((d, i) => {
    const c = p.c[i], h = i >= off ? p.h[i - off] : c, l = i >= off ? p.l[i - off] : c;
    return { date: d, o: c, h, l, c };
  }));
}

async function fetchJSON(url, timeout = 30000) {
  if (SNAP) return snapGet(url);
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (r.status === 404) throw Object.assign(new Error('Sin datos'), { final: true });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (e.final || attempt === 1) throw e;
      await new Promise(res => setTimeout(res, 800));
    } finally { clearTimeout(t); }
  }
}

function setStatus(msg) { $('#status').textContent = msg || ''; }
function progress(p) { $('#progress').style.width = p == null ? '0' : (p * 100).toFixed(1) + '%'; }

/* ============================================================
   Indicadores técnicos
   ============================================================ */
function sma(a, n) {
  const out = new Array(a.length).fill(null);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= n) s -= a[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
function ema(a, n) {
  const out = new Array(a.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] == null) continue;
    prev = prev == null ? a[i] : a[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
function rsi(c, n) {
  const out = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
function macd(c) {
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const line = c.map((_, i) => e12[i] - e26[i]);
  const sig = ema(line, 9);
  return { line, sig, hist: line.map((v, i) => v - sig[i]) };
}
function atr(h, l, c, n = 14) {
  const tr = c.map((_, i) => i === 0 ? h[i] - l[i] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  const out = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  let a = tr.slice(1, n + 1).reduce((x, y) => x + y, 0) / n;
  out[n] = a;
  for (let i = n + 1; i < c.length; i++) { a = (a * (n - 1) + tr[i]) / n; out[i] = a; }
  return out;
}
const last = a => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };

/* ============================================================
   Datos de mercado
   ============================================================ */
async function loadFX() {
  try {
    const d = await fetchJSON(API.dolares);
    d.forEach(x => S.fx[x.casa] = x.venta);
  } catch { /* no crítico */ }
  renderFX();
}

async function loadCCL() {
  if (S.cclSeries) return S.cclSeries;
  const d = await fetchJSON(API.ccl, 60000);
  S.cclSeries = d.filter(x => x.venta > 0).map(x => ({ d: x.fecha, v: x.venta })).sort((a, b) => a.d < b.d ? -1 : 1);
  return S.cclSeries;
}
const currentCCL = () => S.fx.contadoconliqui || (S.cclSeries && S.cclSeries[S.cclSeries.length - 1].v) || null;

async function loadLive(tab, force) {
  if (S.live[tab] && !force) return S.live[tab];
  let d = await fetchJSON(API.live[tab]);
  if (tab === 'bonos') {
    try { const notes = await fetchJSON(API.notes); const have = new Set(d.map(r => r.symbol)); d = d.concat(notes.filter(r => !have.has(r.symbol))); } catch { }
  }
  const syms = new Set(d.map(r => r.symbol));
  const bySym = Object.fromEntries(d.map(r => [r.symbol, r]));
  const rows = d.map(r => {
    const base = r.symbol.length > 2 ? r.symbol.slice(0, -1) : null;
    let variant = base && /[DC]$/.test(r.symbol) && syms.has(base) && tab !== 'ons' ? r.symbol.slice(-1) : null;
    // ONs: la especie principal es la de pesos (…O); las …D (MEP) y …C (cable) son variantes
    if (tab === 'ons' && /[DC]$/.test(r.symbol) && syms.has(base + 'O')) variant = r.symbol.slice(-1);
    // Acciones en dólares con nombre irregular (BMA.D, TGSUD, TECOD…): terminan en D, precio chico y
    // existe una especie en pesos con el mismo prefijo y precio mucho mayor
    if (!variant && tab === 'acciones' && /D$/.test(r.symbol) && r.c > 0) {
      const pre = r.symbol.slice(0, 3);
      if (d.some(o => o.symbol !== r.symbol && o.symbol.startsWith(pre) && o.c > r.c * 200)) variant = 'D';
    }
    // ONs: la especie en pesos termina en O y la de dólar MEP en D (YMCXO / YMCXD)
    const boprealPesos = tab === 'bonos' && r.symbol.match(/^BPO([A-D][78])$/); // BPOA7 (pesos) ↔ BPA7D (MEP)
    const usdTwin = tab === 'ons'
      ? (/O$/.test(r.symbol) ? bySym[r.symbol.slice(0, -1) + 'D'] : null)
      : boprealPesos ? bySym['BP' + boprealPesos[1] + 'D']
      : !variant ? bySym[r.symbol + 'D'] : null;
    return {
      tab, sym: r.symbol, c: r.c, chg: r.pct_change / 100, bid: r.px_bid, ask: r.px_ask, v: r.v,
      monto: (r.v || 0) * (r.c || 0) / (tab === 'bonos' || tab === 'ons' ? 100 : 1),
      variant, // 'D' = dólar MEP, 'C' = dólar cable
      usdD: usdTwin && usdTwin.c > 0 ? usdTwin.c : null,
    };
  });
  if (tab === 'bonos' && bySym.AL30 && bySym.AL30D && bySym.AL30D.c > 0) S.mepImpl = bySym.AL30.c / bySym.AL30D.c;
  // En la foto solo se muestran los instrumentos cuyo histórico está incluido
  S.live[tab] = SNAP && tab !== 'ons'
    ? rows.filter(r => !r.variant && (SNAP.urls[tab === 'cedears' ? `https://data912.com/historical/usa_stocks/${encodeURIComponent(r.sym)}` : API.hist[tab](r.sym)]
      || (tab === 'bonos' && (termsFor(r.sym) || ['soberanos', 'lecaps', 'cer'].some(g => SNAP.urls['flujos.json']?.v[g]?.[r.sym])))))
    : rows;
  S.liveTime = SNAP ? new Date(SNAP.time) : new Date();
  if (tab === 'bonos') renderFX();
  return rows;
}

// Histórico crudo de data912
async function getRaw(tab, sym) {
  const k = tab + ':' + sym;
  if (S.raw[k]) return S.raw[k];
  const d = await fetchJSON(API.hist[tab](sym));
  if (!Array.isArray(d) || !d.length) throw new Error('Sin histórico');
  const rows = d.filter(r => r.c > 0).map(r => ({
    d: r.date, o: r.o || r.c, h: Math.max(r.h || r.c, r.c), l: Math.min(r.l || r.c, r.c), c: r.c,
  }));
  S.raw[k] = adjustSplits(rows);
  if (tab === 'bonos' && isSovereignHD(sym)) adjustPayments(S.raw[k]);
  return S.raw[k];
}

// Bonares y Globales (AL30, GD35, AE38…) pagan renta y amortización el 9 de enero y el 9 de julio
const isSovereignHD = sym => /^(AL|GD|AE)\d\d/.test(sym);

// Ajuste aproximado a retorno total: en cada ventana de pago (2–12 de enero/julio) se toma la mayor caída
// de un día como fecha de corte y se ajustan los precios anteriores. Sin esto, cada amortización
// parecería una pérdida y el bono quedaría "lejos de máximos" aunque el inversor no perdió nada.
function adjustPayments(rows) {
  rows.payAdj = 0;
  const windows = {};
  for (let i = 1; i < rows.length; i++) {
    const [y, m, d] = rows[i].d.split('-').map(Number);
    if ((m === 1 || m === 7) && d >= 2 && d <= 12) {
      const r = rows[i].c / rows[i - 1].c - 1;
      const key = y + '-' + m;
      if (!windows[key] || r < windows[key].r) windows[key] = { i, r };
    }
  }
  const cuts = Object.values(windows).filter(w => w.r < -0.01).sort((a, b) => b.i - a.i);
  let f = 1, ci = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    while (ci < cuts.length && cuts[ci].i > i) { f *= 1 + cuts[ci].r; ci++; rows.payAdj++; }
    if (f !== 1) { const p = rows[i]; p.o *= f; p.h *= f; p.l *= f; p.c *= f; }
  }
  return rows;
}

// El histórico no viene ajustado por desdoblamientos (ej. YPFD 10:1 en 2026).
// Un salto diario de más de −55% / +120% se toma como split y se ajusta todo lo anterior.
function adjustSplits(rows) {
  rows.splits = [];
  let f = 1;
  for (let i = rows.length - 1; i > 0; i--) {
    const r = rows[i].c / (rows[i - 1].c * f);
    if (r < 0.45 || r > 2.2) {
      const k = r < 1 ? 1 / r : r, kr = Math.round(k);
      const factor = Math.abs(k - kr) / kr < 0.15 ? (r < 1 ? 1 / kr : kr) : r;
      f *= factor;
      rows.splits.push({ d: rows[i].d, factor });
    }
    if (f !== 1) {
      const p = rows[i - 1];
      p.o *= f; p.h *= f; p.l *= f; p.c *= f;
    }
  }
  return rows;
}

// Histórico de la acción en EE.UU. (solo cierres)
async function getUSA(sym) {
  const k = 'usa:' + sym;
  if (S.raw[k]) return S.raw[k];
  const d = await fetchJSON(`https://data912.com/historical/usa_stocks/${encodeURIComponent(sym)}`);
  if (!d || !Array.isArray(d.dates) || !d.dates.length) throw new Error('Sin histórico');
  const rows = d.dates.map((dt, i) => ({ d: dt, c: d.prices[i] })).filter(r => r.c > 0);
  S.raw[k] = adjustSplits(rows.map(r => ({ ...r, o: r.c, h: r.c, l: r.c })));
  return S.raw[k];
}

// Divide cada vela por el CCL del día (o el último disponible)
function toUSD(rows, ccl) {
  const out = [];
  let j = 0;
  for (const r of rows) {
    while (j + 1 < ccl.length && ccl[j + 1].d <= r.d) j++;
    if (ccl[j].d > r.d) continue; // antes de que exista CCL
    const f = ccl[j].v;
    out.push({ d: r.d, o: r.o / f, h: r.h / f, l: r.l / f, c: r.c / f });
  }
  return out;
}

// Serie lista para analizar según la moneda elegida
async function getSeries(row) {
  const { tab, sym } = row;
  const wantUSD = S.params.moneda === 'USD';
  let rows, cur, src;
  if (row.variant) {
    rows = await getRaw(tab, sym); cur = 'USD'; src = `especie en dólares (${row.variant === 'D' ? 'MEP' : 'cable'})`;
  } else if (!wantUSD) {
    rows = await getRaw(tab, sym); cur = 'ARS'; src = 'pesos nominales';
  } else {
    if (tab === 'cedears') {
      // Acción subyacente en EE.UU. (más historia y sin cambios de ratio), escalada al precio del CEDEAR
      try {
        const u = await getUSA(sym);
        const cedUSD = row.c / (currentCCL() || NaN);
        const k = cedUSD / u[u.length - 1].c;
        if (u.length > 300 && ok(k) && k > 0) {
          rows = u.map(r => ({ d: r.d, o: r.c * k, h: r.c * k, l: r.c * k, c: r.c * k }));
          cur = 'USD'; src = `acción ${sym} en EE.UU., escalada al precio del CEDEAR`;
        }
      } catch { /* sigue con CCL */ }
    }
    if (tab === 'bonos' && row.usdD) {
      try {
        const r = await getRaw(tab, sym + 'D');
        if (r.length > 60) { rows = r; cur = 'USD'; src = `especie ${sym}D (dólar MEP)`; }
      } catch { /* sigue con CCL */ }
    }
    if (!rows) {
      const [raw, ccl] = await Promise.all([getRaw(tab, sym), loadCCL()]);
      rows = toUSD(raw, ccl); rows.payAdj = raw.payAdj; cur = 'USD'; src = 'pesos ÷ dólar CCL de cada día';
    }
  }
  if (tab === 'bonos' && rows.payAdj) src += ` · ajustado por ${rows.payAdj} pagos de renta/amortización (aprox.)`;
  rows = rows.slice();
  // Agrega la cotización de hoy si el histórico llega hasta ayer
  let px = row.c;
  if (cur === 'USD' && !row.variant) {
    if (src.startsWith('especie') && row.usdD) px = row.usdD;
    else px = row.c / (currentCCL() || NaN);
  }
  const t = today();
  if (ok(px) && px > 0 && rows.length && rows[rows.length - 1].d < t) {
    rows.push({ d: t, o: px, h: px, l: px, c: px, live: true });
  }
  return { rows, cur, src };
}

/* ============================================================
   Renta fija: flujos de fondos, TIR, duration y paridad
   ============================================================ */
// Términos del canje 2020 (Bonares ley local = Globales ley NY). Pagan el 9 de enero y el 9 de julio.
// rates: [desde, tasa anual]; amort: n cuotas semestrales iguales desde "from" (+ "list" de cuotas especiales)
const BOND_TERMS = {
  GD29: { name: 'Global/Bonar 2029', venc: '2029-07-09', rates: [['2020-09-04', 0.01]], amort: { from: '2025-01-09', n: 10 } },
  GD30: { name: 'Global/Bonar 2030', venc: '2030-07-09',
    rates: [['2020-09-04', 0.00125], ['2021-07-09', 0.005], ['2023-07-09', 0.0075], ['2027-07-09', 0.0175]],
    amort: { list: [['2024-07-09', 4]], from: '2025-01-09', n: 12, amt: 8 } },
  GD35: { name: 'Global/Bonar 2035', venc: '2035-07-09',
    rates: [['2020-09-04', 0.00125], ['2021-07-09', 0.01125], ['2022-07-09', 0.015], ['2023-07-09', 0.03625], ['2024-07-09', 0.04125], ['2027-07-09', 0.0475], ['2028-07-09', 0.05]],
    amort: { from: '2031-01-09', n: 10 } },
  GD38: { name: 'Global/Bonar 2038', venc: '2038-01-09',
    rates: [['2020-09-04', 0.00125], ['2021-07-09', 0.02], ['2022-07-09', 0.03875], ['2023-07-09', 0.0425], ['2024-07-09', 0.05]],
    amort: { from: '2027-07-09', n: 22 } },
  GD41: { name: 'Global/Bonar 2041', venc: '2041-07-09',
    rates: [['2020-09-04', 0.00125], ['2021-07-09', 0.025], ['2022-07-09', 0.035], ['2029-07-09', 0.04875]],
    amort: { from: '2028-01-09', n: 28 } },
  GD46: { name: 'Global 2046', venc: '2046-07-09',
    rates: [['2020-09-04', 0.00125], ['2021-07-09', 0.01125], ['2022-07-09', 0.015], ['2023-07-09', 0.03625], ['2024-07-09', 0.04125], ['2027-07-09', 0.04375], ['2028-07-09', 0.05]],
    amort: { from: '2025-01-09', n: 44 } },
};
const BOND_ALIAS = { AL29: 'GD29', AL30: 'GD30', AL35: 'GD35', AE38: 'GD38', AL41: 'GD41' };

// BOPREAL (BCRA): cupón fijo semestral (30/4 y 31/10) y capital al vencimiento.
// Serie 1 (strips A–D): 5% anual, vence 31/10/2027. Serie 4 (strips A–B): 3% anual, vence 31/10/2028.
function bulletFlows(start, venc, rate) {
  const dates = [];
  for (let y = +start.slice(0, 4); y <= +venc.slice(0, 4); y++) dates.push(`${y}-04-30`, `${y}-10-31`);
  const out = [];
  let prev = start;
  for (const d of dates) {
    if (d <= start || d > venc) continue;
    const int = 100 * rate / 2, amo = d === venc ? 100 : 0;
    out.push({ d, start: prev, resid: 100, rate, int, amo, total: int + amo });
    prev = d;
  }
  return out;
}
BOND_TERMS.BPS1 = { name: 'BOPREAL Serie 1', venc: '2027-10-31', rates: [['2024-02-07', 0.05]], flows: bulletFlows('2024-02-07', '2027-10-31', 0.05) };
BOND_TERMS.BPS4 = { name: 'BOPREAL Serie 4', venc: '2028-10-31', rates: [['2025-07-01', 0.03]], flows: bulletFlows('2025-07-01', '2028-10-31', 0.03) };

function termsFor(sym) {
  const base = /[DC]$/.test(sym) && sym.length > 4 ? sym.slice(0, -1) : sym;
  const bp = base.match(/^BPO?([A-D])([78])$/);
  if (bp) {
    const k = bp[2] === '7' ? 'BPS1' : 'BPS4';
    return { key: k, base, law: 'BCRA', ...BOND_TERMS[k], name: `${BOND_TERMS[k].name} (strip ${bp[1]})` };
  }
  const k = BOND_ALIAS[base] || base;
  return BOND_TERMS[k] && !k.startsWith('BPS') ? { key: k, base, law: base.startsWith('GD') ? 'Nueva York' : 'local', ...BOND_TERMS[k] } : null;
}

const addMonths = (d, m) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCMonth(t.getUTCMonth() + m); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5;
function days30360(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (Math.min(d2, 30) - Math.min(d1, 30));
}
const rateAt = (t, d) => { let r = t.rates[0][1]; for (const [f, v] of t.rates) if (f <= d) r = v; return r; };

// Flujos completos por cada 100 de valor nominal original
const flowCache = {};
function buildFlows(t) {
  if (flowCache[t.key]) return flowCache[t.key];
  if (t.flows) return (flowCache[t.key] = t.flows);
  const am = {};
  (t.amort.list || []).forEach(([d, v]) => am[d] = v);
  const per = t.amort.amt || 100 / t.amort.n;
  for (let i = 0; i < t.amort.n; i++) am[addMonths(t.amort.from, 6 * i)] = (am[addMonths(t.amort.from, 6 * i)] || 0) + per;
  const flows = [];
  let resid = 100, prev = '2020-09-04', d = '2021-07-09';
  while (d <= t.venc) {
    const int = resid * rateAt(t, prev) / 2;
    const amo = Math.min(am[d] || 0, resid);
    flows.push({ d, start: prev, resid, rate: rateAt(t, prev), int, amo, total: int + amo });
    resid -= amo; prev = d; d = addMonths(d, 6);
  }
  return (flowCache[t.key] = flows);
}

// Fecha de liquidación: siguiente día hábil (contado 24 hs)
function settleDate(d) {
  const t = new Date(d + 'T00:00:00Z');
  do t.setUTCDate(t.getUTCDate() + 1); while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
  return t.toISOString().slice(0, 10);
}

// Precio en dólares por cada 100 VN original (las cotizaciones de BYMA incluyen intereses corridos)
function bondMetrics(sym, price) {
  const t = termsFor(sym);
  if (!t || !ok(price) || price <= 0) return null;
  const flows = buildFlows(t), settle = settleDate(today());
  const fut = flows.filter(f => f.d > settle);
  if (!fut.length) return null;
  const nx = fut[0];
  const accrued = nx.resid * nx.rate / 2 * Math.min(180, Math.max(0, days30360(nx.start, settle))) / 180;
  const vt = nx.resid + accrued;
  const y = solveYield(fut, price, settle);
  if (!y) return null;
  return {
    ...t, ...y, sym, price, settle, vt, paridad: price / vt, accrued, resid: nx.resid,
    cupon: nx.rate, cy: nx.rate * nx.resid / price, next: nx, flows: fut, kind: 'usd',
    src: t.key.startsWith('BPS') ? 'condiciones de emisión del BCRA' : 'términos del canje 2020',
    raro: t.key.startsWith('BPS') && (y.tir < 0.0 || y.tir > 0.35),
    totalCobro: fut.reduce((s, f) => s + f.total, 0),
  };
}

// TIR (efectiva anual, Actual/365) y duration a partir de flujos futuros [{d, total}]
function solveYield(fut, price, settle) {
  const cf = fut.map(f => ({ t: f.total, y: daysBetween(settle, f.d) / 365 }));
  const pv = r => cf.reduce((s, f) => s + f.t / Math.pow(1 + r, f.y), 0);
  let lo = -0.9, hi = 5;
  if ((pv(lo) - price) * (pv(hi) - price) > 0) return null;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; (pv(m) > price) ? lo = m : hi = m; }
  const tir = (lo + hi) / 2;
  const dur = cf.reduce((s, f) => s + f.y * f.t / Math.pow(1 + tir, f.y), 0) / price;
  return { tir, dur, md: dur / (1 + tir) };
}

// Flujos externos (flujos.json): ONs en dólares y soberanos nuevos
function extFlowsFor(r) {
  const F = S.flujos;
  if (!F) return null;
  if (r.tab === 'ons') {
    const key = r.sym.slice(0, -1) + 'D';
    const o = F.ons[key];
    return o ? { name: `${o.nombre} (${key.slice(0, -1)})`, venc: o.venc, flujos: o.flujos, kind: 'ON' } : null;
  }
  const base = /[DC]$/.test(r.sym) && r.sym.length > 4 ? r.sym.slice(0, -1) : r.sym;
  const s = F.soberanos[base];
  return s ? { name: `Soberano ${base}`, venc: s.venc, flujos: s.flujos, kind: 'soberano', law: s.ley === 'NY' ? 'Nueva York' : 'local' } : null;
}
function extMetrics(r, price) {
  const e = extFlowsFor(r);
  if (!e || !ok(price) || price <= 0) return null;
  const settle = settleDate(today());
  const fut = e.flujos.filter(([d]) => d > settle).map(([d, total]) => ({ d, total }));
  if (!fut.length) return { ...e, vencido: true };
  const y = solveYield(fut, price, settle);
  if (!y) return null;
  return {
    ...e, ...y, sym: r.sym, price, settle, next: fut[0], flows: fut, src: S.flujos.fuente, kind: 'usd',
    totalCobro: fut.reduce((s, f) => s + f.total, 0),
    // Una TIR en dólares menor a 2,5% o mayor a 35% casi siempre es precio viejo o flujo que no coincide
    raro: y.tir < 0.025 || y.tir > 0.35,
  };
}

// LECAP / BONCAP: letra a descuento en pesos con un único pago final
function lecapMetrics(r) {
  const L = S.flujos?.lecaps?.[r.sym];
  if (!L || r.variant || !(r.c > 0)) return null;
  const settle = settleDate(today());
  const d = daysBetween(settle, L.venc);
  if (d <= 0) return null;
  const g = L.pago / r.c;
  const tea = Math.pow(g, 365 / d) - 1;
  return {
    kind: 'lecap', name: `${L.nombre} (${r.sym})`, venc: L.venc, sym: r.sym, price: r.c, settle,
    tir: tea, tem: Math.pow(g, 30 / d) - 1, tna: (g - 1) * 365 / d, dur: d / 365, md: d / 365 / (1 + tea),
    next: { d: L.venc, total: L.pago }, flows: [{ d: L.venc, total: L.pago }], totalCobro: L.pago, dias: d,
    src: L.fuente === 'rendimientos-ar' ? S.flujos.fuente : L.fuente, raro: tea < 0 || tea > 1.5,
  };
}

// Índice CER diario del BCRA
function cerAt(date) {
  const s = S.cer;
  if (!s || !s.length) return null;
  let v = null;
  for (const x of s) { if (x.d <= date) v = x.v; else break; }
  return v;
}
function businessDaysBack(date, n) {
  const t = new Date(date + 'T00:00:00Z');
  while (n > 0) { t.setUTCDate(t.getUTCDate() - 1); if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6) n--; }
  return t.toISOString().slice(0, 10);
}

// Bonos CER (Boncer, LECER, Discount, Par): el capital se ajusta por CER (con 10 días hábiles de rezago).
// Se pasa el precio a "términos reales" dividiéndolo por el coeficiente CER y se calcula la tasa real.
function cerMetrics(r) {
  const B = S.flujos?.cer?.[r.sym];
  if (!B || r.variant || !(r.c > 0)) return null;
  const settle = settleDate(today());
  const cerRef = cerAt(businessDaysBack(settle, 10));
  if (!cerRef) return null;
  const coef = cerRef / B.cerEmision;
  let resid = 1;
  const all = B.flujos.map(([d, amo, tasa, base]) => {
    const f = { d, amo: amo * 100, int: tasa * base * resid * 100, resid: resid * 100 };
    f.total = f.amo + f.int; resid -= amo; return f;
  });
  const fut = all.filter(f => f.d > settle);
  if (!fut.length) return null;
  const real = r.c / coef;
  const y = solveYield(fut, real, settle);
  if (!y) return null;
  return {
    kind: 'cer', name: `Bono CER ${r.sym}`, venc: B.venc, sym: r.sym, price: r.c, settle, ...y,
    coef, cerRef, realPrice: real, paridad: real / fut[0].resid, resid: fut[0].resid,
    next: fut[0], flows: fut, totalCobro: fut.reduce((s, f) => s + f.total, 0), src: S.flujos.fuente,
    // Dudoso si: tasa fuera de rango, vence en menos de ~2 semanas (la tasa se dispara con cualquier diferencia de precio)
    // o paridad > 105% (los flujos no incluyen todo el capital, ej. intereses capitalizados del Discount)
    raro: y.tir < -0.15 || y.tir > 0.4 || y.dur < 0.04 || real / fut[0].resid > 1.05,
  };
}

// Cómo se muestra la TIR según el tipo de instrumento
function tirLabel(B, d) {
  if (B.kind === 'lecap') return pct(B.tir, d, false) + ' $';
  if (B.kind === 'cer') return 'CER ' + (B.tir >= 0 ? '+' : '') + pct(B.tir, d, false);
  return pct(B.tir, d, false);
}
function tirHelp(B) {
  if (B.kind === 'lecap') return 'Tasa efectiva anual en pesos';
  if (B.kind === 'cer') return 'Tasa real anual por encima de la inflación (CER)';
  return 'TIR anual en dólares';
}

// Precio en dólares de una fila de bonos (especie D si existe)
function bondUSDPrice(r) {
  if (r.variant || (r.tab === 'ons' && /[DC]$/.test(r.sym))) return r.c;
  if (r.usdD) return r.usdD;
  return null;
}
const bondCache = {};
function bondInfo(r) {
  if (r.tab !== 'bonos' && r.tab !== 'ons') return null;
  const k = r.tab + r.sym + ':' + r.c + ':' + r.usdD + ':' + !!S.flujos + ':' + !!S.cer;
  if (!(k in bondCache)) {
    const px = bondUSDPrice(r);
    const m = (r.tab === 'bonos' && (bondMetrics(r.sym, px) || lecapMetrics(r) || cerMetrics(r))) || extMetrics(r, px);
    bondCache[k] = m && !m.vencido ? m : null;
  }
  return bondCache[k];
}

/* ============================================================
   Estrategia TMR: Tendencia + Momentum + Retroceso
   ============================================================ */
// Puntaje de la estrategia TMR en la rueda i (solo usa datos hasta i)
function scoreAt(ctx, i, withText) {
  const { c, smaF, smaS, rsiA, hist, nF, nS, P } = ctx;
  const parts = [];
  const add = (txt, pts) => parts.push(withText ? { txt, pts } : { pts });
  const px = c[i], sF = smaF[i], sS = smaS[i], sS20 = smaS[i - 20], R = rsiA[i], H = hist[i];
  if (!ok(sS) || !ok(sF)) return parts;
  const up = px > sS;
  const mom = i > 252 ? c[i - 21] / c[i - 252] - 1 : i > 126 ? c[i - 21] / c[i - 126] - 1 : null;
  const nearMax52 = px / ctx.max52(i) - 1 >= -P.nearHigh / 100, nearMin52 = px / ctx.min52(i) - 1 <= P.nearLow / 100;
  add(up ? `Precio sobre la media lenta (${nS})` : `Precio bajo la media lenta (${nS})`, up ? 20 : -20);
  add(sF > sS ? `Media rápida (${nF}) sobre la lenta` : `Media rápida (${nF}) bajo la lenta`, sF > sS ? 10 : -10);
  if (ok(sS20)) add(sS > sS20 ? 'Media lenta con pendiente positiva' : 'Media lenta con pendiente negativa', sS > sS20 ? 10 : -10);
  if (ok(mom)) add(withText ? `Momentum 12‑1 meses: ${pct(mom)}` : '', Math.round(Math.max(-20, Math.min(20, mom / 0.30 * 20))));
  if (ok(H)) add(H > 0 ? 'MACD con impulso positivo' : 'MACD con impulso negativo', H > 0 ? 10 : -10);
  if (ok(R)) {
    if (up && R < P.rsiOS + 10) add(withText ? `Retroceso en tendencia alcista (RSI ${fmt(R, 0)})` : '', 15);
    else if (up && R > P.rsiOB + 5) add(withText ? `Sobreextendido (RSI ${fmt(R, 0)})` : '', -10);
    else if (!up && R < P.rsiOS) add(withText ? `Sobreventa contra tendencia (RSI ${fmt(R, 0)})` : '', 5);
  }
  if (up && nearMax52) add('Fortaleza: cerca del máximo de 52 semanas', 10);
  if (!up && nearMin52) add('Debilidad: cerca del mínimo de 52 semanas', -10);
  return parts;
}

/* ============================================================
   Backtest: ¿qué hubiera pasado siguiendo las señales?
   Compra al cierre cuando el puntaje llega a "Acumular" o más; vende cuando cae a "Reducir" o menos
   (y, si el parámetro btStop lo pide, cuando toca el stop móvil). Fuera del mercado = liquidez sin interés.
   ============================================================ */
function backtest(a, P, desdeIdx = 0) {
  const rows = a.rows, n = rows.length;
  const c = rows.map(r => r.c), h = rows.map(r => r.h), l = rows.map(r => r.l);
  const m = macd(c), rsiA = rsi(c, P.rsiN), atrA = atr(h, l, c, 14);
  const onlyCloses = rows.slice(-30, -1).every(r => r.h === r.c && r.l === r.c);
  // Máximo y mínimo de 252 ruedas, móviles
  const mx = new Array(n), mn = new Array(n);
  for (let i = 0; i < n; i++) {
    let a1 = -Infinity, b1 = Infinity;
    for (let j = Math.max(0, i - 251); j <= i; j++) { if (c[j] > a1) a1 = c[j]; if (c[j] < b1) b1 = c[j]; }
    mx[i] = a1; mn[i] = b1;
  }
  const ctx = { c, smaF: a.smaF, smaS: a.smaS, rsiA, hist: m.hist, nF: a.nF, nS: a.nS, P, max52: i => mx[i], min52: i => mn[i] };
  const T = PERFILES[P.perfil] || PERFILES.moderado;
  const cost = (P.comision || 0) / 100;
  const start = Math.max(desdeIdx, a.nS + 20, 60);
  if (start >= n - 20) return null;
  let eq = 1, inPos = false, peakSince = 0, trades = [], entry = 0, daysIn = 0;
  // Tras salir por stop no se recompra enseguida: hace falta un máximo nuevo o que la señal se "resetee"
  let wait = false, exitPeak = 0;
  let peakEq = 1, mdd = 0, bh = 1, peakBh = 1, mddBh = 0;
  const curve = [{ d: rows[start].d, s: 1, b: 1 }];
  for (let i = start + 1; i < n; i++) {
    const r = c[i] / c[i - 1];
    bh *= r; peakBh = Math.max(peakBh, bh); mddBh = Math.min(mddBh, bh / peakBh - 1);
    if (inPos) { eq *= r; daysIn++; peakSince = Math.max(peakSince, c[i]); }
    // Señal al cierre de i (se ejecuta al mismo cierre: simplificación)
    const score = scoreAt(ctx, i, false).reduce((s, p) => s + p.pts, 0);
    const atrI = (atrA[i] || 0) * (onlyCloses ? 1.25 : 1);
    if (wait && (score < T.acc || c[i] > exitPeak)) wait = score >= T.acc && c[i] <= exitPeak;
    if (!inPos && !wait && score >= T.acc) {
      inPos = true; entry = c[i]; peakSince = c[i]; eq *= 1 - cost;
    } else if (inPos) {
      const stopHit = P.btStop === 'si' && c[i] < peakSince - P.atrMult * atrI;
      if (score <= T.red || stopHit) {
        inPos = false; eq *= 1 - cost; trades.push(c[i] / entry - 1);
        if (stopHit && score > T.red) { wait = true; exitPeak = peakSince; }
      }
    }
    peakEq = Math.max(peakEq, eq); mdd = Math.min(mdd, eq / peakEq - 1);
    if (i % 5 === 0 || i === n - 1) curve.push({ d: rows[i].d, s: eq, b: bh });
  }
  if (inPos) trades.push(c[n - 1] / entry - 1);
  const years = (n - 1 - start) / 252;
  const cagr = x => Math.pow(x, 1 / years) - 1;
  return {
    desde: rows[start].d, years, total: eq - 1, totalBh: bh - 1, cagr: cagr(eq), cagrBh: cagr(bh), mdd, mddBh,
    trades: trades.length, win: trades.length ? trades.filter(t => t > 0).length / trades.length : null,
    tiempo: daysIn / (n - 1 - start), curve, abierta: inPos,
  };
}

function analyze(series, row, P) {
  const { rows, cur, src } = series;
  const n = rows.length;
  if (n < 60) throw new Error('Historia insuficiente');
  const c = rows.map(r => r.c), h = rows.map(r => r.h), l = rows.map(r => r.l);
  const nF = Math.min(P.smaF, Math.floor(n / 3)), nS = Math.min(P.smaS, n - 25);
  const short = nS < P.smaS;

  const smaF = sma(c, nF), smaS = sma(c, nS);
  const rsiA = rsi(c, P.rsiN), m = macd(c), atrA = atr(h, l, c, 14);
  const px = c[n - 1], sF = last(smaF), sS = last(smaS);
  // Si la serie solo tiene cierres, el ATR cierre-a-cierre subestima el rango real (~20%)
  const onlyCloses = rows.slice(-30, -1).every(r => r.h === r.c && r.l === r.c);
  const sS20 = smaS[n - 21], R = last(rsiA), H = last(m.hist), ATR = last(atrA) * (onlyCloses ? 1.25 : 1);

  let ath = -Infinity, athI = 0, atl = Infinity, atlI = 0;
  c.forEach((v, i) => { if (v > ath) { ath = v; athI = i; } if (v < atl) { atl = v; atlI = i; } });
  const w = Math.min(252, n);
  const c52 = c.slice(n - w);
  const max52 = Math.max(...c52), min52 = Math.min(...c52);
  const ret = k => n > k ? px / c[n - 1 - k] - 1 : null;
  const mom = n > 253 ? c[n - 22] / c[n - 253] - 1 : n > 127 ? c[n - 22] / c[n - 127] - 1 : null;
  const lr = []; for (let i = Math.max(1, n - 252); i < n; i++) lr.push(Math.log(c[i] / c[i - 1]));
  const mu = lr.reduce((a, b) => a + b, 0) / lr.length;
  const vol = Math.sqrt(lr.reduce((a, b) => a + (b - mu) ** 2, 0) / (lr.length - 1) * 252);
  let peak = -Infinity, mdd = 0;
  for (let i = n - w; i < n; i++) { peak = Math.max(peak, c[i]); mdd = Math.min(mdd, c[i] / peak - 1); }

  // Cruces de medias en las últimas 20 ruedas
  let cross = null;
  for (let i = n - 1; i > n - 21 && i > 0; i--) {
    if (smaF[i] == null || smaS[i] == null || smaF[i - 1] == null || smaS[i - 1] == null) break;
    const a = smaF[i] - smaS[i], b = smaF[i - 1] - smaS[i - 1];
    if (a > 0 && b <= 0) { cross = { type: 'dorado', ago: n - 1 - i }; break; }
    if (a < 0 && b >= 0) { cross = { type: 'muerte', ago: n - 1 - i }; break; }
  }

  const up = px > sS;
  const distATH = px / ath - 1, distMax52 = px / max52 - 1, distMin52 = px / min52 - 1, distATL = px / atl - 1;
  const nearATH = distATH >= -P.nearHigh / 100;
  const nearMax52 = distMax52 >= -P.nearHigh / 100;
  const nearMin52 = distMin52 <= P.nearLow / 100;

  // ---- Puntaje (misma función que usa el backtest) ----
  const ctx = { c, smaF, smaS, rsiA, hist: m.hist, nF, nS, P, max52: () => max52, min52: () => min52 };
  const parts = scoreAt(ctx, n - 1, true);
  const score = Math.max(-100, Math.min(100, parts.reduce((a, p) => a + p.pts, 0)));

  const T = PERFILES[P.perfil] || PERFILES.moderado;
  const signal = score >= T.buy ? 'COMPRAR' : score >= T.acc ? 'ACUMULAR' : score > T.red ? 'MANTENER' : score > T.sell ? 'REDUCIR' : 'VENDER';

  // ---- Zona de precio ----
  const zone = nearATH ? 'En máximo histórico' : nearMax52 ? 'Cerca del máx. 52s'
    : distATL <= P.nearLow / 100 ? 'Cerca del mín. histórico' : nearMin52 ? 'Cerca del mín. 52s' : 'Rango medio';

  // ---- Plan: stop, objetivo, tamaño ----
  const hi22 = Math.max(...c.slice(-22));
  const trailing = nearATH || nearMax52;
  let stop = ok(ATR) ? (trailing ? hi22 : px) - P.atrMult * ATR : null;
  // Si el precio ya perforó el stop móvil, se recalcula desde el precio actual
  const stopHit = ok(stop) && stop >= px;
  if (stopHit) stop = px - P.atrMult * ATR;
  const stopPct = ok(stop) ? 1 - stop / px : null;
  let target = null, targetTxt = '';
  if (distMax52 < -0.03) { target = max52; targetTxt = 'máx. 52 semanas'; }
  else if (distATH < -0.03) { target = ath; targetTxt = 'máx. histórico'; }
  else targetTxt = 'sin resistencia: stop móvil';
  const rr = ok(target) && ok(stop) && px > stop ? (target - px) / (px - stop) : null;
  const size = ok(stopPct) && stopPct > 0 ? Math.min(20, P.riesgo / (stopPct * 100) * 100) : null;
  const entryLo = Math.min(sF, px), entryHi = px;

  // ---- Recomendación textual ----
  const M = v => money(v, cur);
  const acts = [];
  let title;
  const RSIob = ok(R) && R >= P.rsiOB, RSIos = ok(R) && R <= P.rsiOS;
  if (nearATH && up && RSIob) {
    title = 'En máximos y sobrecomprado: asegurar ganancias';
    acts.push(`Si tenés posición: tomá ganancia parcial (20–33%) y subí el stop a ${M(stop)}.`);
    acts.push(`No abras una posición grande ahora; esperá un retroceso hacia la media rápida (${M(sF)}) o RSI por debajo de 50.`);
  } else if ((nearATH || nearMax52) && up) {
    title = nearATH ? 'En máximos con tendencia sana: dejar correr' : 'Cerca del máximo anual con tendencia sana';
    acts.push('No vendas solo por estar en máximos: estadísticamente los activos en máximos tienden a seguir fuertes.');
    acts.push(stopHit
      ? `Mantené con stop en ${M(stop)} (precio actual − ${fmt(P.atrMult, 1)}×ATR).`
      : `Mantené con stop móvil en ${M(stop)} (máximo del último mes − ${fmt(P.atrMult, 1)}×ATR).`);
    acts.push(`Para entrar: de a tercios, 1/3 ahora y el resto en retrocesos hacia ${M(sF)}.`);
  } else if (up && ok(R) && R < P.rsiOS + 10) {
    title = 'Retroceso dentro de tendencia alcista: zona de compra';
    acts.push(`Compra escalonada entre ${M(sF < px ? sS : sF)} y ${M(px)}.`);
    acts.push(`Stop en ${M(stop)}; si pierde la media lenta (${M(sS)}) la tesis se debilita.`);
  } else if (up) {
    title = 'Tendencia alcista en rango medio';
    acts.push(`Comprar en retrocesos hacia la media rápida (${M(sF)}), no perseguir subidas fuertes.`);
    acts.push(`Stop de referencia: ${M(stop)}.`);
  } else if ((nearMin52 || distATL <= P.nearLow / 100) && RSIos) {
    title = 'Sobreventa extrema contra tendencia';
    acts.push('Rebote técnico posible, pero la tendencia sigue bajista.');
    acts.push(P.perfil === 'agresivo'
      ? `Solo para perfil agresivo: posición chica (mitad del tamaño normal), stop corto en ${M(stop)}.`
      : 'Para tu perfil: esperar confirmación antes de comprar.');
    acts.push(`Confirmación: precio sobre la media rápida (${M(sF)}) y MACD positivo.`);
  } else if (nearMin52 || distATL <= P.nearLow / 100) {
    title = 'Cerca de mínimos con tendencia bajista: no atajar el cuchillo';
    acts.push(`Esperá que recupere la media rápida (${M(sF)}) y que el MACD gire a positivo antes de comprar.`);
    acts.push('Si tenés posición: revisá la tesis y definí un stop; evitá promediar a la baja.');
  } else {
    title = 'Tendencia bajista';
    acts.push(`Evitar compras nuevas. Señal de reingreso: cierre sobre la media lenta (${M(sS)}).`);
    acts.push('Si tenés posición: reducir en rebotes hacia la media rápida.');
  }
  if (stopHit && trailing) acts.push(`Atención: el precio ya cayó más de ${fmt(P.atrMult, 1)}×ATR desde el máximo del último mes (${M(hi22)}): quien venía con stop móvil ya habría salido.`);
  if (cross) acts.push(cross.type === 'dorado'
    ? `Cruce dorado hace ${cross.ago} ruedas (media rápida cruzó arriba de la lenta): señal alcista de mediano plazo.`
    : `Cruce de la muerte hace ${cross.ago} ruedas (media rápida cruzó debajo de la lenta): señal bajista de mediano plazo.`);
  if (distATH < -0.5) acts.push(`Cotiza ${pct(-distATH, 0, false)} debajo de su máximo histórico: hay recorrido de recuperación, pero conviene actuar solo con tendencia confirmada.`);
  if (vol > 0.5) acts.push(`Volatilidad alta (${pct(vol, 0, false)} anual): reducí el tamaño de la posición.`);
  const B = bondInfo(row);
  if (B) {
    acts.push(B.kind === 'lecap'
      ? `Tasa fija en pesos: ${pct(B.tir, 2, false)} efectiva anual (${pct(B.tem, 2, false)} mensual) hasta el ${B.venc}. Conviene si esperás que la inflación y las tasas queden por debajo de eso.`
      : B.kind === 'cer'
        ? `Rinde CER ${B.tir >= 0 ? '+' : ''}${pct(B.tir, 2, false)}: inflación más esa tasa real hasta el ${B.venc}. Protege contra la inflación; conviene frente a una LECAP si esperás más inflación que la implícita.`
        : `TIR ${pct(B.tir, 2, false)} anual en dólares: es lo que rinde si lo mantenés hasta el vencimiento (${B.venc}), cobrás todos los pagos y reinvertís a la misma tasa.`);
    acts.push(`Duration modificada ${fmt(B.md, 1)}: si la TIR baja 1 punto, el precio sube cerca de ${fmt(B.md, 1)}% (y al revés si sube).`);
    if (B.paridad < 0.75) acts.push(`Paridad ${pct(B.paridad, 0, false)}: cotiza bien debajo de su valor técnico, con margen de suba si sigue bajando el riesgo país.`);
  } else if (row.tab === 'bonos') acts.push(nearATH || nearMax52
    ? 'Bono cerca de máximos = TIR comprimida: el retorno extra depende de cupones y de una baja adicional del riesgo país.'
    : 'En bonos, la caída de precio sube la TIR: si confiás en el pago, retrocesos con tendencia de fondo positiva suelen ser oportunidad.');
  if (short) acts.push(`Historia corta (${n} ruedas): la media lenta se calculó con ${nS} ruedas. Tomar la señal con cautela.`);

  return {
    tab: row.tab, sym: row.sym, cur, src, n, rows, smaF, smaS, rsiA, nF, nS,
    px, sF, sS, R, H, ATR, ath, athD: rows[athI].d, atl, atlD: rows[atlI].d, max52, min52,
    distATH, distMax52, distMin52, pos52: max52 > min52 ? (px - min52) / (max52 - min52) : 0.5,
    r1m: ret(21), r3m: ret(63), r6m: ret(126), r12m: ret(252), ytd: ytd(rows), mom, vol, mdd, up, cross,
    score, signal, parts, zone, title, acts, stop, stopPct, target, targetTxt, rr, size, entryLo, entryHi,
  };
}

function ytd(rows) {
  const y = today().slice(0, 4);
  const i = rows.findIndex(r => r.d >= y + '-01-01');
  if (i <= 0) return null;
  return rows[rows.length - 1].c / rows[i - 1].c - 1;
}

async function analyzeRow(row) {
  const key = row.tab + ':' + row.sym;
  try {
    const series = await getSeries(row);
    S.an[key] = analyze(series, row, S.params);
  } catch (e) {
    S.an[key] = { err: e.message || 'Error' };
  }
  return S.an[key];
}

/* Cola de análisis automática: todo lo que se pide se analiza en segundo plano.
   front = pasa adelante (la pestaña que estás mirando); force = recalcula aunque ya esté analizado. */
const AQ = { queue: [], pending: new Map(), running: false, total: 0, done: 0 };
function analyzeMany(rows, opts = {}) {
  const proms = [], add = [];
  for (const r of rows) {
    if (!r || r.tab === 'ons') continue;
    const k = r.tab + ':' + r.sym;
    const pend = AQ.pending.get(k);
    if (pend) {
      proms.push(pend.p);
      if (opts.front) { const i = AQ.queue.indexOf(r); if (i > 0) { AQ.queue.splice(i, 1); add.push(r); } }
      continue;
    }
    if (S.an[k] && !opts.force) continue;
    let res; const p = new Promise(x => res = x);
    AQ.pending.set(k, { p, res });
    add.push(r); proms.push(p);
    AQ.total++;
  }
  if (opts.front) AQ.queue.unshift(...add); else AQ.queue.push(...add.filter(r => !AQ.queue.includes(r)));
  if (!AQ.running && AQ.queue.length) runQueue();
  return Promise.all(proms);
}
async function runQueue() {
  AQ.running = S.busy = true;
  if (S.params.moneda === 'USD') { try { await loadCCL(); } catch { } }
  const worker = async () => {
    while (AQ.queue.length) {
      const r = AQ.queue.shift(), k = r.tab + ':' + r.sym;
      await analyzeRow(r);
      AQ.done++;
      const pend = AQ.pending.get(k);
      if (pend) { pend.res(); AQ.pending.delete(k); }
      progress(AQ.done / AQ.total);
      setStatus(`Analizando ${AQ.done}/${AQ.total}…`);
      if (AQ.done % 6 === 0) renderTable();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  AQ.running = S.busy = false; AQ.total = AQ.done = 0;
  progress(null);
  setStatus('');
  renderTable();
}
// Analiza todo lo de la pestaña actual, primero lo de más volumen
function autoAnalyze(tab) {
  let rows;
  if (tab === 'favoritos') rows = [...S.fav].map(findRow).filter(Boolean);
  else rows = (S.live[tab] || []).filter(r => !r.variant).sort((a, b) => b.monto - a.monto);
  if (rows.length) analyzeMany(rows, { front: true });
}

// Re-calcula con nuevos parámetros o precios (mientras tanto se ven los valores anteriores)
async function reanalyzeAll() {
  const rows = Object.keys(S.an).map(k => findRow(k)).filter(Boolean);
  if (rows.length) await analyzeMany(rows, { force: true });
}
function findRow(key) {
  const [tab, sym] = key.split(':');
  return (S.live[tab] || []).find(r => r.sym === sym);
}

/* ============================================================
   Render: barra de dólares
   ============================================================ */
function renderFX() {
  const it = (label, v, sub) => v ? `<span class="it">${label}<b>$${fmt(v, 0)}</b>${sub ? ` <small>${sub}</small>` : ''}</span>` : '';
  $('#fx').innerHTML = it('Oficial', S.fx.oficial) + it('MEP', S.fx.bolsa) + it('CCL', S.fx.contadoconliqui) + it('Blue', S.fx.blue) + cerChip();
}
// CER que usan los bonos que se compran hoy: liquidación T+1 menos 10 días hábiles
function cerChip() {
  if (!S.cer || !S.cer.length) return '';
  const settle = settleDate(today()), ref = businessDaysBack(settle, 10), v = cerAt(ref);
  if (!v) return '';
  const f = d => d.slice(8, 10) + '/' + d.slice(5, 7);
  const hoy = cerAt(today());
  const tip = `CER del ${f(ref)} (10 días hábiles antes de la liquidación del ${f(settle)}): es el que se usa para ajustar los bonos CER que comprás hoy.`
    + (hoy ? ` CER de hoy: ${fmt(hoy, 4)}.` : '') + ' Fuente: BCRA.';
  return `<span class="it" title="${esc(tip)}">CER<b>${fmt(v, 4)}</b> <small>${f(ref)}</small></span>`;
}

/* ============================================================
   Render: tabla
   ============================================================ */
const COLS = [
  { k: 'fav', t: '★', l: true, sort: r => S.fav.has(r.tab + ':' + r.sym) ? 1 : 0 },
  { k: 'sym', t: 'Ticker', l: true, sort: r => r.sym },
  { k: 'tipo', t: 'Tipo', l: true, onlyFav: true, sort: r => r.tab },
  { k: 'c', t: 'Último', sort: r => r.c },
  { k: 'chg', t: 'Var. día', sort: r => r.chg },
  { k: 'usd', t: 'US$ (CCL)', sort: r => usdPx(r) },
  { k: 'monto', t: 'Monto op.', sort: r => r.monto },
  { k: 'tir', t: 'TIR', onlyBonos: true, sort: r => bondInfo(r)?.tir ?? -9 },
  { k: 'md', t: 'Dur. mod.', onlyBonos: true, sort: r => bondInfo(r)?.md ?? -9 },
  { k: 'paridad', t: 'Paridad', onlyBonos: 'bonos', sort: r => bondInfo(r)?.paridad ?? -9 },
  { k: 'curva', t: 'vs curva', onlyBonos: true, sort: r => curveRes(r) ?? -1e9 },
  { k: 'venc', t: 'Vencimiento', onlyBonos: 'ons', sort: r => bondInfo(r)?.venc ?? '' },
  { k: 'signal', t: 'Señal', l: true, sort: r => an(r)?.score ?? -999 },
  { k: 'score', t: 'Puntaje', sort: r => an(r)?.score ?? -999 },
  { k: 'zone', t: 'Zona', l: true, sort: r => an(r)?.distATH ?? -9 },
  { k: 'ath', t: 'vs Máx. hist.', sort: r => an(r)?.distATH ?? -9 },
  { k: 'r52', t: 'Rango 52s', sort: r => an(r)?.pos52 ?? -1 },
  { k: 'rsi', t: 'RSI', sort: r => an(r)?.R ?? -1 },
  { k: 'r3m', t: '3 m', sort: r => an(r)?.r3m ?? -9 },
  { k: 'r12m', t: '12 m', sort: r => an(r)?.r12m ?? -9 },
  { k: 'vol', t: 'Volat.', sort: r => an(r)?.vol ?? -1 },
];
const an = r => { const a = S.an[r.tab + ':' + r.sym]; return a && !a.err ? a : null; };
const usdPx = r => r.variant ? r.c : r.usdD && r.tab === 'bonos' ? r.usdD : r.c / (currentCCL() || NaN);

function visibleRows() {
  let rows;
  if (S.tab === 'favoritos') {
    rows = [...S.fav].map(findRow).filter(Boolean);
  } else rows = S.live[S.tab] || [];
  const q = $('#q').value.trim().toUpperCase();
  const sig = $('#sigFilter').value;
  const showVar = $('#fVar').checked, onlyVol = $('#fVol').checked, onlyLider = $('#fLider').checked;
  rows = rows.filter(r => {
    if (q && !r.sym.includes(q)) return false;
    if (S.tab === 'favoritos') return sigOk(r, sig);
    if (!showVar && r.variant) return false;
    if (onlyVol && !(r.v > 0)) return false;
    if (onlyLider && S.tab === 'acciones' && !LIDER.has(r.sym)) return false;
    if ($('#fTir').checked && (S.tab === 'bonos' || S.tab === 'ons') && !bondInfo(r)) return false;
    return sigOk(r, sig);
  });
  const col = COLS.find(c => c.k === S.sort.k) || COLS[6];
  rows.sort((a, b) => {
    const x = col.sort(a), y = col.sort(b);
    if (typeof x === 'string') return x.localeCompare(y) * S.sort.dir;
    return ((ok(x) ? x : -Infinity) - (ok(y) ? y : -Infinity)) * S.sort.dir || 0;
  });
  return rows;
}
function sigOk(r, sig) {
  if (!sig) return true;
  const a = an(r);
  if (sig === '__sin') return !a;
  return a && a.signal === sig;
}

function renderTable() {
  if (S.tab === 'estrategia') return;
  const fixedIncome = S.tab === 'bonos' || S.tab === 'ons';
  const cols = COLS.filter(c => (!c.onlyFav || S.tab === 'favoritos')
    && (!c.onlyBonos || (c.onlyBonos === true ? fixedIncome : S.tab === c.onlyBonos))
    && !(S.tab === 'ons' && ['signal', 'score', 'zone', 'ath', 'r52', 'rsi', 'r3m', 'r12m', 'vol'].includes(c.k)));
  $('#tbl thead').innerHTML = '<tr>' + cols.map(c =>
    `<th data-k="${c.k}" class="${c.l ? 'l' : ''} ${S.sort.k === c.k ? 'sorted' : ''}">${c.t}${S.sort.k === c.k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '</tr>';
  const rows = visibleRows();
  const MAX = 400;
  const html = rows.slice(0, MAX).map(r => {
    const key = r.tab + ':' + r.sym;
    const a = S.an[key];
    const A = a && !a.err ? a : null;
    const cur = r.variant ? 'USD' : 'ARS';
    const B = fixedIncome ? bondInfo(r) : null;
    const cell = {
      tir: B ? (B.raro ? `<span class="muted" title="TIR fuera de rango: el precio puede estar desactualizado o la especie tener poca liquidez">${tirLabel(B, 1)} ?</span>` : `<b title="${tirHelp(B)}">${tirLabel(B, 2)}</b>`) : '',
      md: B ? fmt(B.md, 2) : '',
      paridad: B && ok(B.paridad) ? pct(B.paridad, 1, false) : '',
      venc: B ? B.venc : '',
      curva: (() => { const x = B && curveRes(r); return ok(x) ? `<span class="${x > 0 ? 'up' : 'down'}" title="${x > 0 ? 'Rinde más que la curva: relativamente barato' : 'Rinde menos que la curva: relativamente caro'}">${x > 0 ? '+' : ''}${fmt(x, 0)} pb</span>` : ''; })(),
      fav: `<span class="star ${S.fav.has(key) ? 'on' : ''}" data-fav="${esc(key)}">★</span>`,
      sym: `<span class="tk">${esc(r.sym)}</span>${r.variant ? ` <span class="muted">${r.variant === 'D' ? 'MEP' : 'cable'}</span>` : ''}${LIDER.has(r.sym) && r.tab === 'acciones' ? ' <span class="muted">•</span>' : ''}`,
      tipo: TAB_LABEL[r.tab],
      c: (cur === 'USD' ? 'US$ ' : '') + fmt(r.c),
      chg: `<span class="${cls(r.chg)}">${pct(r.chg, 2)}</span>`,
      usd: fmt(usdPx(r)),
      monto: compact(r.monto),
      signal: a?.err ? `<span class="sig s-ERR" title="${esc(a.err)}">${r.tab === 'ons' ? 'sin histórico' : esc(a.err)}</span>` : A ? `<span class="sig s-${A.signal}">${A.signal}</span>` : '<span class="muted">—</span>',
      score: A ? `<span class="score ${cls(A.score)}">${A.score > 0 ? '+' : ''}${A.score}</span>` : '',
      zone: A ? `<span class="zone">${A.zone}</span>` : '',
      ath: A ? `<span class="${A.distATH > -0.05 ? 'up' : ''}">${pct(A.distATH, 0)}</span>` : '',
      r52: A ? `<span class="range" title="Mín ${fmt(A.min52)} · Máx ${fmt(A.max52)}"><i style="left:calc(${(A.pos52 * 100).toFixed(0)}% - 2px)"></i></span>` : '',
      rsi: A ? `<span class="${A.R >= S.params.rsiOB ? 'down' : A.R <= S.params.rsiOS ? 'up' : ''}">${fmt(A.R, 0)}</span>` : '',
      r3m: A ? `<span class="${cls(A.r3m)}">${pct(A.r3m, 0)}</span>` : '',
      r12m: A ? `<span class="${cls(A.r12m)}">${pct(A.r12m, 0)}</span>` : '',
      vol: A ? pct(A.vol, 0, false) : '',
    };
    return `<tr data-key="${esc(key)}">` + cols.map(c => `<td class="${c.l ? 'l' : ''}">${cell[c.k]}</td>`).join('') + '</tr>';
  }).join('');
  $('#tbl tbody').innerHTML = html || `<tr><td class="l muted" colspan="${cols.length}">${S.tab === 'favoritos' ? 'Todavía no marcaste favoritos (★).' : 'Sin resultados.'}</td></tr>`;

  // Resumen de señales
  const counts = {};
  let analyzed = 0;
  rows.forEach(r => { const A = an(r); if (A) { analyzed++; counts[A.signal] = (counts[A.signal] || 0) + 1; } });
  $('#summary').innerHTML = `<span>${rows.length} instrumentos${rows.length > MAX ? ` (mostrando ${MAX})` : ''} · ${analyzed} analizados</span>` +
    ['COMPRAR', 'ACUMULAR', 'MANTENER', 'REDUCIR', 'VENDER'].filter(s => counts[s]).map(s => `<span class="sig s-${s}">${s} ${counts[s]}</span>`).join('') +
    (S.liveTime ? `<span class="spacer"></span><span>Cotizaciones: ${S.liveTime.toLocaleTimeString('es-AR')} · moneda de análisis: ${S.params.moneda === 'USD' ? 'US$ CCL' : 'pesos'}</span>` : '');

  const notes = {
    acciones: 'Hacé clic en una fila para ver el análisis completo. "•" = panel líder. Los precios están en pesos; el análisis usa dólar CCL por defecto.',
    cedears: 'CEDEARs: acciones/ETFs del exterior que se operan en BYMA con cualquier broker argentino. Las especies D (MEP) y C (cable) están ocultas por defecto.',
    bonos: 'TIR en dólares para soberanos y BOPREAL (precio MEP); "$" = tasa efectiva anual en pesos (LECAP/BONCAP); "CER +x%" = tasa real sobre inflación. "?" = valor dudoso. Ordená por TIR haciendo clic en la columna.',
    ons: 'Obligaciones negociables en dólares: TIR y duration para ~40 ONs con flujos cargados (tildá "Solo con TIR"). Especies O = pesos, D = dólar MEP, C = cable. No hay histórico para análisis técnico.',
    favoritos: 'Tus instrumentos marcados con ★ (se guardan en este navegador).',
  };
  $('#tabNote').textContent = notes[S.tab] || '';
}

/* ============================================================
   Render: detalle
   ============================================================ */
let chartRange = '1a', chartLog = false, curDetail = null;

async function openDetail(key) {
  const row = findRow(key);
  if (!row) return;
  const box = $('#detail');
  box.hidden = false; $('#backdrop').hidden = false;
  box.innerHTML = `<div class="drawer-head"><h2>${esc(row.sym)}</h2><button class="x" data-close="detail">✕</button></div><div class="detail-body"><p class="muted">Cargando histórico…</p></div>`;
  if (row.tab === 'ons') {
    const B = bondInfo(row);
    let reco = '';
    if (B && !B.raro) {
      reco = `<div class="reco"><h3>Obligación negociable: rinde ${pct(B.tir, 2, false)} anual en dólares</h3><ul>
        <li>Si la mantenés hasta el vencimiento (${B.venc}) y la empresa paga, obtenés esa TIR. Por cada US$ ${fmt(B.price, 2)} invertidos cobrás US$ ${fmt(B.totalCobro, 2)} en total.</li>
        <li>Duration ${fmt(B.md, 1)}: ${B.md < 1.5 ? 'plazo corto, el precio se mueve poco ante cambios de tasa.' : B.md < 4 ? 'plazo medio, sensibilidad moderada a la tasa.' : 'plazo largo, el precio es sensible a cambios de tasa o riesgo.'}</li>
        <li>Compará contra soberanos de duration parecida: una ON suele rendir menos que el soberano si la empresa es sólida (y exporta), y más si el riesgo crediticio es mayor.</li>
        <li>Diversificá entre emisores: el riesgo principal de una ON es el crédito de la empresa.</li></ul></div>`;
    }
    box.querySelector('.detail-body').innerHTML = liveBlock(row) + reco + bondBlock(row) + (typeof newsFor === 'function' ? newsFor(row) : '') +
      `<p class="muted">${B ? '' : 'No hay flujos de fondos cargados para esta ON, así que no se puede calcular la TIR. '}La fuente no publica histórico de ONs, por eso no hay análisis técnico.</p>`;
    return;
  }
  let a = S.an[key];
  if (!a || a.err || !a.rows) { if (S.params.moneda === 'USD') { try { await loadCCL(); } catch { } } a = await analyzeRow(row); renderTable(); }
  if (a.err) { box.querySelector('.detail-body').innerHTML = liveBlock(row) + bondBlock(row) + (typeof newsFor === 'function' ? newsFor(row) : '') + `<p class="muted">No se pudo hacer el análisis técnico: ${esc(a.err)}</p>`; return; }
  curDetail = a;
  renderDetail(row, a);
}

function bondBlock(row) {
  const B = bondInfo(row);
  if (!B) return '';
  const kv = (k, v, sub) => `<div class="kv"><div class="k">${k}</div><div class="v">${v}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;
  const shown = B.flows.slice(0, 12);
  const split = ok(B.flows[0].int);
  return `
    <h4>Renta fija · ${esc(B.name)}${B.law ? ` (${B.law === 'BCRA' ? 'emisor BCRA' : 'ley ' + B.law})` : ''} · precio ${B.kind === 'usd' ? 'US$' : '$'} ${fmt(B.price, 2)} por 100 VN</h4>
    ${B.raro ? '<p class="note" style="color:var(--warn)">La TIR da fuera de un rango razonable: probablemente el precio esté desactualizado (poca liquidez) o los flujos no coincidan con la especie. Tomala con cautela.</p>' : ''}
    <div class="plan">
      ${kv(B.kind === 'cer' ? 'Tasa real' : 'TIR', `<b>${tirLabel(B, 2)}</b>`, B.kind === 'lecap' ? 'TEA en pesos' : B.kind === 'cer' ? 'anual sobre inflación' : 'anual en US$')}
      ${B.kind === 'lecap' ? kv('TEM', pct(B.tem, 2, false), `TNA ${pct(B.tna, 2, false)}`) + kv('Días al vencimiento', fmt(B.dias, 0)) : ''}
      ${B.kind === 'cer' ? kv('Coeficiente CER', fmt(B.coef, 4), `CER ${fmt(B.cerRef, 2)} (10 días hábiles antes)`) + kv('Precio real', fmt(B.realPrice, 2), 'precio ÷ coeficiente CER') : ''}
      ${kv('Duration modificada', fmt(B.md, 2), `Macaulay ${fmt(B.dur, 2)} años`)}
      ${ok(B.paridad) ? kv('Paridad', pct(B.paridad, 1, false), B.kind === 'cer' ? 'precio real ÷ capital residual' : 'precio ÷ valor técnico') : ''}
      ${ok(B.vt) ? kv('Valor técnico', 'US$ ' + fmt(B.vt, 2), `residual ${fmt(B.resid, 2)} + corridos ${fmt(B.accrued, 2)}`) : ''}
      ${ok(B.cupon) ? kv('Cupón vigente', pct(B.cupon, 3, false), `rendimiento corriente ${pct(B.cy, 1, false)}`) : ''}
      ${kv('Vencimiento', B.venc)}
      ${(() => { const x = curveRes(row); return ok(x) ? kv('vs curva', `<span class="${x > 0 ? 'up' : 'down'}">${x > 0 ? '+' : ''}${fmt(x, 0)} pb</span>`, x > 0 ? 'rinde más que sus pares: relativamente barato' : 'rinde menos que sus pares: relativamente caro') : ''; })()}
      ${kv('Próximo pago', B.next.d, `${B.kind === 'usd' ? 'US$' : B.kind === 'cer' ? 'real' : '$'} ${fmt(B.next.total, 2)} cada 100 VN`)}
      ${kv('Cobro total restante', (B.kind === 'usd' ? 'US$ ' : B.kind === 'lecap' ? '$ ' : '') + fmt(B.totalCobro, 2), B.kind === 'cer' ? 'en valores reales (× CER)' : `vs precio ${fmt(B.price, 2)}`)}
    </div>
    <table class="breakdown">
      ${split
        ? `<tr><td class="muted">Fecha</td><td class="muted" style="text-align:right">Interés</td><td class="muted" style="text-align:right">Amortización</td><td class="muted">Total</td></tr>
           ${shown.map(f => `<tr><td>${f.d}</td><td style="text-align:right;font-weight:400">${fmt(f.int, 3)}</td><td style="text-align:right;font-weight:400">${fmt(f.amo, 3)}</td><td>${fmt(f.total, 3)}</td></tr>`).join('')}`
        : `<tr><td class="muted">Fecha</td><td class="muted">Pago (interés + amortización)</td></tr>
           ${shown.map(f => `<tr><td>${f.d}</td><td>${fmt(f.total, 3)}</td></tr>`).join('')}`}
      ${B.flows.length > shown.length ? `<tr><td colspan="4" class="muted">… ${B.flows.length - shown.length} pagos más hasta ${B.venc}</td></tr>` : ''}
    </table>
    <p class="note">Flujos por cada 100 de valor nominal original (fuente: ${esc(B.src)}${S.flujos && B.src === S.flujos.fuente ? `, descargados el ${S.flujos.descargado}` : ''}). Liquidación ${B.settle} (24 hs). La TIR supone que el emisor paga en tiempo y forma.</p>`;
}

function liveBlock(row) {
  return `<div class="plan">
    <div class="kv"><div class="k">Último</div><div class="v">${fmt(row.c)}</div></div>
    <div class="kv"><div class="k">Variación</div><div class="v ${cls(row.chg)}">${pct(row.chg, 2)}</div></div>
    <div class="kv"><div class="k">Compra / Venta</div><div class="v">${fmt(row.bid)} / ${fmt(row.ask)}</div></div>
    <div class="kv"><div class="k">Monto operado</div><div class="v">${compact(row.monto)}</div></div></div>`;
}

function renderDetail(row, a) {
  const M = v => money(v, a.cur);
  const key = row.tab + ':' + row.sym;
  const kv = (k, v, sub) => `<div class="kv"><div class="k">${k}</div><div class="v">${v}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;
  $('#detail').innerHTML = `
    <div class="drawer-head">
      <h2>${esc(row.sym)} <span class="muted" style="font-size:13px;font-weight:400">${TAB_LABEL[row.tab]}</span>
        <span class="star ${S.fav.has(key) ? 'on' : ''}" data-fav="${esc(key)}">★</span></h2>
      <button class="x" data-close="detail">✕</button>
    </div>
    <div class="detail-body">
      <div class="dhead">
        <span class="px">${M(a.px)}</span>
        <span class="muted">${row.variant ? '' : `$ ${fmt(row.c)} en pesos ·`} <span class="${cls(row.chg)}">${pct(row.chg, 2)} hoy</span></span>
        <span class="sig s-${a.signal}" style="font-size:14px">${a.signal}</span>
        <span class="score ${cls(a.score)}" style="font-size:18px">${a.score > 0 ? '+' : ''}${a.score}</span>
        <span class="zone">${a.zone}</span>
      </div>

      <div class="reco" style="border-left-color:var(--c-${a.signal.toLowerCase()})">
        <h3>${a.title}</h3>
        <ul>${a.acts.map(x => `<li>${x}</li>`).join('')}</ul>
      </div>

      <div class="plan">
        ${kv('Zona de entrada', a.up ? `${M(a.entryLo)} – ${M(a.entryHi)}` : '<span class="muted">esperar</span>')}
        ${kv('Stop sugerido', M(a.stop), ok(a.stopPct) ? '−' + pct(a.stopPct, 1, false) : '')}
        ${kv('Objetivo', ok(a.target) ? M(a.target) : '—', a.targetTxt)}
        ${kv('Riesgo / beneficio', ok(a.rr) ? fmt(a.rr, 1) + ' : 1' : '—')}
        ${kv('Tamaño sugerido', ok(a.size) ? pct(a.size / 100, 1, false) : '—', `de la cartera (riesgo ${fmt(S.params.riesgo, 2)}%)`)}
      </div>
      ${bondBlock(row)}
      ${typeof newsFor === 'function' ? newsFor(row) : ''}

      <div class="chartbox">
        <div class="ctrl">
          ${['6m', '1a', '3a', '5a', 'max'].map(r => `<button data-range="${r}" class="${chartRange === r ? 'on' : ''}">${r === 'max' ? 'Todo' : r}</button>`).join('')}
          <button data-log="1" class="${chartLog ? 'on' : ''}">Log</button>
          <span class="legend">
            <span><i style="background:#e6edf3"></i>Precio</span>
            <span><i style="background:#4ea1ff"></i>Media ${a.nF}</span>
            <span><i style="background:#e8b339"></i>Media ${a.nS}</span>
            <span><i style="background:#2fbf71"></i>Máx. hist.</span>
            <span><i style="background:#f0565b"></i>Stop</span>
          </span>
        </div>
        <canvas id="chart"></canvas>
      </div>

      <h4>Indicadores (${a.cur === 'USD' ? 'en dólares' : 'en pesos'} · ${esc(a.src)})</h4>
      <div class="plan">
        ${kv('Máximo histórico', M(a.ath), a.athD)}
        ${kv('Distancia al máx.', `<span class="${cls(a.distATH)}">${pct(a.distATH)}</span>`)}
        ${kv('Mínimo histórico', M(a.atl), a.atlD)}
        ${kv('Máx. / mín. 52s', `${M(a.max52)}<br>${M(a.min52)}`)}
        ${kv('RSI ' + S.params.rsiN, fmt(a.R, 1), a.R >= S.params.rsiOB ? 'sobrecompra' : a.R <= S.params.rsiOS ? 'sobreventa' : 'neutral')}
        ${kv('MACD hist.', `<span class="${cls(a.H)}">${fmt(a.H, 4)}</span>`)}
        ${kv(`Media ${a.nF}`, M(a.sF), pct(a.px / a.sF - 1))}
        ${kv(`Media ${a.nS}`, M(a.sS), pct(a.px / a.sS - 1))}
        ${kv('ATR 14', M(a.ATR), pct(a.ATR / a.px, 1, false))}
        ${kv('Volatilidad anual', pct(a.vol, 0, false))}
        ${kv('Máx. caída 12m', `<span class="down">${pct(a.mdd, 0)}</span>`)}
        ${kv('Momentum 12‑1', `<span class="${cls(a.mom)}">${pct(a.mom)}</span>`)}
      </div>

      <h4>Rendimientos${row.tab === 'cedears' && /EE\.UU\./.test(a.src) ? ' <span style="text-transform:none;letter-spacing:0">(incluyen dividendos reinvertidos)</span>' : row.tab === 'acciones' ? ' <span style="text-transform:none;letter-spacing:0">(solo precio, sin dividendos)</span>' : ''}</h4>
      <div class="plan">
        ${[['1 mes', a.r1m], ['3 meses', a.r3m], ['6 meses', a.r6m], ['12 meses', a.r12m], ['En el año', a.ytd]].map(([k, v]) => kv(k, `<span class="${cls(v)}">${pct(v)}</span>`)).join('')}
      </div>

      <h4>Backtest: ¿funcionó la estrategia en ${esc(row.sym)}?</h4>
      <div id="btBox"><button id="btnBacktest" class="primary">Probar la estrategia con la historia de ${esc(row.sym)}</button>
        <span class="muted" style="font-size:12px">Simula comprar y vender según las señales, contra comprar y mantener.</span></div>

      <h4>Cómo se armó el puntaje</h4>
      <table class="breakdown">
        ${a.parts.map(p => `<tr><td>${p.txt}</td><td class="${cls(p.pts)}">${p.pts > 0 ? '+' : ''}${p.pts}</td></tr>`).join('')}
        <tr><td><b>Total</b> (perfil ${S.params.perfil})</td><td class="${cls(a.score)}">${a.score > 0 ? '+' : ''}${a.score}</td></tr>
      </table>
      <p class="note">${a.n} ruedas de historia (${a.rows[0].d} a ${a.rows[a.rows.length - 1].d}). Análisis técnico con fines educativos; no es asesoramiento financiero.</p>
    </div>`;
  drawChart();
}

/* ============================================================
   Gráfico (canvas)
   ============================================================ */
function drawChart(hoverX) {
  const cv = $('#chart');
  if (!cv || !curDetail) return;
  const a = curDetail;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, Hh = cv.clientHeight;
  cv.width = W * dpr; cv.height = Hh * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const N = { '6m': 126, '1a': 252, '3a': 756, '5a': 1260, max: Infinity }[chartRange];
  const s = Math.max(0, a.rows.length - N);
  const rows = a.rows.slice(s), F = a.smaF.slice(s), L = a.smaS.slice(s), RS = a.rsiA.slice(s);
  const padL = 8, padR = 64, top = 8, priceH = Hh * 0.72, rsiTop = priceH + 18, rsiH = Hh - rsiTop - 18;
  const plotW = W - padL - padR;

  const vals = rows.flatMap(r => [r.c]).concat(F.filter(ok), L.filter(ok));
  if (ok(a.stop)) vals.push(a.stop);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (a.ath <= hi * 1.15) hi = Math.max(hi, a.ath);
  const useLog = chartLog && lo > 0;
  const tf = v => useLog ? Math.log(v) : v;
  const tLo = tf(lo), tHi = tf(hi);
  const pad = (tHi - tLo) * 0.06 || 1;
  const y = v => top + (1 - (tf(v) - (tLo - pad)) / ((tHi + pad) - (tLo - pad))) * (priceH - top);
  const x = i => padL + (rows.length === 1 ? 0 : i / (rows.length - 1) * plotW);

  g.font = '11px Segoe UI, sans-serif';
  g.textBaseline = 'middle';
  // grilla
  g.strokeStyle = '#273243'; g.fillStyle = '#8b98a8'; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const tv = (tLo - pad) + ((tHi + pad) - (tLo - pad)) * k / 4;
    const v = useLog ? Math.exp(tv) : tv;
    const yy = y(v);
    g.beginPath(); g.moveTo(padL, yy); g.lineTo(padL + plotW, yy); g.stroke();
    g.fillText(fmt(v), padL + plotW + 6, yy);
  }
  // fechas
  g.textBaseline = 'top';
  for (let k = 0; k <= 4; k++) {
    const i = Math.round((rows.length - 1) * k / 4);
    const t = rows[i].d;
    const tw = g.measureText(t).width;
    g.fillText(t, Math.min(Math.max(padL, x(i) - tw / 2), padL + plotW - tw), priceH + 2);
  }
  const line = (arr, color, w, get = v => v) => {
    g.strokeStyle = color; g.lineWidth = w; g.beginPath();
    let st = false;
    arr.forEach((v, i) => { const val = get(v); if (!ok(val)) { st = false; return; } st ? g.lineTo(x(i), y(val)) : g.moveTo(x(i), y(val)); st = true; });
    g.stroke();
  };
  const hline = (v, color, label) => {
    if (!ok(v) || v < lo * 0.5 || v > hi * 1.2) return;
    const yy = y(v);
    if (yy < top || yy > priceH) return;
    g.setLineDash([5, 4]); g.strokeStyle = color; g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, yy); g.lineTo(padL + plotW, yy); g.stroke(); g.setLineDash([]);
    g.fillStyle = color; g.textBaseline = 'bottom'; g.fillText(label, padL + 4, yy - 2);
  };
  hline(a.ath, '#2fbf71', 'Máx. histórico ' + fmt(a.ath));
  hline(a.stop, '#f0565b', 'Stop ' + fmt(a.stop));
  line(L, '#e8b339', 1.4);
  line(F, '#4ea1ff', 1.4);
  line(rows, '#e6edf3', 1.6, r => r.c);

  // RSI
  const ry = v => rsiTop + (1 - v / 100) * rsiH;
  g.fillStyle = 'rgba(78,161,255,0.06)';
  g.fillRect(padL, ry(S.params.rsiOB), plotW, ry(S.params.rsiOS) - ry(S.params.rsiOB));
  g.strokeStyle = '#273243'; g.lineWidth = 1;
  [S.params.rsiOB, S.params.rsiOS].forEach(v => { g.beginPath(); g.moveTo(padL, ry(v)); g.lineTo(padL + plotW, ry(v)); g.stroke(); });
  g.fillStyle = '#8b98a8'; g.textBaseline = 'middle';
  g.fillText('RSI', padL + plotW + 6, rsiTop + rsiH / 2);
  g.fillText(S.params.rsiOB, padL + plotW + 30, ry(S.params.rsiOB));
  g.fillText(S.params.rsiOS, padL + plotW + 30, ry(S.params.rsiOS));
  g.strokeStyle = '#b48ef0'; g.lineWidth = 1.2; g.beginPath();
  let st = false;
  RS.forEach((v, i) => { if (!ok(v)) return; st ? g.lineTo(x(i), ry(v)) : g.moveTo(x(i), ry(v)); st = true; });
  g.stroke();

  // cursor
  if (hoverX != null && hoverX >= padL && hoverX <= padL + plotW) {
    const i = Math.round((hoverX - padL) / plotW * (rows.length - 1));
    const r = rows[i];
    g.strokeStyle = '#8b98a8'; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(x(i), top); g.lineTo(x(i), Hh - 18); g.stroke(); g.setLineDash([]);
    const txt = `${r.d}  ${fmt(r.c)}${ok(F[i]) ? `  M${a.nF} ${fmt(F[i])}` : ''}${ok(L[i]) ? `  M${a.nS} ${fmt(L[i])}` : ''}${ok(RS[i]) ? `  RSI ${fmt(RS[i], 0)}` : ''}`;
    const tw = g.measureText(txt).width + 12;
    const bx = Math.min(Math.max(padL, x(i) - tw / 2), padL + plotW - tw);
    g.fillStyle = '#0f1419ee'; g.fillRect(bx, top, tw, 20);
    g.fillStyle = '#e6edf3'; g.textBaseline = 'middle'; g.fillText(txt, bx + 6, top + 10);
    g.fillStyle = '#e6edf3'; g.beginPath(); g.arc(x(i), y(r.c), 3, 0, 7); g.fill();
  }
}

/* ============================================================
   Parámetros
   ============================================================ */
function renderParams() {
  const P = S.params;
  $('#paramsForm').innerHTML = PARAM_SPEC.map(p => {
    if (p.grp) return `<div class="grp">${p.grp}</div>`;
    const input = p.type === 'select'
      ? `<select name="${p.k}">${p.opts.map(([v, t]) => `<option value="${v}" ${P[p.k] === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`
      : `<input type="number" name="${p.k}" value="${P[p.k]}" min="${p.min}" max="${p.max}" step="${p.step || 1}">`;
    return `<label class="row"><span>${p.label}${p.help ? `<small>${p.help}</small>` : ''}</span>${input}</label>`;
  }).join('');
}

let paramTimer;
function onParamChange() {
  const f = $('#paramsForm');
  const P = { ...S.params };
  PARAM_SPEC.filter(p => p.k).forEach(p => {
    const el = f.elements[p.k];
    if (p.type === 'number') {
      let v = parseFloat(el.value);
      if (!ok(v)) v = p.def;
      P[p.k] = Math.max(p.min, Math.min(p.max, v));
    } else P[p.k] = el.value;
  });
  if (P.smaF >= P.smaS) P.smaF = Math.max(5, Math.floor(P.smaS / 4));
  if (P.rsiOS >= P.rsiOB) P.rsiOS = Math.min(P.rsiOS, P.rsiOB - 10);
  S.params = P;
  store.set('params', P);
  clearTimeout(paramTimer);
  paramTimer = setTimeout(async () => {
    await reanalyzeAll();
    if (!$('#detail').hidden && curDetail) {
      const key = curDetail.tab + ':' + curDetail.sym;
      const a = S.an[key];
      if (a && !a.err) { curDetail = a; renderDetail(findRow(key), a); }
    }
  }, 500);
}

/* ============================================================
   Navegación y eventos
   ============================================================ */
async function setTab(tab) {
  S.tab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const strat = tab === 'estrategia', cart = tab === 'cartera', seg = tab === 'seguir';
  $('#viewStrategy').hidden = !strat;
  $('#viewCartera').hidden = !cart;
  $('#viewSeguir').hidden = !seg;
  $('#viewTable').hidden = strat || cart || seg;
  if (cart) return renderCartera();
  if (seg) return renderSeguir();
  if (strat) return;
  $('#lblLider').style.display = tab === 'acciones' ? '' : 'none';
  $('#lblTir').style.display = tab === 'bonos' || tab === 'ons' ? '' : 'none';
  try {
    if (tab === 'favoritos') {
      const tabs = [...new Set([...S.fav].map(k => k.split(':')[0]))];
      setStatus('Cargando cotizaciones…');
      await Promise.all(tabs.map(t => loadLive(t)));
    } else if (!S.live[tab]) {
      setStatus('Cargando cotizaciones…');
      renderTable();
      await loadLive(tab);
    }
    setStatus('');
  } catch (e) {
    setStatus('Error al cargar cotizaciones: ' + e.message);
  }
  renderTable();
  autoAnalyze(tab);
  if (typeof afterTab === 'function') afterTab(tab);
}

function closeDrawers() {
  $('#detail').hidden = true; $('#params').hidden = true; $('#backdrop').hidden = true; curDetail = null;
}

function toggleFav(key) {
  S.fav.has(key) ? S.fav.delete(key) : S.fav.add(key);
  store.set('fav', [...S.fav]);
  document.querySelectorAll(`[data-fav="${CSS.escape(key)}"]`).forEach(el => el.classList.toggle('on', S.fav.has(key)));
  if (S.tab === 'favoritos') renderTable();
}

function bind() {
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
  ['#q', '#sigFilter', '#fVol', '#fVar', '#fLider', '#fTir'].forEach(s => $(s).addEventListener('input', renderTable));
  $('#tbl thead').addEventListener('click', e => {
    const th = e.target.closest('th'); if (!th) return;
    const k = th.dataset.k;
    S.sort = { k, dir: S.sort.k === k ? -S.sort.dir : (k === 'sym' ? 1 : -1) };
    renderTable();
  });
  $('#tbl tbody').addEventListener('click', e => {
    const star = e.target.closest('[data-fav]');
    if (star) { toggleFav(star.dataset.fav); return; }
    const tr = e.target.closest('tr[data-key]');
    if (tr) openDetail(tr.dataset.key);
  });
  $('#detail').addEventListener('click', e => {
    const star = e.target.closest('[data-fav]');
    if (star) return toggleFav(star.dataset.fav);
    const r = e.target.closest('[data-range]');
    if (r) { chartRange = r.dataset.range; e.currentTarget.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('on', b === r)); drawChart(); }
    if (e.target.closest('[data-log]')) { chartLog = !chartLog; e.target.classList.toggle('on', chartLog); drawChart(); }
  });
  $('#detail').addEventListener('mousemove', e => {
    if (e.target.id !== 'chart') return;
    const rect = e.target.getBoundingClientRect();
    drawChart(e.clientX - rect.left);
  });
  $('#detail').addEventListener('mouseleave', () => drawChart());
  document.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) closeDrawers(); });
  $('#backdrop').addEventListener('click', closeDrawers);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawers(); });
  window.addEventListener('resize', () => drawChart());

  $('#btnParams').addEventListener('click', () => { renderParams(); $('#params').hidden = false; $('#backdrop').hidden = false; });
  $('#paramsForm').addEventListener('change', onParamChange);
  $('#btnReset').addEventListener('click', () => { S.params = { ...DEFAULTS }; renderParams(); onParamChange(); });

  $('#btnRefresh').addEventListener('click', () => refreshAll());
}

// Vuelve a traer cotizaciones y recalcula lo analizado (usa el histórico en memoria)
let refreshing = false;
async function refreshAll() {
  if (SNAP || refreshing) return;
  refreshing = true;
  try { await doRefresh(); } finally { refreshing = false; }
}
async function doRefresh() {
  setStatus('Actualizando…');
  const tabs = Object.keys(S.live);
  try { await Promise.all([loadFX(), ...tabs.map(t => loadLive(t, true))]); } catch (e) { setStatus('Error: ' + e.message); return; }
  await reanalyzeAll();
  setStatus('Actualizado ' + new Date().toLocaleTimeString('es-AR'));
  renderTable();
  if (typeof afterRefresh === 'function') afterRefresh();
}

// Arranca cuando están cargados todos los scripts (app.js, cartera.js, extras.js)
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
async function init() {
  bind();
  if (SNAP) {
    $('#btnRefresh').hidden = true;
    const t = new Date(SNAP.time);
    const b = document.createElement('div');
    b.className = 'snapbar';
    b.innerHTML = `Foto del mercado del <b>${t.toLocaleDateString('es-AR')}</b> a las ${t.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}: los precios no se actualizan. Incluye los instrumentos más operados de cada panel.
      <a href="https://sebastiandelgrosso-blip.github.io/panel-inversiones-ar/" target="_blank" rel="noopener" style="color:var(--accent)">Abrir la versión en vivo →</a>`;
    document.querySelector('.tabs').after(b);
  }
  loadFX();
  loadLive('bonos').catch(() => { }); // para el MEP implícito
  // Flujos de fondos de ONs y soberanos nuevos (archivo local generado por actualizar-flujos.js)
  fetchJSON(SNAP ? 'flujos.json' : 'flujos.json?v=' + Date.now(), 15000)
    .then(f => { S.flujos = f; renderTable(); })
    .catch(() => { });
  fetchJSON(API.cer, 20000)
    .then(j => {
      const det = (j.results && j.results[0] && j.results[0].detalle) || [];
      S.cer = det.map(x => ({ d: x.fecha.slice(0, 10), v: x.valor })).sort((a, b) => a.d < b.d ? -1 : 1);
      renderFX();
      renderTable();
    })
    .catch(() => { });
  await setTab('acciones'); // analiza sola toda la pestaña (ver autoAnalyze)
  if (typeof afterInit === 'function') afterInit();
}
