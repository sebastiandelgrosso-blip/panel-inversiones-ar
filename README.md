# Panel de Inversiones AR

Panel para seguir acciones argentinas, CEDEARs, bonos, letras y ONs que se operan en BYMA con cualquier broker local.

- **Señales** con la estrategia TMR (Tendencia + Momentum + Retroceso) y recomendación por instrumento.
- **Backtest** por activo y general.
- **TIR, duration y paridad** de soberanos, BOPREAL, LECAP/BONCAP, bonos CER y ONs, con **curva de rendimientos**.
- **Mi cartera**: resultado en pesos y en dólares, señal y qué hacer con cada posición.
- **Seguir carteras** públicas (13F de la SEC) y copiarlas con CEDEARs.
- **Alertas** de cambio de señal y stop, y **noticias** de Argentina y EE.UU.

Herramienta educativa. No es asesoramiento financiero.

## Usarlo en tu computadora

Necesita [Node.js](https://nodejs.org). Doble clic en `iniciar-panel.bat` (Windows) o:

```bash
node server.js
```

y abrir http://localhost:8000

## Datos

| Qué | De dónde | Cómo se actualiza |
|---|---|---|
| Cotizaciones e históricos BYMA y EE.UU. | data912.com | En vivo, desde el navegador |
| Dólar oficial, MEP, CCL, blue | dolarapi.com, argentinadatos.com | En vivo |
| Índice CER | API del BCRA | En vivo |
| Flujos de ONs, LECAP y CER | rendimientos-ar (GitHub), argentinadatos | `actualizar-flujos.js`, todos los días |
| Carteras públicas | SEC EDGAR (13F) + OpenFIGI | `actualizar-carteras.js`, los lunes |
| Noticias (solo titulares y link) | RSS de Ámbito, Infobae, La Nación, iProfesional, CNBC, MarketWatch | `actualizar-noticias.js`, cada 30 min |

Los scripts los corre solo GitHub Actions (`.github/workflows/actualizar-datos.yml`) y el sitio se publica con GitHub Pages.

`build-snapshot.js` genera `panel-compartible.html`: una versión de un solo archivo con una foto de los datos del día (para compartir donde no se pueden pedir datos en vivo).
