// Descarga los flujos de fondos de ONs y soberanos nuevos desde el proyecto rendimientos-ar
// y los guarda en flujos.json (montos por cada 100 de valor nominal original).
// Uso: node actualizar-flujos.js
const fs = require('fs');
const path = require('path');

const URL = 'https://raw.githubusercontent.com/arisbdar/rendimientos-ar/main/public/config.json';
// Estos los calcula el panel con sus propios términos del canje 2020
const PROPIOS = new Set(['AL29', 'GD29', 'AL30', 'GD30', 'AL35', 'GD35', 'AE38', 'GD38', 'AL41', 'GD41', 'GD46']);

(async () => {
  const cfg = await (await fetch(URL)).json();
  const out = { fuente: 'github.com/arisbdar/rendimientos-ar', descargado: new Date().toISOString().slice(0, 10), ons: {}, soberanos: {} };

  for (const [k, o] of Object.entries(cfg.ons || {})) {
    if (!o.ticker_d912 || !Array.isArray(o.flujos)) continue;
    out.ons[o.ticker_d912] = {
      nombre: o.nombre || k, venc: o.vencimiento,
      flujos: o.flujos.map(f => [f.fecha, +(f.monto * 100).toFixed(6)]),
    };
  }
  for (const [k, s] of Object.entries(cfg.soberanos || {})) {
    if (PROPIOS.has(k) || !Array.isArray(s.flujos)) continue;
    out.soberanos[k] = { ley: s.ley, venc: s.vencimiento, flujos: s.flujos.map(f => [f.fecha, f.monto]) };
  }

  // LECAP / BONCAP: un solo pago final (capital + intereses capitalizados) por cada 100 VN
  out.lecaps = {};
  for (const l of (cfg.lecaps && cfg.lecaps.letras) || []) {
    if (l.activo === false || !l.pago_final) continue;
    out.lecaps[l.ticker] = { nombre: l.nombre, venc: l.fecha_vencimiento, pago: l.pago_final, fuente: 'rendimientos-ar' };
  }
  // Letras que falten: el pago final se estima con la TEA y el precio que publica argentinadatos
  try {
    const ad = await (await fetch('https://api.argentinadatos.com/v1/finanzas/letras')).json();
    for (const l of ad.letras || []) {
      if (out.lecaps[l.ticker] || !/^[ST]\d\d[A-Z]\d$/.test(l.ticker) || !(l.precioArs > 0) || !(l.diasAlVencimiento > 0)) continue;
      out.lecaps[l.ticker] = {
        nombre: 'LECAP/BONCAP', venc: l.fechaVencimiento, fuente: 'argentinadatos (estimado)',
        pago: +(l.precioArs * Math.pow(1 + l.teaPorcentaje / 100, l.diasAlVencimiento / 365)).toFixed(3),
      };
    }
  } catch (e) { console.warn('argentinadatos no respondió:', e.message); }

  // Bonos CER: amortización y tasa real sobre el capital ajustado por CER
  out.cer = {};
  for (const [k, b] of Object.entries(cfg.bonos_cer || {})) {
    if (!Array.isArray(b.flujos) || !b.cer_emision) continue;
    out.cer[k] = { venc: b.vencimiento, cerEmision: b.cer_emision, flujos: b.flujos.map(f => [f.fecha, f.amortizacion, f.tasa_interes, f.base]) };
  }

  fs.writeFileSync(path.join(__dirname, 'flujos.json'), JSON.stringify(out, null, 1));
  console.log(`flujos.json: ${Object.keys(out.ons).length} ONs, ${Object.keys(out.soberanos).length} soberanos (${Object.keys(out.soberanos).join(', ')}), ` +
    `${Object.keys(out.lecaps).length} LECAP/BONCAP, ${Object.keys(out.cer).length} CER`);
})();
