# AppFinanzas — guía del proyecto

App de finanzas personales (PWA) para anotar gastos/ingresos rápido desde el iPhone, sin internet.
Spec: [SPECAppFinanzas.md](SPECAppFinanzas.md). Capturas del flujo deseado: `Idea Flujo App/`. Cómo probar: [README.md](README.md).
Hermana de AppGYM (`../AppGYM`): mismo stack y mismas reglas.

## Sobre el usuario

- Está aprendiendo a crear apps: explicar pasos de terminal/git/GitHub en castellano rioplatense, simple y paso a paso.
- Criterio para sumar funciones: *"¿puedo anotar un gasto y saber si me estoy pasando sin esto?"*.

## Stack

HTML + CSS + JavaScript puro con módulos ES. Sin frameworks, sin build, sin dependencias en la web
(`package.json` es solo para Capacitor, ver más abajo).
Datos en `localStorage` (clave `appfinanzas.v1`). Montos como enteros. No hay servidor.

## Archivos

- `index.html` — punto de entrada; `<dialog id="sheet">` para hojas, confirmaciones y la tarjeta de gasto rápido.
- `css/styles.css` — todo el estilo, tokens en `:root` (oscuro fijo, acento verde `--accent`, títulos con Ranade).
- `js/app.js` — pantallas y router por hash: `#/`, `#/nuevo`, `#/rapido` (con `?monto=&desc=&tipo=` muestra la
  tarjeta; sin parámetros, los pasos), `#/mov/:id`, `#/movimientos`, `#/analisis`, `#/ajustes`, `#/lote`, `#/fijos`,
  `#/fijo/:id|nuevo`, `#/pendientes`, `#/categorias`, `#/sin-clasificar`, `#/reglas`, `#/atajo`.
  Cada `render*()` llama a `mount(html, actions, handlers)` (delegación con `data-action`).
  El movimiento en curso vive en `draft` (`step` 1-3 = pasos, 4 = formulario).
- `js/store.js` — única capa que toca `localStorage`. `normalize()` limpia datos viejos/importados.
  Fijos: `processRecurring()` arma los pendientes vencidos (uno por ciclo, con su fecha) cada vez que se navega.
- `js/rules.js` — `suggestCategory()` (reglas aprendidas primero, después palabras clave de `data.js`; gana la más
  larga) y `parseLine()/parseBatch()` para la carga en lote y el archivo del atajo (Plan B).
- `js/data.js` — categorías iniciales, colores, íconos elegibles, palabras clave (`BASE_KEYWORDS`).
- `js/util.js` — fechas (`'YYYY-MM-DD'` local), montos (`parseAmount`, `fmtNumber` es-AR), `esc()`, `occurrenceOnOrAfter()`.
- `js/icons.js` — íconos SVG de línea.
- `sw.js` — red primero y caché de respaldo. `tools/serve.py` (puerto 5174), `tools/make-icons.mjs`.

## Reglas (importante)

- **No usar `window.confirm()`**: usar `ask()` de app.js.
- **Subir `CACHE` en `sw.js` en cada cambio** (`appfinanzas-vN`) y sumar a `FILES` cualquier archivo nuevo.
- Todo texto del usuario pasa por `esc()` antes de ir al HTML.
- Una regla se aprende solo cuando el usuario cambia la categoría a mano (o la corrige al editar).
- Probar en el panel del navegador en tamaño celular (375×812).
- Hacer commit y push solo cuando el usuario lo pida.

## Probar y publicar

- Local: `python tools/serve.py` → http://localhost:5174
- Repo: https://github.com/bottcherr/AppFinanzasPersonales (rama `main`). La carpeta `Idea Flujo App/` no se sube (.gitignore).
- App publicada (GitHub Pages): https://bottcherr.github.io/AppFinanzasPersonales/ — URL del atajo:
  `https://bottcherr.github.io/AppFinanzasPersonales/#/rapido?monto=[Cantidad]&desc=[Texto codificado]`

## App de iPhone (Capacitor + AltStore)

- **Prueba 0 (30/09/2026): el atajo con "Abrir URLs" abre Safari, no la web agregada a inicio.** Por eso la web se
  empaqueta con Capacitor 8 (`ios/`, Swift Package Manager, sin CocoaPods) y se instala con AltStore (gratis,
  renovar cada 7 días). El usuario no tiene Mac: compila GitHub Actions (`.github/workflows/ios.yml`) y publica
  `AppFinanzas.ipa` sin firmar en el release `ios`.
- El atajo abre `appfinanzas://rapido?monto=…&desc=…` (`CFBundleURLTypes` en `ios/App/App/Info.plist`).
  En app.js, `openDeepLink()` lo convierte en `#/rapido?…` (plugin `@capacitor/app`, vía `Capacitor.registerPlugin`,
  sin bundler). `isNative` desactiva el service worker adentro de la app.
- `npm run sync` = `tools/build-www.mjs` (copia la web a `www/`) + `cap sync ios`. `www/` y `node_modules/` no se suben.
- `tools/make-icons.mjs` también genera el ícono de 1024 y la pantalla de carga de iOS.
- La web sola (GitHub Pages) sigue funcionando; sus datos no se comparten con la app (pasar con backup .json).

## Pendiente

- Primera instalación con AltStore y prueba del atajo con `appfinanzas://`.
- Preguntas abiertas del spec: moneda y decimales, categorías iniciales, transferencias/ahorro.
