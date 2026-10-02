# AppFinanzas — guía del proyecto

App de gastos personales (PWA) para anotar lo que gastás rápido desde el iPhone, sin internet.
Spec original: [SPECAppFinanzas.md](SPECAppFinanzas.md) (la app se simplificó después, ver abajo). Capturas del flujo
de referencia: `Idea Flujo App/`. Cómo probar: [README.md](README.md).
Hermana de AppGYM (`../AppGYM`): mismo stack y mismas reglas.

## Sobre el usuario

- Está aprendiendo a crear apps: explicar pasos de terminal/git/GitHub en castellano rioplatense, simple y paso a paso.
- La quiere **simple, para uso casual y rápido, sin tanto dato** (decidido el 01/10/2026):
  - **Solo gastos**: no hay ingresos (los datos viejos con `type: 'ingreso'` se siguen mostrando, pero no se crean).
  - **Sin etiquetas.**
  - **Sin atajo del Centro de Control**: iOS abre Safari (no la app de inicio) desde "Abrir URLs"; se probó
    Capacitor + AltStore y le resultó muy difícil, se descartó. No volver a proponerlo salvo que lo pida.
  - Inicio: solo cuánto gastó en el mes y los últimos gastos.
- Criterio para sumar funciones: *"¿puedo anotar un gasto y saber si me estoy pasando sin esto?"*.

## Stack

HTML + CSS + JavaScript puro con módulos ES. Sin frameworks, sin build, sin dependencias.
Datos en `localStorage` (clave `appfinanzas.v1`). Montos como enteros. No hay servidor.

## Archivos

- `index.html` — punto de entrada; `<dialog id="sheet">` para hojas y confirmaciones.
- `css/styles.css` — todo el estilo, tokens en `:root` (oscuro fijo, acento verde `--accent`, títulos y monto grande con Outfit, guardada en `fonts/`). Barra de abajo, pastilla del mes y botón Anotar con estilo "Liquid Glass" (tokens `--glass-*`).
- `js/app.js` — pantallas y router por hash: `#/` (inicio), `#/nuevo` y `#/mov/:id` (anotar/editar en **una sola
  pantalla**: monto, fecha, grilla de categorías, descripción opcional que elige la categoría sola, "Se repite"; al anotar, arriba del monto están "Escanear ticket"
  (QR, ver `qr.js`) y "Varios en lote" (lleva a `#/lote`)),
  `#/movimientos` (pestaña "Historial": gastos del mes con buscador y filtro por categoría; el inicio se titula "Gastos" y el mes se elige en una pastilla a la derecha del título), `#/analisis` (total, gráfico de barra 100 %
  por categoría con leyenda, proyección y límites), `#/ajustes` (Gastos por mes, Gastos fijos, Carga en lote y Backup), `#/meses` (barras de los últimos 12 meses desde el primero con gastos; el mes en curso dice "En curso" en vez de comparar),
  `#/lote`, `#/fijos`, `#/fijo/:id|nuevo`, `#/pendientes` y `#/sin-clasificar` (a estas dos se llega por los avisos
  de Inicio). `#/rapido?monto=&desc=` muestra una tarjeta para confirmar un gasto (queda de antes, no se usa desde
  ningún atajo). Se sacaron las pantallas de Categorías (editar/borrar), Reglas aprendidas y Moneda: las
  categorías nuevas se crean con "Nueva" en la grilla de anotar, y las reglas se siguen aprendiendo solas.
  Cada `render*()` llama a `mount(html, actions, handlers)` (delegación con `data-action`).
  El gasto en curso vive en `draft`.
- `js/store.js` — única capa que toca `localStorage`. `normalize()` limpia datos viejos/importados.
  Fijos: `processRecurring()` arma los pendientes vencidos (uno por ciclo, con su fecha) cada vez que se navega.
- `js/rules.js` — `suggestCategory()` (reglas aprendidas primero, después palabras clave de `data.js`; gana la más
  larga) y `parseLine()/parseBatch()` para la carga en lote. Si el texto parece un ticket (`looksLikeTicket`: dice
  CUIT o TOTAL; texto pegado con "Escanear texto" del iPhone) saltea totales, IVA, pagos y descuentos, limpia
  códigos y "2 x 1.250", usa la fecha impresa y devuelve el `total` (lo usa "Juntar en un solo gasto" del lote).
  Solo en modo ticket, para que "Pago de luz 5000" en una lista común no se saltee. En modo ticket el precio es el
  último número con centavos ("1000,00") del renglón, se corrigen errores típicos del OCR ("6000) 00"), se saca
  la basura del principio y un nombre sin precio se junta con el precio del renglón de abajo.
- `js/qr.js` — QR fiscal de ARCA (`?p=` base64 JSON: fecha, CUIT, importe, moneda/ctz; **no trae productos**, se
  anota un solo gasto por el total). `scanQR()` en app.js: cámara en vivo que escanea sola (alterna
  el cuadro entero y el centro ampliado 2x/3x), zoom con dos dedos o 1x/2x/3x (zoom real de la cámara si
  `getCapabilities().zoom` existe, si no digital), y "Sacar foto" solo si la cámara no abre.
  Usa `js/vendor/jsQR.js` (jsQR 1.4.0, Apache 2.0, se carga recién al escanear). Cada CUIT recuerda descripción y
  categoría en `state.merchants` (`rememberMerchant()` al guardar).
  **Ojo:** los TIQUE de controlador fiscal (súper) traen otro QR, `http://qr.afip.gob.ar/?qr=XXXX` (`isTiqueQR`),
  que es solo un código de verificación online: no trae monto ni fecha. Al detectarlo, el escáner frena y pide
  "Foto del ticket entero", que va a Carga en lote (`batchFromPhotoFile`): lee los productos con OCR y, si la
  foto trae un QR de factura, usa su total y fecha. La revisión del lote avisa si la suma no coincide con el TOTAL.
- `js/ocr.js` — "Sacar foto de una lista o ticket" en Carga en lote: lee el texto de la foto sin internet con
  Tesseract.js 7 (`js/vendor/ocr/`: lib, worker, core **solo SIMD-LSTM** (iOS 16.4+) y `spa.traineddata.gz`, ~6 MB,
  Apache 2.0). `prepare()` recorta la foto al papel (`paperBox`: el tramo más claro) porque el fondo mete letras
  falsas. Se baja recién al usarlo; el texto va al cuadro y se procesa solo (`batchFromPhoto` en app.js).
  `workerBlobURL: false` (la CSP no permite blob:). En `sw.js` esa carpeta va **primero caché, sin tocar el pedido**
  (con `{cache:'no-cache'}` el importScripts del worker falla) y en una caché aparte (`OCR_CACHE`) que no se borra
  al subir `CACHE`: si se cambian esos archivos, subir `OCR_CACHE`.
- `js/data.js` — categorías iniciales (solo de gasto), colores, íconos elegibles, palabras clave (`BASE_KEYWORDS`).
- `js/util.js` — fechas (`'YYYY-MM-DD'` local), montos (`parseAmount`, `fmtNumber` es-AR), `esc()`, `occurrenceOnOrAfter()`.
- `js/icons.js` — íconos SVG de línea.
- `sw.js` — red primero y caché de respaldo. `tools/serve.py` (puerto 5174), `tools/make-icons.mjs`.
- Detalles de interfaz: la barra de abajo tiene nombre bajo cada ícono; el total grande cuenta hasta el valor nuevo al
  cambiar de mes (`animateTotal`); el botón "Anotar" se achica a "+" al bajar (`syncFab`, escucha el scroll de la
  ventana); las fechas de la lista quedan fijas bajo la barra de título (`--sticky-top`, lo calcula `mount()`).
- "Deshacer": al guardar un gasto (anotar, editar, gasto rápido o lote) aparece 5 s una barra con "Deshacer"
  (`offerUndo(snap, label)`, con `store.snapshot()` tomado antes de cambiar nada; `store.restore()` vuelve todo).
  Si se guarda cualquier otra cosa mientras tanto (`store.setOnSave`), la barra se cierra para no pisar ese cambio.
- Fechas: no se usan `<input type="date">` (el selector nativo no se puede estilizar y en Chrome de escritorio no
  abría). `pickDate(value)` abre un calendario propio en la hoja (Hoy/Ayer, mes con flechas, semana desde el lunes).
- Pantalla de carga del iPhone: `icons/splash/` (una por modelo, las genera `tools/make-icons.mjs` con la lista
  `SPLASH`) y un `<link rel="apple-touch-startup-image">` por cada una en `index.html`. iOS la toma al agregar la app
  a inicio: para ver un cambio hay que borrar la app de inicio y volver a agregarla.
  Después de esa, `#splash` en `index.html` (estilo en el `<style>` del head, solo con `pointer: coarse`) muestra la
  misma moneda en el mismo lugar y tamaño (ícono de 150 pt, igual que en `make-icons.mjs`), y app.js la desvanece a
  los ~2 s de abrir.

## Reglas (importante)

- **No usar `window.confirm()`**: usar `ask()` de app.js.
- **Subir `CACHE` en `sw.js` en cada cambio** (`appfinanzas-vN`) y sumar a `FILES` cualquier archivo nuevo.
- Todo texto del usuario pasa por `esc()` antes de ir al HTML.
- **Seguridad** (revisada el 01/10/2026):
  - `normalize()` en store.js reconstruye TODO lo que entra (lo guardado y los backups) campo por campo: ids solo
    `[A-Za-z0-9_-]`, referencias a categorías/fijos que existan, fechas válidas, enums cerrados. Si se agrega un
    campo nuevo al modelo, validarlo ahí también (los ids van sin `esc()` en atributos `data-id`).
  - `occurrenceOnOrAfter()` tiene límite de vueltas: datos inválidos nunca pueden colgar la app.
  - `index.html` tiene una Content-Security-Policy: solo scripts propios (`script-src 'self'`), sin handlers inline
    ni recursos de otros sitios. No usar `onclick=` en el HTML ni cargar nada de CDNs: si hace falta una fuente o
    librería, guardarla en el repo.
  - Importar backup: máximo 5 MB.
- Fijos: diario (con "Solo de lunes a viernes", campo `workdays`), semanal, mensual y anual. Un diario no junta más
  de 2 semanas de pendientes. En "Para confirmar" hay "Confirmar todos" (los que tienen monto).
- Una regla se aprende solo cuando el usuario cambia la categoría a mano (o la corrige al editar).
- El gráfico de Análisis no depende solo del color (los colores de categoría Comida/Súper se parecen): barra con
  separación entre tramos + lista con nombre, monto y % como leyenda; tocar un tramo lo resalta.
- Probar en el panel del navegador en tamaño celular (375×812). Si el usuario tiene su propio servidor en 5174, el
  panel no lo ve: levantar uno aparte en otro puerto solo para probar.
- Hacer commit y push solo cuando el usuario lo pida.

## Probar y publicar

- Local: `python tools/serve.py` → http://localhost:5174
- Repo: https://github.com/bottcherr/AppFinanzasPersonales (rama `main`). Commits con el email anónimo de GitHub
  (`220268449+bottcherr@users.noreply.github.com`, configurado en `git config --local`), no con el personal. La carpeta `Idea Flujo App/` no se sube (.gitignore).
- App publicada (GitHub Pages): https://bottcherr.github.io/AppFinanzasPersonales/
