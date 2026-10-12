# Instagram Review Lite

Herramienta para revisar a quién sigues en Instagram y decidir, cuenta por cuenta, si **Mantener**, **Eliminar** o dejarlo para **Después**. No automatiza unfollows: solo organiza tu revisión.

Hay dos versiones:

| Versión | Carpeta | Dónde funciona |
|---|---|---|
| **App Android** ⭐ | `android/` (+ `docs/`) | Android. Instagram real dentro de la tarjeta: todas las publicaciones y el botón real “Dejar de seguir” |
| **Web / móvil (PWA)** | `docs/` | Cualquier navegador, GitHub Pages, instalable en el móvil (vista previa de 6 publicaciones) |
| Escritorio (Electron) | raíz (`main.js`…) | Windows/macOS/Linux, 3 perfiles en paralelo |

---

## App Android (`android/`)

Es la misma interfaz que la versión web, pero la tarjeta muestra **la página real de Instagram** como un navegador: inicias sesión una vez dentro de la app, ves todas las publicaciones, puedes entrar en posts, y **dejas de seguir con el botón de Instagram** (Siguiendo → Dejar de seguir) sin salir de la app.

- Al pulsar **Eliminar**, la app mira el botón del perfil: si ya pone “Seguir”, lo marca automáticamente como *dejado de seguir*.
- ← vuelve atrás dentro de Instagram; ↻ recarga. El botón atrás de Android cierra menús y sale del modo.
- Exportar guarda los archivos en **Descargas**.

### Conseguir el APK (sin instalar nada en el ordenador)
1. Sube el proyecto a GitHub (ver *Publicar en GitHub Pages* más abajo).
2. GitHub lo compila solo (pestaña **Actions** → *App Android*, tarda ~3–5 min).
3. En el móvil abre `https://github.com/TU-USUARIO/NOMBRE-REPO/releases` → **App Android (última versión)** → descarga **IGReviewLite.apk** y ábrelo.
4. Android pedirá permitir *instalar apps de origen desconocido* para tu navegador: acéptalo solo para esto.

Cada vez que subas cambios a `docs/` o `android/` se genera un APK nuevo que se instala encima del anterior (conserva tus datos).

> La clave de firma (`android/app/igreview.keystore`) está en el repo para que las actualizaciones se instalen encima. Es solo para uso personal; no la uses para publicar en Google Play.

También puedes compilarlo tú con Android Studio: *Open* → carpeta `android/` → *Run*.

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
