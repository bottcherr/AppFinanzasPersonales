# App de finanzas personales – Especificación

## Qué es

Una app de finanzas personales para uso propio, hecha con el mismo enfoque que la app de gimnasio: una PWA que se usa desde el iPhone, sin internet, con los datos guardados en el dispositivo. Sirve para anotar cada gasto o ingreso en segundos y para ver, sin planillas, si te estás pasando del presupuesto.

Igual que en AppGYM: se construye primero un MVP que ya sirva de verdad y después se suman funciones de a una.

## Principios

- **Registrar rápido:** un gasto se anota en pocos toques y, si se puede, sin abrir la app completa (atajo del Centro de Control).
- **Pensada para el celular:** una mano, poca atención, justo después de pagar.
- **Offline desde el día uno:** todo se guarda en el dispositivo.
- **Automatizar lo repetitivo:** la categoría se detecta sola y los gastos fijos no se cargan a mano cada mes.
- **Linda y entretenida, pero sin recargar:** interfaz moderna y animaciones sutiles al guardar. Sin puntos, niveles ni desafíos.

## Tipo de app y stack

Igual que AppGYM (ver `SPECAppGYM.md` y `CLAUDE.md`):

- PWA: HTML + CSS + JavaScript puro con módulos ES. Sin frameworks, sin build, sin dependencias.
- Datos en `localStorage` (clave `appfinanzas.v1`), por dispositivo. No hay servidor.
- Service worker con red primero y caché de respaldo para offline.
- Router por hash (`#/`, `#/rapido`, `#/lote`, `#/fijos`, `#/presupuestos`, etc.).
- Publicada en GitHub Pages e instalada en el iPhone con "Agregar a inicio".

Limitación conocida: una PWA no puede agregarse directo al Centro de Control. Eso se resuelve con la app Atajos de iOS (ver la sección siguiente).

---

## Registro rápido (atajo del Centro de Control)

Es la función que distingue a esta app, y también la que más riesgo técnico tiene. Por eso se prueba **antes** de construir el resto.

### Plan A: el atajo abre la app en la pantalla de registro rápido

1. En Atajos se crea un atajo "Anotar gasto" con la acción **Abrir URL** apuntando a `https://<usuario>.github.io/<repo>/#/rapido`.
2. En iOS 18 o superior: Centro de Control → editar → agregar control → Atajos → elegir ese atajo. (Alternativas: botón de acción o "tocar atrás", si el iPhone las tiene.)
3. La pantalla `#/rapido` es mínima: monto grande con teclado numérico, botón gasto/ingreso, descripción opcional, categoría sugerida y **Guardar**.
4. Al guardar, muestra una confirmación breve y queda lista para volver a lo que se estaba haciendo. Si el gasto hace que una categoría pase el 80 % o el 100 % de su presupuesto, lo avisa ahí mismo.

Nota: en iOS puede hacer falta un toque en el campo de monto para que aparezca el teclado.

### Riesgo: Prueba 0 (antes de construir nada)

En el iPhone, abrir una URL desde Atajos normalmente abre **Safari**, no la app instalada, y Safari y la app instalada guardan sus datos por separado. Si pasa eso, un gasto anotado por el atajo no aparecería en la app instalada.

Prueba con una página mínima publicada en GitHub Pages:

- [ ] Instalar la página con "Agregar a inicio".
- [ ] Crear el atajo con Abrir URL y ponerlo en el Centro de Control.
- [ ] Ver si el atajo abre la app instalada o Safari.
- [ ] Guardar un dato desde ahí y comprobar si aparece en la app instalada.

Si la app instalada se abre y comparte datos: se sigue con el Plan A. Si no: Plan B.

### Plan B: el atajo anota en un archivo y la app lo importa

Esto cumple todavía mejor la idea original de no abrir la app:

1. El atajo usa **Pedir entrada** (monto, tipo, descripción) y agrega una línea a un archivo de texto en Archivos (por ejemplo `movimientos.txt`), con fecha y hora.
2. En la app, un botón **Importar pendientes** lee ese archivo con el mismo lector del registro en lote, muestra una vista previa editable y confirma.
3. La app recuerda hasta qué fecha y hora importó, para no duplicar movimientos al volver a importar.

Costo: hay un paso de importar de vez en cuando (por ejemplo, al abrir la app).

### Plan C (último recurso)

Usar la app siempre desde una pestaña de Safari, sin instalarla. Comparte datos con el atajo, pero iOS puede borrar los datos de sitios que no se visitan por un tiempo. Solo sería aceptable con backup muy frecuente.

---

## MVP (primera versión)

### 1. Pantalla de inicio

- Resumen del mes: gastado, ingresado y balance.
- Barras de progreso de las categorías con presupuesto, las más avanzadas primero.
- Aviso "Para confirmar (N)" cuando hay gastos fijos vencidos.
- Botón grande **+ Anotar**.
- Últimos movimientos.

### 2. Anotar un movimiento

- Monto, tipo (gasto por defecto, o ingreso), descripción opcional y fecha (hoy por defecto, editable).
- La categoría se sugiere sola como un chip; se cambia con un toque.
- Etiquetas opcionales, de texto libre y varias por movimiento.
- Al guardar: animación breve y, si corresponde, aviso de presupuesto ("Comida: 85 % del límite").

### 3. Carga en lote

- Se pega texto con **un movimiento por línea**. Formato de cada línea: `descripción monto`. Con `+` delante del monto es un ingreso; sin signo es un gasto. Una fecha al principio (`12/03`) es opcional.
- La app corre las reglas sobre cada línea y muestra una vista previa editable con la categoría sugerida. Las líneas sin clasificar se marcan.
- Al confirmar se cargan todos juntos.

### 4. Categorías y etiquetas

- Categorías iniciales de gasto: Comida, Supermercado, Transporte, Suscripciones, Servicios, Arriendo, Salud, Ocio, Otros. De ingreso: Sueldo, Otros ingresos.
- Se pueden crear, renombrar, cambiar de color y borrar. Al borrar una categoría, sus movimientos pasan a "Sin clasificar".
- Pantalla **Sin clasificar** para revisar rápido lo que las reglas no pudieron resolver.

### 5. Motor de categorización (reglas locales)

Sin IA y sin azar, como el generador de rutinas de AppGYM:

1. Se normaliza la descripción (minúsculas, sin tildes).
2. **Reglas aprendidas:** si corregís la categoría de un movimiento, la app guarda "descripción → categoría" y la usa la próxima vez. Tienen prioridad.
3. **Reglas base:** palabras clave por categoría en `data.js` (por ejemplo "netflix" y "spotify" → Suscripciones; "super" → Supermercado).
4. Si nada coincide → **Sin clasificar**.

### 6. Movimientos fijos (scheduler)

- Se configura: nombre, tipo, monto, categoría, periodicidad (semanal, mensual o anual) y día. El monto puede ser fijo o "varía" (se pide al confirmar, útil para luz o agua).
- **Con confirmación:** los fijos nunca se registran solos. Al abrir la app se revisan los vencidos y se arma la bandeja **Para confirmar**, donde se puede confirmar, editar el monto, saltar o posponer.
- Si pasaron varios días sin abrir la app, aparecen todos los ciclos atrasados, cada uno con su fecha original.
- Pantalla **Fijos** para ver, pausar, editar o borrar cada uno, con una vista del próximo mes.

Limitación: una PWA sin servidor no puede mandar una notificación en la fecha exacta, así que en el MVP el aviso es la bandeja al abrir la app (con el número en inicio). Las notificaciones reales quedan en "Para después".

### 7. Presupuestos e insights

- Límite mensual opcional por categoría.
- Barra de progreso por categoría: color normal hasta 80 %, ámbar entre 80 % y 100 %, rojo por encima.
- Resumen del mes, ranking de categorías por gasto y comparación con el mes anterior.
- **Proyección de fin de mes:** gasto acumulado ÷ días transcurridos × días del mes, comparada con el límite.
- Alertas: al guardar un movimiento y como banner en inicio cuando una categoría se pasó.

### 8. Historial

- Lista de movimientos por mes, con filtro por categoría o etiqueta.
- Editar y borrar movimientos (usar `ask()`, nunca `window.confirm()`).

### 9. Datos y backup

Todo en `localStorage`, clave `appfinanzas.v1`. Resumen del modelo:

- Movimiento: `{ id, type: 'gasto'|'ingreso', amount, date, desc, categoryId, tags: [], source: 'app'|'rapido'|'lote'|'fijo', recurringId? }`
- Categoría: `{ id, name, color, type }`
- Regla: `{ id, pattern, categoryId, source: 'base'|'aprendida' }`
- Fijo: `{ id, name, type, amount, variable, categoryId, every, day, nextDate, active }`
- Pendiente: `{ id, recurringId, dueDate, amount }`
- Presupuesto: `{ categoryId, limit }`
- Ajustes: moneda, último backup, último importe de pendientes.

Los montos se guardan como números enteros. Todo texto del usuario pasa por `esc()` antes de ir al HTML.

Como no hay backup automático: **exportar e importar backup** (archivo `.json`) entra en el MVP, con recordatorio cada 14 días como en AppGYM.

---

## Diseño

- Moderna y prolija. Se parte del estilo de AppGYM (fondo oscuro, título con Ranade) y el color se suma solo donde informa: categorías y barras de presupuesto.
- Microinteracciones al guardar y al completar una barra.
- Las capturas del flujo van en la misma carpeta que este spec, y el spec se revisa contra ellas.

---

## Para después (no entra en el MVP)

1. **Avisos de fijos en la fecha:** con una automatización personal de Atajos que recuerde, o con notificaciones push (requiere un servidor).
2. Reglas por rango de monto.
3. Gráficos y tendencias más detalladas.
4. Versión Android, con su atajo equivalente.
5. Backup y sincronización automáticos.
6. Metas de ahorro y presupuestos por semana.
7. Varias monedas.

## Criterio para sumar funciones

Antes de agregar algo, preguntarse: *"¿puedo anotar un gasto y saber si me estoy pasando sin esto?"*. Si la respuesta es sí, va a la lista de "para después".

---

## Preguntas abiertas

- Nombre del repo y URL de GitHub Pages, para armar el atajo.
- Moneda y si se necesitan decimales (si sí, los montos se guardan en centavos).
- ¿Las categorías iniciales están bien, o querés otras?
- ¿Solo gastos e ingresos, o también transferencias y ahorro?
- Formato final del registro en lote, una vez que veas la vista previa.
- Resultado de la Prueba 0 (decide Plan A o Plan B).
- Capturas del flujo: revisarlas y ajustar pantallas.
