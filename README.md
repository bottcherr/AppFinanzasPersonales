# AppFinanzas

App de finanzas personales (PWA) para anotar gastos e ingresos en segundos desde el iPhone y ver si te estás pasando del presupuesto. Funciona sin internet y guarda todo en el celular.

Spec: [SPECAppFinanzas.md](SPECAppFinanzas.md). Capturas del flujo: `Idea Flujo App/`.

## Probar en la compu

```bash
python tools/serve.py
```

Abrí http://localhost:5174 y poné el navegador en tamaño celular (F12 → ícono de celular).

## Qué tiene

- **Inicio**: balance del mes, ingresos y gastos, "seguro para gastar" por día, barras de presupuesto, avisos (fijos para confirmar, categorías pasadas, sin clasificar, backup) y últimos movimientos.
- **Anotar** (botón + Anotar): monto → descripción → categoría (sugerida sola) → formulario con fecha, etiquetas, "hacer recurrente" y "guardar y agregar otro".
- **Gasto rápido** (atajo del Centro de Control): `#/rapido?monto=4500&desc=Parqueadero` abre la tarjeta lista para guardar. Sin parámetros abre los pasos. Instrucciones dentro de la app: Ajustes → Configurar "Gasto rápido".
- **Carga en lote**: un movimiento por línea (`Almuerzo 50.000`, `Sueldo +1.500.000`, `12/09 Farmacia 12.300`), vista previa editable.
- **Movimientos fijos** con bandeja **Para confirmar** (nunca se anotan solos).
- **Análisis**: presupuestos por categoría, proyección de fin de mes, ranking y comparación con el mes anterior.
- **Categorías**, **Sin clasificar**, **Reglas aprendidas**, backup (exportar/importar `.json`) e importación del archivo del atajo (Plan B).

## Publicar en GitHub Pages

1. Crear un repo nuevo en GitHub y subir esta carpeta.
2. Settings → Pages → Deploy from a branch → `main` / `(root)`.
3. En el iPhone, abrir la URL en Safari → Compartir → **Agregar a inicio**.
4. Hacer la **Prueba 0** del spec con el atajo antes de usarla en serio.

Cada vez que cambia un archivo, subir la versión de `CACHE` en `sw.js`.
