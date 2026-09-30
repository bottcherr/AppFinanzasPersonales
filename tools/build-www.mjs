// Copia los archivos de la web a www/, que es la carpeta que Capacitor mete adentro de la app de iPhone.
// Uso: node tools/build-www.mjs  (o npm run sync, que además actualiza el proyecto de iOS)
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const out = new URL('www/', root);
const FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'fonts', 'icons'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of FILES) cpSync(new URL(f, root), new URL(f, out), { recursive: true });
console.log('www/ lista');
