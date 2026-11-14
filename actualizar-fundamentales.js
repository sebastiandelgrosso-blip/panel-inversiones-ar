// Descarga los balances anuales de las empresas de EE.UU. que tienen CEDEAR y calcula,
// para cada año, el puntaje F de Piotroski, ganancia por acción, ROE, deuda y crecimiento.
// Fuente: SEC EDGAR, API "frames" (un archivo por dato contable y año, con todas las empresas).
// Uso: node actualizar-fundamentales.js   (SEC_USER_AGENT = "nombre mail" para identificarse ante la SEC)
const fs = require('fs');

const UA = { 'User-Agent': process.env.SEC_USER_AGENT || 'PanelAR personal-research-tool', 'Accept-Encoding': 'gzip, deflate' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ANIOS = [];
for (let y = new Date().getFullYear() - 9; y <= new Date().getFullYear() - 1; y++) ANIOS.push(y);

// Cada dato con sus nombres alternativos (se usa el primero que la empresa reporte)
const DUR = { // datos del ejercicio (flujos)
  ni: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  rev: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'],
  gp: ['GrossProfit'],
  cfo: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  sh: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic'],
};
const INST = { // datos de balance (a fin de año)
  assets: ['Assets'],
  ca: ['AssetsCurrent'],
  cl: ['LiabilitiesCurrent'],
  ltd: ['LongTermDebtNoncurrent', 'LongTermDebt'],
  eq: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
};

async function get(url, intentos = 4) {
  for (let i = 0; i < intentos; i++) {
    await sleep(130); // la SEC pide no más de 10 pedidos por segundo
    const r = await fetch(url, { headers: UA });
    if (r.status === 404) return null; // ese dato no existe para ese año
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) { await sleep(5000 * (i + 1)); continue; }
    throw new Error(`${r.status} ${url}`);
  }
  throw new Error('Sin respuesta: ' + url);
}

(async () => {
  // 1) CEDEARs que cotizan hoy (sin las especies D y C)
  const ced = await (await fetch('https://data912.com/live/arg_cedears')).json();
  const syms = new Set(ced.map(r => r.symbol));
  const base = [...syms].filter(s => !(/[DC]$/.test(s) && syms.has(s.slice(0, -1))));

  // 2) Ticker -> CIK (número de empresa en la SEC)
  const tk = await get('https://www.sec.gov/files/company_tickers.json');
  const norm = t => t.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const cikDe = new Map();
  for (const x of Object.values(tk)) if (!cikDe.has(norm(x.ticker))) cikDe.set(norm(x.ticker), { cik: x.cik_str, nombre: x.title });
  const emp = new Map(); // cik -> { syms, nombre, anios: { y: {...} } }
  for (const s of base) {
    const m = cikDe.get(norm(s));
    if (!m) continue;
    if (!emp.has(m.cik)) emp.set(m.cik, { syms: [], nombre: m.nombre, anios: {} });
    emp.get(m.cik).syms.push(s);
  }
  console.log(`${base.length} CEDEARs, ${emp.size} con empresa en la SEC`);

  // 3) Datos contables, año por año
  const bajar = async (campo, nombres, unidad, periodo) => {
    for (const y of ANIOS) {
      const faltan = new Set([...emp.keys()].filter(c => emp.get(c).anios[y]?.[campo] == null));
      for (const n of nombres) {
        if (!faltan.size) break;
        const j = await get(`https://data.sec.gov/api/xbrl/frames/us-gaap/${n}/${unidad}/CY${y}${periodo}.json`);
        if (!j) continue;
        for (const d of j.data) {
          if (!faltan.has(d.cik)) continue;
          const a = emp.get(d.cik).anios[y] ||= {};
          a[campo] = d.val;
          if (campo === 'ni') a.end = d.end;
          faltan.delete(d.cik);
        }
      }
    }
    process.stdout.write(campo + ' ');
  };
  for (const [k, n] of Object.entries(DUR)) await bajar(k, n, k === 'sh' ? 'shares' : 'USD', '');
  for (const [k, n] of Object.entries(INST)) await bajar(k, n, 'USD', 'Q4I');
  console.log();

  // 4) Indicadores y puntaje F de Piotroski (9 pruebas; se cuentan solo las que se pueden calcular)
  const div = (a, b) => (a != null && b ? a / b : null);
  const out = { fuente: 'SEC EDGAR (balances anuales, API frames)', descargado: new Date().toISOString().slice(0, 10), empresas: {} };
  for (const [cik, e] of emp) {
    const lista = [];
    for (const y of ANIOS) {
      const a = e.anios[y], p = e.anios[y - 1];
      if (!a || a.ni == null || !a.end || !a.sh) continue;
      let f = 0, n = 0;
      const prueba = cond => { if (cond == null) return; n++; if (cond) f++; };
      const roa = div(a.ni, a.assets), roaP = p && div(p.ni, p.assets);
      prueba(roa != null ? roa > 0 : null);
      prueba(a.cfo != null ? a.cfo > 0 : null);
      prueba(roa != null && roaP != null ? roa > roaP : null);
      prueba(a.cfo != null ? a.cfo > a.ni : null);
      if (p) {
        const lev = div(a.ltd ?? 0, a.assets), levP = div(p.ltd ?? 0, p.assets);
        prueba(lev != null && levP != null && (a.ltd != null || p.ltd != null) ? lev <= levP : null);
        const cr = div(a.ca, a.cl), crP = div(p.ca, p.cl);
        prueba(cr != null && crP != null ? cr > crP : null);
        prueba(p.sh ? a.sh <= p.sh * 1.01 : null);
        const gm = div(a.gp, a.rev), gmP = div(p.gp, p.rev);
        prueba(gm != null && gmP != null ? gm > gmP : null);
        const at = div(a.rev, a.assets), atP = div(p.rev, p.assets);
        prueba(at != null && atP != null ? at > atP : null);
      }
      // Fecha en que el balance ya era público: fin de ejercicio + 90 días (plazo legal del 10-K)
      const disp = new Date(Date.parse(a.end) + 90 * 864e5).toISOString().slice(0, 10);
      const r4 = v => v == null ? null : Math.round(v * 1e4) / 1e4;
      lista.push({
        y, end: a.end, disp, f, n,
        eps: r4(a.ni / a.sh), ni: a.ni, rev: a.rev ?? null,
        roe: a.eq > 0 ? r4(a.ni / a.eq) : null,
        de: a.eq > 0 && a.ltd != null ? r4(a.ltd / a.eq) : null,
        crec: p && p.ni > 0 ? r4(a.ni / p.ni - 1) : null,
        mb: r4(div(a.gp, a.rev)),
      });
    }
    if (!lista.length) continue;
    for (const s of e.syms) out.empresas[s] = { nombre: e.nombre, cik, anios: lista };
  }
  const n = Object.keys(out.empresas).length;
  if (n < 50) { console.error(`Solo ${n} empresas: no se sobrescribe fundamentales.json`); process.exit(1); }
  fs.writeFileSync('fundamentales.json', JSON.stringify(out));
  console.log(`fundamentales.json: ${n} CEDEARs con balances`);
})().catch(e => { console.error(e); process.exit(1); });
