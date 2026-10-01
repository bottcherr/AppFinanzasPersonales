# AppFinanzas

App de gastos personales (PWA) para anotar lo que gastás en segundos desde el iPhone y ver en qué se te va la plata. Funciona sin internet y guarda todo en el celular.

Spec original: [SPECAppFinanzas.md](SPECAppFinanzas.md).

## Probar en la compu

```bash
python tools/serve.py
```

Abrí http://localhost:5174 y poné el navegador en tamaño celular (F12 → ícono de celular).

## Qué tiene

- **Inicio**: cuánto gastaste en el mes y los últimos gastos. Arriba aparecen avisos solo cuando hay algo para hacer (fijos para confirmar, límite pasado, gastos sin categoría, backup).
- **Anotar** (botón + Anotar): todo en una pantalla. Monto, tocás la categoría y Guardar. La descripción es opcional y, si la escribís, elige la categoría sola.
- **Historial**: lista del mes con buscador y filtro por categoría. Tocar un gasto lo edita o lo borra.
- **Análisis**: total del mes, gráfico de en qué se fue la plata (por categoría, con comparación con el mes anterior), proyección de fin de mes y límites por categoría.
- **Ajustes**: **Gastos por mes** (barras de los últimos 12 meses, promedio mensual y comparación con el mes anterior; tocar un mes abre su Análisis), gastos fijos (cuando vencen aparecen en Inicio como **Para confirmar**), carga en lote (un gasto por línea: `Almuerzo 50.000`, `12/09 Farmacia 12.300`) y backup (exportar/importar `.json`).

## Publicar

Se publica sola en GitHub Pages desde la rama `main`: https://bottcherr.github.io/AppFinanzasPersonales/
En el iPhone: abrir esa URL en Safari → Compartir → **Agregar a inicio**.

Cada vez que cambia un archivo, subir la versión de `CACHE` en `sw.js`.
