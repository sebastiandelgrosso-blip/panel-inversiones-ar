// Arma "panel-compartible.html": el panel en una sola página con una foto de los datos del día.
// Uso: node build-snapshot.js
const fs = require('fs');
const path = require('path');

const TOP = { cedears: 100, bonos: 60 };   // acciones: todas las que operaron
const DESDE = '2013-01-01';                // el CCL histórico arranca en 2013
const HL_RUEDAS = 300;                     // máximos/mínimos diarios solo para el ATR reciente

const D912 = 'https://data912.com';
const LIVE = { acciones: 'arg_stocks', cedears: 'arg_cedears', bonos: 'arg_bonds', ons: 'arg_corp' };
const HIST = { acciones: 'stocks', cedears: 'cedears', bonos: 'bonds' };
const CCL = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/contadoconliqui';
const DOLARES = 'https://dolarapi.com/v1/dolares';

const histURL = (tab, s) => `${D912}/historical/${HIST[tab]}/${encodeURIComponent(s)}`;
const usaURL = s => `${D912}/historical/usa_stocks/${encodeURIComponent(s)}`;
const r6 = x => Number(Number(x).toPrecision(6));
const dayNum = d => Date.parse(d + 'T00:00:00Z') / 864e5;

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return j && j.Error ? null : j;
    } catch (e) {
      if (i === 2) { console.warn('  falló', url, e.message); return null; }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

function deltas(dates) {
  return dates.map((d, i) => i ? dayNum(d) - dayNum(dates[i - 1]) : 0);
}
function packHist(rows) {
  rows = rows.filter(r => r.c > 0 && r.date >= DESDE);
  if (!rows.length) return null;
  const dates = rows.map(r => r.date), tail = rows.slice(-HL_RUEDAS);
  return {
    t: 'ohlc', d0: dates[0], dd: deltas(dates), c: rows.map(r => r6(r.c)),
    h: tail.map(r => r6(Math.max(r.h || r.c, r.c))), l: tail.map(r => r6(Math.min(r.l || r.c, r.c))),
  };
}
function packUSA(d) {
  if (!d || !Array.isArray(d.dates)) return null;
  const idx = d.dates.map((x, i) => i).filter(i => d.prices[i] > 0);
  const dates = idx.map(i => d.dates[i]);
  return { t: 'usa', d0: dates[0], dd: deltas(dates), c: idx.map(i => r6(d.prices[i])) };
}

// Misma detección de especies en dólares que usa el panel
function rank(tab, data) {
  const syms = new Set(data.map(r => r.symbol));
  return data.filter(r => {
    const base = r.symbol.length > 2 ? r.symbol.slice(0, -1) : null;
    if (base && /[DC]$/.test(r.symbol) && syms.has(base)) return false;
    if (tab === 'acciones' && /D$/.test(r.symbol) && data.some(o => o.symbol !== r.symbol && o.symbol.startsWith(r.symbol.slice(0, 3)) && o.c > r.c * 200)) return false;
    return r.v > 0 && r.c > 0;
  }).sort((a, b) => b.v * b.c - a.v * a.c);
}

async function pool(items, n, fn) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const it = items[i++]; await fn(it); if (++done % 20 === 0) console.log(`  ${done}/${items.length}`); }
  }));
}

(async () => {
  const urls = {};
  const now = new Date();
  console.log('Cotizaciones…');
  const live = {};
  for (const [tab, ep] of Object.entries(LIVE)) {
    const url = `${D912}/live/${ep}`;
    live[tab] = await get(url);
    urls[url] = { t: 'raw', v: live[tab].map(({ symbol, c, pct_change, px_bid, px_ask, v }) => ({ symbol, c, pct_change, px_bid, px_ask, v })) };
  }
  urls[DOLARES] = { t: 'raw', v: await get(DOLARES) };
  const NOTES = `${D912}/live/arg_notes`;
  const notes = await get(NOTES);
  if (notes) urls[NOTES] = { t: 'raw', v: notes.map(({ symbol, c, pct_change, px_bid, px_ask, v }) => ({ symbol, c, pct_change, px_bid, px_ask, v })) };
  const CER = 'https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/30?limit=60';
  const cer = await get(CER);
  if (cer) urls[CER] = { t: 'raw', v: cer };
  const ccl = (await get(CCL)).filter(x => x.venta > 0 && x.fecha >= DESDE);
  urls[CCL] = { t: 'ccl', d0: ccl[0].fecha, dd: deltas(ccl.map(x => x.fecha)), c: ccl.map(x => r6(x.venta)) };

  const jobs = [];
  rank('acciones', live.acciones).forEach(r => jobs.push(['acciones', r.symbol]));
  const cedJobs = new Set(rank('cedears', live.cedears).slice(0, TOP.cedears).map(r => r.symbol));
  cedJobs.add('SPY'); // referencia para comparar rendimientos
  // Todo lo que tienen las carteras públicas, para poder calcular su rendimiento en la foto
  const accJobs = new Set(rank('acciones', live.acciones).map(r => r.symbol));
  if (fs.existsSync(path.join(__dirname, 'carteras.json'))) {
    for (const c of JSON.parse(fs.readFileSync(path.join(__dirname, 'carteras.json'), 'utf8')).carteras)
      for (const p of c.posiciones) if (p.ar) (p.ar.tab === 'cedears' ? cedJobs : accJobs).add(p.ar.sym);
  }
  jobs.length = 0;
  accJobs.forEach(s => jobs.push(['acciones', s]));
  cedJobs.forEach(s => jobs.push(['cedears', s]));
  const bondSyms = new Set(live.bonos.map(r => r.symbol));
  // Top por volumen + todos los bonos con flujos de fondos (para que tengan TIR en la foto)
  const flujosPath = path.join(__dirname, 'flujos.json');
  const conFlujos = ['AL29', 'GD29', 'AL30', 'GD30', 'AL35', 'GD35', 'AE38', 'GD38', 'AL41', 'GD41', 'GD46',
    ...(fs.existsSync(flujosPath) ? Object.keys(JSON.parse(fs.readFileSync(flujosPath, 'utf8')).soberanos) : [])];
  const bondPick = new Set([...rank('bonos', live.bonos).slice(0, TOP.bonos).map(r => r.symbol), ...conFlujos.filter(s => bondSyms.has(s))]);
  bondPick.forEach(s => {
    jobs.push(['bonos', s]);
    if (bondSyms.has(s + 'D')) jobs.push(['bonos', s + 'D']);
  });

  console.log(`Históricos de ${jobs.length} series…`);
  await pool(jobs, 6, async ([tab, s]) => {
    if (tab === 'cedears') {
      const u = packUSA(await get(usaURL(s)));
      if (u && u.c.length > 300) { urls[usaURL(s)] = u; return; }
      // sin acción subyacente: se usa el histórico del CEDEAR y se marca como incluido
      const h = await get(histURL(tab, s));
      const p = Array.isArray(h) && packHist(h);
      if (p) { urls[histURL(tab, s)] = p; urls[usaURL(s)] = { t: 'usa', d0: p.d0, dd: [0], c: [p.c.at(-1)] }; }
      return;
    }
    const h = await get(histURL(tab, s));
    const p = Array.isArray(h) && packHist(h);
    if (p) urls[histURL(tab, s)] = p;
  });

  const noticiasFile = path.join(__dirname, 'noticias.json');
  if (fs.existsSync(noticiasFile)) urls['noticias.json'] = { t: 'raw', v: JSON.parse(fs.readFileSync(noticiasFile, 'utf8')) };
  const carterasFile = path.join(__dirname, 'carteras.json');
  if (fs.existsSync(carterasFile)) urls['carteras.json'] = { t: 'raw', v: JSON.parse(fs.readFileSync(carterasFile, 'utf8')) };
  const flujosFile = path.join(__dirname, 'flujos.json');
  if (fs.existsSync(flujosFile)) urls['flujos.json'] = { t: 'raw', v: JSON.parse(fs.readFileSync(flujosFile, 'utf8')) };
  else console.warn('Sin flujos.json: corré antes "node actualizar-flujos.js" para tener TIR de ONs');

  const snap = { date: now.toISOString().slice(0, 10), time: now.toISOString(), urls };
  const json = JSON.stringify(snap).replace(/</g, '\\u003c');
  const dir = __dirname;
  let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
  const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  const cartera = fs.readFileSync(path.join(dir, 'cartera.js'), 'utf8');
  html = html
    .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script src="app.js"></script>', () => `<script>window.SNAPSHOT=${json};</script>\n<script>\n${app}\n</script>`)
    .replace('<script src="cartera.js"></script>', () => `<script>\n${cartera}\n</script>`)
    .replace('<script src="extras.js"></script>', () => `<script>\n${fs.readFileSync(path.join(dir, 'extras.js'), 'utf8')}\n</script>`);
  fs.writeFileSync(path.join(dir, 'panel-compartible.html'), html);
  console.log(`Listo: panel-compartible.html (${(html.length / 1024 / 1024).toFixed(2)} MB, ${Object.keys(urls).length} series)`);
})();
