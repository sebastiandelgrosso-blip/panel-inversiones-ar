// Fuentes de noticias y lectura de RSS. Lo usan tanto actualizar-noticias.js (Node, en GitHub)
// como la página (navegador), para que los titulares se detecten y etiqueten igual en los dos lados.
(function (root) {
  // cors: true = el sitio permite leer el RSS directo desde el navegador
  const FEEDS = [
    { src: 'Ámbito', region: 'AR', url: 'https://www.ambito.com/rss/pages/finanzas.xml' },
    { src: 'Ámbito', region: 'AR', url: 'https://www.ambito.com/rss/pages/economia.xml' },
    { src: 'iProfesional', region: 'AR', url: 'https://www.iprofesional.com/rss/finanzas' },
    { src: 'Infobae', region: 'AR', url: 'https://www.infobae.com/arc/outboundfeeds/rss/category/economia/' },
    { src: 'La Nación', region: 'AR', url: 'https://www.lanacion.com.ar/arc/outboundfeeds/rss/category/economia/' },
    { src: 'CNBC', region: 'US', cors: true, url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
    { src: 'CNBC', region: 'US', cors: true, url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
    { src: 'MarketWatch', region: 'US', cors: true, url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
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
  const escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const TAG_RX = Object.entries(TAGS).map(([t, ws]) => [t, new RegExp(`(^|[^\\wÁÉÍÓÚáéíóúñ])(${ws.map(escRx).join('|')})(?![\\wÁÉÍÓÚáéíóúñ])`, /^[A-Z]{2,5}$/.test(ws[0]) ? '' : 'i')]);

  const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).trim();
  const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };
  const clave = t => t.toLowerCase().replace(/\W+/g, '').slice(0, 80);

  // Titulares de un RSS: solo título, fuente, fecha y link (la nota se lee en el sitio original)
  function parse(xml, f, limite) {
    const out = [];
    for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
      const t = tag(m[0], 'title'), link = tag(m[0], 'link') || tag(m[0], 'guid');
      const fecha = new Date(tag(m[0], 'pubDate') || tag(m[0], 'dc:date'));
      if (!t || !/^https?:/.test(link) || isNaN(fecha) || fecha < limite) continue;
      const desc = tag(m[0], 'description').slice(0, 300); // solo para detectar tickers, no se guarda
      // Empresas: solo si aparecen en el título (en la bajada suelen ser menciones de paso)
      out.push({ t, link, src: f.src, region: f.region, fecha: fecha.toISOString(), tags: etiquetas(t, desc) });
    }
    return out;
  }
  const etiquetas = (t, desc) => TAG_RX.filter(([tk, rx]) => rx.test(t) || (tk === 'BONOS' && rx.test(desc))).map(([tk]) => tk);

  // Lo mismo, a partir de la respuesta de rss2json.com (fechas en UTC; el link original viene en "guid")
  function deJSON(j, f, limite) {
    const out = [];
    for (const i of (j && j.items) || []) {
      const t = decode(String(i.title || ''));
      const link = /^https?:/.test(i.guid || '') && !/rss2json.com/.test(i.guid) ? i.guid : i.link;
      const fecha = new Date(String(i.pubDate || '').replace(' ', 'T') + 'Z');
      if (!t || !/^https?:/.test(link || '') || isNaN(fecha) || fecha < limite) continue;
      out.push({ t, link, src: f.src, region: f.region, fecha: fecha.toISOString(), tags: etiquetas(t, decode(String(i.description || '')).slice(0, 300)) });
    }
    return out;
  }

  // Une listas sin repetir títulos, de la más nueva a la más vieja
  function unir(listas) {
    const seen = new Set(), items = [];
    for (const x of listas.flat()) {
      const k = clave(x.t);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(x);
    }
    items.sort((a, b) => b.fecha.localeCompare(a.fecha));
    return items.slice(0, MAX);
  }

  const api = { FEEDS, HORAS, MAX, parse, deJSON, unir };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NEWS = api;
})(typeof window !== 'undefined' ? window : globalThis);
