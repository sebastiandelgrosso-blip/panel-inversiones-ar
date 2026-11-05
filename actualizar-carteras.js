// Descarga las carteras públicas (formulario 13F de la SEC) de inversores conocidos,
// las cruza con los CEDEARs que cotizan en BYMA y las guarda en carteras.json.
// Uso: node actualizar-carteras.js
const fs = require('fs');
const path = require('path');

// CIK = identificador de cada fondo en la SEC
const FONDOS = [
  { id: 'berkshire', cik: 1067983, gestor: 'Warren Buffett / Greg Abel', estilo: 'Value, largo plazo' },
  { id: 'pershing', cik: 1336528, gestor: 'Bill Ackman', estilo: 'Concentrada, activista' },
  { id: 'scion', cik: 1649339, gestor: 'Michael Burry', estilo: 'Contrarian' },
  { id: 'himalaya', cik: 1709323, gestor: 'Li Lu', estilo: 'Value, muy concentrada' },
  { id: 'appaloosa', cik: 1656456, gestor: 'David Tepper', estilo: 'Oportunista' },
  { id: 'duquesne', cik: 1536411, gestor: 'Stanley Druckenmiller', estilo: 'Macro / tendencias' },
  { id: 'baupost', cik: 1061768, gestor: 'Seth Klarman', estilo: 'Value, margen de seguridad' },
  { id: 'akre', cik: 1112520, gestor: 'Chuck Akre', estilo: 'Calidad, compounders' },
  { id: 'fundsmith', cik: 1569205, gestor: 'Terry Smith', estilo: 'Calidad, baja rotación' },
  { id: 'greenlight', cik: 1079114, gestor: 'David Einhorn', estilo: 'Value / long-short' },
];

// La SEC pide identificarse con un nombre y un contacto. Se puede configurar con la variable SEC_USER_AGENT
// (en GitHub: Settings > Secrets and variables > Actions > Variables), por ejemplo "PanelAR tu-mail@ejemplo.com".
const UA = { 'User-Agent': process.env.SEC_USER_AGENT || 'PanelAR personal-research-tool', 'Accept-Encoding': 'gzip, deflate' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FIGI_CACHE = path.join(__dirname, '.cache-figi.json');

async function sec(url, as = 'json') {
  await sleep(150); // la SEC pide no más de 10 pedidos por segundo
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return as === 'json' ? r.json() : r.text();
}

// Las dos últimas presentaciones 13F-HR (la actual y la anterior, para ver cambios)
async function ultimos13F(cik) {
  const s = await sec(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`);
  const f = s.filings.recent, out = [];
  for (let i = 0; i < f.form.length && out.length < 2; i++) {
    if (f.form[i] === '13F-HR' || f.form[i] === '13F-HR/A') {
      if (f.form[i] === '13F-HR/A' && out.some(o => o.periodo === f.reportDate[i])) continue;
      out.push({ acc: f.accessionNumber[i], presentado: f.filingDate[i], periodo: f.reportDate[i] });
    }
  }
  return { nombre: s.name, filings: out };
}

const tag = (xml, t) => { const m = xml.match(new RegExp(`<(?:\\w+:)?${t}>([^<]*)</(?:\\w+:)?${t}>`)); return m ? m[1].trim() : ''; };

async function posiciones(cik, acc) {
  const dir = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, '')}`;
  const idx = await sec(`${dir}/index.json`);
  const files = idx.directory.item.map(x => x.name).filter(n => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
  if (!files.length) throw new Error('sin infotable');
  const xml = await sec(`${dir}/${files[0]}`, 'text');
  const byCusip = {};
  for (const m of xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/g)) {
    const e = m[1];
    if (tag(e, 'putCall')) continue; // se ignoran opciones
    const cusip = tag(e, 'cusip').toUpperCase(), value = +tag(e, 'value') || 0;
    if (!cusip || !value) continue;
    byCusip[cusip] = byCusip[cusip] || { cusip, nombre: tag(e, 'nameOfIssuer'), valor: 0, acciones: 0 };
    byCusip[cusip].valor += value;
    byCusip[cusip].acciones += +tag(e, 'sshPrnamt') || 0;
  }
  return Object.values(byCusip);
}

// CUSIP -> ticker con OpenFIGI (gratis, sin clave: lotes chicos y pausas)
async function mapearTickers(cusips) {
  const cache = fs.existsSync(FIGI_CACHE) ? JSON.parse(fs.readFileSync(FIGI_CACHE, 'utf8')) : {};
  const faltan = cusips.filter(c => !(c in cache));
  for (let i = 0; i < faltan.length; i += 10) {
    const lote = faltan.slice(i, i + 10);
    for (let intento = 0; intento < 5; intento++) {
      const r = await fetch('https://api.openfigi.com/v3/mapping', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lote.map(c => ({ idType: 'ID_CUSIP', idValue: c, exchCode: 'US' }))),
      });
      if (r.status === 429) { await sleep(15000); continue; }
      const j = await r.json();
      lote.forEach((c, k) => {
        const d = (j[k] && j[k].data) || [];
        const eq = d.find(x => x.marketSector === 'Equity') || d[0];
        cache[c] = eq ? eq.ticker : null;
      });
      break;
    }
    await sleep(2600); // ~25 pedidos por minuto sin clave
    process.stdout.write('.');
  }
  fs.writeFileSync(FIGI_CACHE, JSON.stringify(cache));
  return cache;
}

// Ticker de EE.UU. -> símbolo del CEDEAR en BYMA (BRK/B -> BRKB)
const aCedear = t => t ? t.replace(/[\/.\-\s]/g, '').toUpperCase() : null;
const ALIAS = { GOOG: 'GOOGL' };
// ADRs de empresas argentinas: se compran como acción local en BYMA
const ADR_AR = { YPF: 'YPFD', GGAL: 'GGAL', BMA: 'BMA', PAM: 'PAMP', TGS: 'TGSU2', CEPU: 'CEPU', SUPV: 'SUPV', LOMA: 'LOMA',
  TEO: 'TECO2', EDN: 'EDN', CRESY: 'CRES', IRS: 'IRSA', BBAR: 'BBAR', BIOX: 'BIOX' };
const MAX_ANTIGUEDAD_DIAS = 365;

(async () => {
  const ced = await (await fetch('https://data912.com/live/arg_cedears')).json();
  const acc = await (await fetch('https://data912.com/live/arg_stocks')).json();
  const cedears = new Set(ced.map(r => r.symbol)), acciones = new Set(acc.map(r => r.symbol));
  // Dónde se compra cada ticker de EE.UU. en Argentina
  const local = t => {
    const c = aCedear(t);
    if (!c) return null;
    if (ADR_AR[c] && acciones.has(ADR_AR[c])) return { sym: ADR_AR[c], tab: 'acciones' };
    let k = ALIAS[c] || c;
    // Si el ticker coincide con una especie en dólares de otro CEDEAR (BAC = Boeing cable),
    // BYMA lo lista con punto: Bank of America = BA.C
    const base = k.slice(0, -1), dotted = base + '.' + k.slice(-1);
    if (/[DC]$/.test(k) && cedears.has(base) && cedears.has(dotted)) k = dotted;
    return cedears.has(k) ? { sym: k, tab: 'cedears', usa: c } : null;
  };
  const out = { fuente: 'SEC EDGAR (formulario 13F)', descargado: new Date().toISOString().slice(0, 10), carteras: [] };

  for (const f of FONDOS) {
    try {
      const { nombre, filings } = await ultimos13F(f.cik);
      if (!filings.length) { console.log(`\n${f.id}: sin 13F`); continue; }
      const dias = (Date.now() - Date.parse(filings[0].periodo)) / 864e5;
      if (dias > MAX_ANTIGUEDAD_DIAS) { console.log(`\n${f.id}: último 13F de ${filings[0].periodo}, demasiado viejo; se omite`); continue; }
      const act = await posiciones(f.cik, filings[0].acc);
      const ant = filings[1] ? await posiciones(f.cik, filings[1].acc).catch(() => []) : [];
      const map = await mapearTickers([...new Set([...act, ...ant].map(p => p.cusip))]);
      const total = act.reduce((s, p) => s + p.valor, 0);
      const antBy = Object.fromEntries(ant.map(p => [p.cusip, p]));
      const pos = act.sort((a, b) => b.valor - a.valor).map(p => {
        const t = map[p.cusip], a = antBy[p.cusip];
        const cambio = !a ? 'nueva' : a.acciones ? +(p.acciones / a.acciones - 1).toFixed(4) : 0;
        return { ticker: t || p.nombre, nombre: p.nombre, peso: +(p.valor / total).toFixed(5), ar: local(t), cambio };
      });
      const actCus = new Set(act.map(p => p.cusip));
      const vendidas = ant.filter(p => !actCus.has(p.cusip)).map(p => map[p.cusip] || p.nombre);
      const enCedear = pos.filter(p => p.ar).reduce((s, p) => s + p.peso, 0);
      out.carteras.push({
        id: f.id, nombre, gestor: f.gestor, estilo: f.estilo, cik: f.cik,
        periodo: filings[0].periodo, presentado: filings[0].presentado, periodoAnterior: filings[1]?.periodo || null,
        totalUSD: total, posiciones: pos, vendidas, pesoEnCedear: +enCedear.toFixed(4),
      });
      console.log(`\n${f.id} (${nombre}): ${pos.length} posiciones, período ${filings[0].periodo}, ${(enCedear * 100).toFixed(0)}% en CEDEARs`);
    } catch (e) { console.log(`\n${f.id}: error ${e.message}`); }
  }
  // Si un fondo falló (por ejemplo, la SEC bloqueó el pedido), se conserva su versión anterior
  const file = path.join(__dirname, 'carteras.json');
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { carteras: [] };
  const okIds = new Set(out.carteras.map(c => c.id));
  const kept = prev.carteras.filter(c => !okIds.has(c.id) && FONDOS.some(f => f.id === c.id)
    && (Date.now() - Date.parse(c.periodo)) / 864e5 <= MAX_ANTIGUEDAD_DIAS);
  out.carteras = FONDOS.map(f => out.carteras.find(c => c.id === f.id) || kept.find(c => c.id === f.id)).filter(Boolean);
  if (!okIds.size) { console.log(`\nNo se pudo actualizar ninguna cartera; se deja carteras.json como estaba (${prev.carteras.length}).`); return; }
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`\ncarteras.json listo (${okIds.size} actualizadas, ${kept.length} sin cambios)`);
})();
