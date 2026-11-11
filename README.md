# Mi Cancionero Offline

PWA personal para músicos. Guarda letras y acordes en el dispositivo, organiza repertorios y ofrece autoscroll según la duración de cada canción.

## Funciones de la primera versión

- Biblioteca local basada en IndexedDB.
- Letras con o sin acordes, conservando espacios y saltos de línea.
- Repertorios y subcarpetas mediante rutas como `Grupo / Bodas`.
- Búsqueda dentro de títulos, artistas, letras y acordes.
- Búsqueda web opcional cuando hay conexión.
- Modo de interpretación con autoscroll, cuenta regresiva y velocidad ajustable.
- Favoritas, importación y exportación de respaldos JSON.
- Interfaz y datos disponibles sin conexión mediante un service worker.

## Probar localmente

Los service workers necesitan HTTP o HTTPS; no abras `index.html` directamente como archivo. Puedes servir la carpeta con cualquier servidor estático.

```powershell
python -m http.server 4173
```

Después abre `http://localhost:4173`.

## Publicar en GitHub Pages

En el repositorio, abre **Settings → Pages**, selecciona **Deploy from a branch**, elige la rama principal y la carpeta `/ (root)`.

La aplicación usa rutas relativas, por lo que funciona tanto en `usuario.github.io` como en `usuario.github.io/nombre-del-repositorio/`.

> Las canciones no se publican en GitHub. Se almacenan en IndexedDB dentro de cada dispositivo. Usa **Exportar respaldo** periódicamente para evitar pérdida de datos.
