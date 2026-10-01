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
- `css/styles.css` — todo el estilo, tokens en `:root` (oscuro fijo, acento verde `--accent`, títulos y monto grande con Outfit, guardada en `fonts/`).
- `js/app.js` — pantallas y router por hash: `#/` (inicio), `#/nuevo` y `#/mov/:id` (anotar/editar en **una sola
  pantalla**: monto, fecha, grilla de categorías, descripción opcional que elige la categoría sola, "Se repite"),
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
  larga) y `parseLine()/parseBatch()` para la carga en lote.
- `js/data.js` — categorías iniciales (solo de gasto), colores, íconos elegibles, palabras clave (`BASE_KEYWORDS`).
- `js/util.js` — fechas (`'YYYY-MM-DD'` local), montos (`parseAmount`, `fmtNumber` es-AR), `esc()`, `occurrenceOnOrAfter()`.
- `js/icons.js` — íconos SVG de línea.
- `sw.js` — red primero y caché de respaldo. `tools/serve.py` (puerto 5174), `tools/make-icons.mjs`.

## Reglas (importante)

- **No usar `window.confirm()`**: usar `ask()` de app.js.
- **Subir `CACHE` en `sw.js` en cada cambio** (`appfinanzas-vN`) y sumar a `FILES` cualquier archivo nuevo.
- Todo texto del usuario pasa por `esc()` antes de ir al HTML.
- Una regla se aprende solo cuando el usuario cambia la categoría a mano (o la corrige al editar).
- El gráfico de Análisis no depende solo del color (los colores de categoría Comida/Súper se parecen): barra con
  separación entre tramos + lista con nombre, monto y % como leyenda; tocar un tramo lo resalta.
- Probar en el panel del navegador en tamaño celular (375×812). Si el usuario tiene su propio servidor en 5174, el
  panel no lo ve: levantar uno aparte en otro puerto solo para probar.
- Hacer commit y push solo cuando el usuario lo pida.

## Probar y publicar

- Local: `python tools/serve.py` → http://localhost:5174
- Repo: https://github.com/bottcherr/AppFinanzasPersonales (rama `main`). La carpeta `Idea Flujo App/` no se sube (.gitignore).
- App publicada (GitHub Pages): https://bottcherr.github.io/AppFinanzasPersonales/
