# Servidor local para probar la app en la compu.
# Igual que "python -m http.server", pero le dice al navegador que no guarde los archivos,
# así cada recarga muestra siempre la última versión del código.
#
# Uso (desde la carpeta de la app):  python tools/serve.py
import http.server
import os

PORT = 5174


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
print(f"App en http://localhost:{PORT}  (Ctrl+C para cortar)")
http.server.ThreadingHTTPServer(("", PORT), NoCacheHandler).serve_forever()
