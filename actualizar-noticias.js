// Descarga titulares de RSS públicos (Argentina y EE.UU.) y los guarda en noticias.json.
// Solo se guarda título, fuente, fecha y link: la nota se lee en el sitio original.
// Uso: node actualizar-noticias.js
const fs = require('fs');
const path = require('path');

const FEEDS = [
  { src: 'Ámbito', region: 'AR', url: 'https://www.ambito.com/rss/pages/finanzas.xml' },
  { src: 'Ámbito', region: 'AR', url: 'https://www.ambito.com/rss/pages/economia.xml' },
  { src: 'iProfesional', region: 'AR', url: 'https://www.iprofesional.com/rss/finanzas' },
  { src: 'Infobae', region: 'AR', url: 'https://www.infobae.com/arc/outboundfeeds/rss/category/economia/' },
  { src: 'La Nación', region: 'AR', url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/category/economia/' },
  { src: 'CNBC', region: 'US', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
  { src: 'CNBC', region: 'US', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { src: 'MarketWatch', region: 'US', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
];
const HORAS = 72, MAX = 150;

// Palabras clave -> ticker del panel (para "noticias relacionadas")
const TAGS = {
  'YPFD': ['YPF'], 'GGAL': ['Galicia'], 'BMA': ['Banco Macro'], 'PAMP': ['Pampa Energía', 'Pampa Energia'], 'TGSU2': ['TGS', 'Transportadora de Gas del Sur'],
  'TECO2': ['Telecom'], 'CEPU': ['Central Puerto'], 'SUPV': ['Supervielle'], 'LOMA': ['Loma Negra'], 'ALUA': ['Aluar'], 'TXAR': ['Ternium'],
  'EDN': ['Edenor'], 'CRES': ['Cresud'], 'IRSA': ['IRSA'], 'BYMA': ['BYMA'], 'MIRG': ['Mirgor'], 'TRAN': ['Transener'], 'BBAR': ['BBVA Argentina', 'Francés'],
  'COME': ['Comercial del Plata'], 'VIST': ['Vista Energy', 'Vista Oil'], 'MELI': ['Mercado Libre', 'MercadoLibre'], 'GLOB': ['Globant'],
  'AAPL': ['Apple'], 'MSFT': ['Microsoft'], 'NVDA': ['Nvidia'], 'TSLA': ['Tesla'], 'AMZN': ['Amazon'], 'GOOGL': ['Google', 'Alphabet'],
  'META': ['Meta Platforms', 'Facebook'], 'NFLX': ['Netflix'], 'KO': ['Coca-Cola'], 'JPM': ['JPMorgan'], 'BA.C': ['Bank of America'],
  'BRKB': ['Berkshire', 'Buffett'], 'AMD': ['AMD'], 'INTC': ['Intel'], 'MU': ['Micron'], 'TSM': ['TSMC', 'Taiwan Semiconductor'],
  'UBER': ['Uber'], 'DIS': ['Disney'], 'WMT': ['Walmart'], 'XOM': ['Exxon'], 'CVX': ['Chevron'], 'PFE': ['Pfizer'], 'BABA': ['Alibaba'],
  'SPY': ['S&P 500', 'Wall Street', 'Dow Jones'], 'QQQ': ['Nasdaq'],
  'BONOS': ['bonos', 'riesgo país', 'riesgo pais', 'Globales', 'Bonares', 'LECAP', 'licitación del Tesoro', 'Treasury'],
};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TAG_RX = Object.entries(TAGS).map(([t, ws]) => [t, new RegExp(`(^|[^\\wÁÉÍÓÚáéíóúñ])(${ws.map(esc).join('|')})(?![\\wÁÉÍÓÚáéíóúñ])`, /^[A-Z]{2,5}$/.test(ws[0]) ? '' : 'i')]);

const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };

(async () => {
  const items = [], seen = new Set(), limite = Date.now() - HORAS * 3600e3;
  for (const f of FEEDS) {
    try {
      const r = await fetch(f.url, { headers: { 'User-Agent': 'Mozilla/5.0 (PanelAR lector RSS)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const xml = await r.text();
      let n = 0;
      for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
        const t = tag(m[0], 'title'), link = tag(m[0], 'link') || tag(m[0], 'guid');
        const fecha = new Date(tag(m[0], 'pubDate') || tag(m[0], 'dc:date'));
        if (!t || !/^https?:/.test(link) || isNaN(fecha) || fecha < limite) continue;
        const k = t.toLowerCase().replace(/\W+/g, '').slice(0, 80);
        if (seen.has(k)) continue;
        seen.add(k);
        const desc = tag(m[0], 'description').slice(0, 300); // solo para detectar tickers, no se guarda
        // Empresas: solo si aparecen en el título (en la bajada suelen ser menciones de paso)
        const tags = TAG_RX.filter(([tk, rx]) => rx.test(t) || (tk === 'BONOS' && rx.test(desc))).map(([tk]) => tk);
        items.push({ t, link, src: f.src, region: f.region, fecha: fecha.toISOString(), tags });
        n++;
      }
      console.log(`${f.src}: ${n}`);
    } catch (e) { console.log(`${f.src}: error ${e.message}`); }
  }
  items.sort((a, b) => b.fecha.localeCompare(a.fecha));
  const out = { actualizado: new Date().toISOString(), items: items.slice(0, MAX) };
  fs.writeFileSync(path.join(__dirname, 'noticias.json'), JSON.stringify(out, null, 1));
  console.log(`noticias.json: ${out.items.length} titulares (${out.items.filter(i => i.tags.length).length} con activos detectados)`);
})();
