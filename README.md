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

## App de iPhone (Capacitor + AltStore)

iOS no deja que un atajo abra una web agregada a inicio (abre Safari, que guarda los datos aparte). Por eso la
misma web se empaqueta como app de iPhone con Capacitor: el atajo la abre con `appfinanzas://rapido?monto=…&desc=…`.

**Compilación:** en cada push a `main`, GitHub Actions ([.github/workflows/ios.yml](.github/workflows/ios.yml)) la
compila en una Mac y publica `AppFinanzas.ipa` en
[Releases → App de iPhone](https://github.com/bottcherr/AppFinanzasPersonales/releases/tag/ios).

**Instalar AltStore (una sola vez, en la PC con Windows):**
1. Instalar **iTunes** e **iCloud** desde la web de Apple (no desde la Microsoft Store).
2. Bajar **AltServer para Windows** de https://altstore.io, instalarlo y abrirlo (queda un ícono al lado del reloj).
3. Conectar el iPhone por cable y tocar **Confiar**. En iTunes, activar **Sincronizar con este iPhone por Wi-Fi**.
4. Ícono de AltServer → **Install AltStore** → elegir el iPhone → tu Apple ID.
5. En el iPhone: Ajustes → General → **VPN y gestión de dispositivos** → confiar en tu Apple ID.
   Y Ajustes → Privacidad y seguridad → **Modo desarrollador** → activar (se reinicia).

**Instalar la app:** en el iPhone, abrir la página de Releases en Safari → bajar `AppFinanzas.ipa` →
Compartir → **AltStore**. (O en AltStore → My Apps → **+** → elegir el archivo.)

**Cada 7 días** hay que renovarla: AltStore lo hace solo si la PC con AltServer está prendida y en el mismo Wi-Fi.
Si no, abrir AltStore → **Refresh All**. Si se vence, la app no abre hasta renovarla, pero los datos no se pierden.

**Atajo:** igual que antes, pero el Texto empieza con `appfinanzas://rapido?monto=` (Ajustes → Configurar
"Gasto rápido" adentro de la app).

**Compilar a mano:** `npm install` y `npm run sync` copian la web a `www/` y actualizan `ios/`. Para compilar hace
falta una Mac (o el workflow de GitHub).
