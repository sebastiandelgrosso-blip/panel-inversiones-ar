// Descarga titulares de RSS públicos (Argentina y EE.UU.) y los guarda en noticias.json.
// Solo se guarda título, fuente, fecha y link: la nota se lee en el sitio original.
// Las fuentes y la lectura del RSS están en noticias-comun.js (la página usa el mismo código).
// Uso: node actualizar-noticias.js
const fs = require('fs');
const path = require('path');
const { FEEDS, HORAS, parse, unir } = require('./noticias-comun.js');

(async () => {
  const listas = [], limite = Date.now() - HORAS * 3600e3;
  for (const f of FEEDS) {
    try {
      const r = await fetch(f.url, { headers: { 'User-Agent': 'Mozilla/5.0 (PanelAR lector RSS)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const items = parse(await r.text(), f, limite);
      listas.push(items);
      console.log(`${f.src}: ${items.length}`);
    } catch (e) { console.log(`${f.src}: error ${e.message}`); }
  }
  const out = { actualizado: new Date().toISOString(), items: unir(listas) };
  if (!out.items.length) { console.error('Sin titulares: no se sobrescribe noticias.json'); process.exit(1); }
  fs.writeFileSync(path.join(__dirname, 'noticias.json'), JSON.stringify(out, null, 1));
  console.log(`noticias.json: ${out.items.length} titulares (${out.items.filter(i => i.tags.length).length} con activos detectados)`);
})();
