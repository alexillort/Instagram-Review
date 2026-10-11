# Instagram Review Lite

Herramienta para revisar a quién sigues en Instagram y decidir, cuenta por cuenta, si **Mantener**, **Eliminar** o dejarlo para **Después**. No automatiza unfollows: solo organiza tu revisión.

Hay dos versiones:

| Versión | Carpeta | Dónde funciona |
|---|---|---|
| **Web / móvil (PWA)** | `docs/` | Cualquier navegador, GitHub Pages, instalable en el móvil |
| Escritorio (Electron) | raíz (`main.js`…) | Windows/macOS/Linux, 3 perfiles en paralelo |

---

## Versión web / móvil (`docs/`)

Muestra **un perfil a la vez** dentro de la tarjeta usando el *embed* oficial de Instagram (foto, seguidores, nº de publicaciones y las 6 últimas publicaciones; Instagram no permite mostrar más en el embed). El siguiente perfil se precarga para que el cambio sea instantáneo. Si quieres ver más (historias, bio completa, todas las publicaciones), toca *Abrir en Instagram*.

- **Modo “Dejar de seguir”** (opcional): te lleva por las cuentas marcadas *Eliminar* una a una. Tocas *Abrir en Instagram*, pulsas **Siguiendo → Dejar de seguir** tú mismo, vuelves y marcas **Hecho**. También puedes *Saltar* o pasarla a *Mantener*. Propone una pausa de 10 min cada 20 cuentas para evitar bloqueos temporales de Instagram (se puede saltar). Ajustable en `UNFOLLOW_BATCH` / `UNFOLLOW_PAUSE_MIN` de `docs/app.js`.
- Desliza la tarjeta: **→ mantener**, **← eliminar**, **↑ después**. También hay botones y **Deshacer**.
- Importa `.csv`, `.txt`, `.json` o `.html`, o pega usuarios/URLs a mano.
  - Acepta directamente `following.json` / `following.html` de la *descarga de tus datos* de Instagram.
  - Si el CSV trae columna `decision` (como el que exporta esta app o la de escritorio), se conservan las decisiones.
- El progreso se guarda en el navegador (localStorage) automáticamente.
- Exporta: CSV, compartir CSV (móvil), copiar la lista “Eliminar” y copia de seguridad JSON para continuar en otro dispositivo.
- Funciona sin conexión e instalable como app (en GitHub Pages).
- En ordenador: atajos `←` `→` `↑`, `Z` deshacer, `Enter` abrir perfil.

### Publicar en GitHub Pages
1. Crea un repositorio en GitHub y sube **todo el contenido de esta carpeta** (incluida `docs/`).
2. En el repositorio: **Settings → Pages → Build and deployment**.
3. *Source*: **Deploy from a branch** · *Branch*: `main` · carpeta **`/docs`** → **Save**.
4. En 1–2 minutos estará en `https://TU-USUARIO.github.io/NOMBRE-REPO/`.

> Cuando cambies archivos, sube el número de `CACHE` en `docs/sw.js` (`ig-review-v2`, …) para que los móviles reciban la nueva versión.

### Instalar en el móvil
- **Android (Chrome):** abre la URL → menú ⋮ → *Instalar aplicación* / *Añadir a pantalla de inicio*.
- **iPhone (Safari):** abre la URL → botón Compartir → *Añadir a pantalla de inicio*.

### Usarla sin subirla a internet
Copia la carpeta `docs/` al móvil y abre `index.html` con el navegador. Funciona igual, salvo el modo sin conexión/instalable, que requiere https (GitHub Pages). Ten en cuenta que algunos navegadores móviles no abren bien archivos locales; GitHub Pages es la opción más fiable.

> Los datos se guardan **en cada navegador**. Para pasar el progreso del ordenador al móvil (o al revés), usa *Exportar → Copia de seguridad* e impórtala en el otro dispositivo.

---

## Versión escritorio (Electron)

Abre 3 perfiles en paralelo con una sesión de Instagram compartida.

```bash
npm install
npm start
```

Formato simple de CSV:

```csv
username
instagram
natgeo
openai
```

## Importante
La app NO pulsa “Dejar de seguir” ni intenta evadir límites de Instagram. Solo organiza la revisión y tus decisiones.
