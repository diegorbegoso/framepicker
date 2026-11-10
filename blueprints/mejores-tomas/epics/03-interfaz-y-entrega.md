# Epic 03: Interfaz y entrega

> La persona elige fotos, ve el avance, revisa y corrige las ráfagas en modo claro u oscuro, exporta una copia de las elegidas, y existe un instalador de Windows.

| | |
|---|---|
| **Epic id** | `03-interfaz-y-entrega` |
| **Tasks** | `E3-T1` … `E3-T5` |
| **Depends on** | `01-fundamentos`, `02-motor-de-analisis` |
| **Unlocks** | nothing — final epic |
| **Parallel with** | nothing |

You do not need any other file to complete this epic. Everything below is repeated here on purpose. References to `§N` point at `blueprint.md`, but every fact a task needs is written in the task itself.

---

## Stack

Tauri (Rust shell) · React 19 + TypeScript + Vite · Python 3.12 analysis engine (rawpy, OpenCV, MediaPipe) · SQLite · CSS custom properties for the light/dark themes · no auth, no hosting, no payments.
Package managers: `pnpm` (JS), `uv` (Python), `cargo` (Rust). Runtime pinned in `.nvmrc`, `.python-version` and `rust-toolchain.toml`. Dependency versions are in `pnpm-lock.yaml`, `engine/uv.lock` and `src-tauri/Cargo.lock` — read them, never guess one.

| Task | Command |
|---|---|
| Install | `pnpm install` · `uv sync --directory engine` |
| Typecheck | `pnpm typecheck` · `pnpm typecheck:engine` |
| Lint | `pnpm lint` · `pnpm lint:engine` |
| Test (one file) | `pnpm exec vitest run <path>` · `uv run --directory engine pytest tests/<file> -q` |
| Test (all) | `pnpm test` · `pnpm test:engine` · `pnpm test:rust` |
| Build | `pnpm build:ui` · `cargo build --manifest-path src-tauri/Cargo.toml` |

**Gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm lint:engine && pnpm typecheck:engine && pnpm test:engine && pnpm test:rust` passes before any task here is marked done.

No local service is needed: SQLite is a file and the tests use temporary folders. Shell: Git Bash, from the project root, with `$HOME/.local/bin` on `PATH`.

## Directory subtree

Only the parts this epic touches:

```
src/
  App.tsx App.test.tsx                                 # edit (steps 13, 14)
  lib/theme.ts theme.test.ts engine.ts                 # NEW (steps 13, 14, 16)
  screens/SettingsScreen.tsx HomeScreen.tsx ReviewScreen.tsx
          ExportPanel.tsx screens.test.tsx             # NEW (steps 13, 14, 16)
engine/mejores_engine/export.py app.py                 # NEW / edit (steps 15, 17)
engine/tests/test_export.py test_selftest.py           # NEW (steps 15, 17)
scripts/build_sidecar.py                               # NEW (step 17)
src-tauri/tauri.bundle.conf.json                       # NEW (step 17)
package.json                                           # edit (step 17: two scripts)
```

Everything outside this subtree is out of scope. If a task seems to require editing a file not listed here, stop and report — it means the epic boundary is wrong.

## Data model touched here

| Entity | Fields this epic adds or reads | Notes |
|---|---|---|
| `settings` | `theme, weights, per_burst` | `theme` is 'light' by default; the UI writes it with `settings_set` |
| `selections` | `burst_id, photo_id, source, selected` | `set_pick` writes `source = 'user'`; `export` reads `selected = 1` |

## Contracts

**Consumed** — already exists, do not rebuild:

| From | Interface | Guarantee |
|---|---|---|
| `01-fundamentos` | `engineRequest`, `EngineError` (`src/lib/ipc.ts`), `pick_folder` / `pick_files` Tauri commands, `Roots` | As listed in that epic's Produced table |
| `02-motor-de-analisis` | RPC methods `scan`, `analyze`, `cancel`, `bursts`, `select`, `set_pick`, `preview`; notifications `progress`, `job_done`; `Jobs` | As listed in that epic's Produced table |

**Produced** — later steps depend on exactly these signatures. Changing one breaks them:

| Export | Signature | Used by |
|---|---|---|
| `src/lib/engine.ts` | typed wrappers with zod schemas, `onEngineEvent(cb)`, `pickFolder()`, `pickFiles()`, `exportSelection(sessionId, dest)` | the screens |
| `src/lib/theme.ts` | `applyTheme(theme)`, `loadTheme()`, `saveTheme(theme)` | `App.tsx`, `SettingsScreen.tsx` |
| RPC methods `export`, `selftest` | `export {session_id, dest} → {job_id}`; `selftest {} → six booleans` | the UI and the installer smoke test |

## Conventions that bite in this area

- Every colour comes from `src/styles/tokens.css` through `var(--token)`. `src/lib/theme.test.ts` scans `src/` for hex, `rgb(`, `rgba(` and `hsl(` and fails on any hit.
- Light is the default theme; never follow `prefers-color-scheme`. The theme is a user setting stored in the engine.
- All user-facing text is Spanish and the strings quoted in the acceptance criteria are exact.
- Screens never call `invoke` directly; they use `src/lib/engine.ts`, which validates every reply with zod.
- Query by role and accessible name in tests (`getByRole`), never by CSS class.
- `pnpm build:app` downloads NSIS the first time (Tauri does it) and takes several minutes.

Full project rules: `CLAUDE.md`. Area rules: `.claude/rules/*.md`. Both sit in the project root — the builder copied them there from the bundle's `workspace/` before task one.

---

## Tasks

Listed in the same order as `tasks.json`. That order is the build order — work top to bottom and do not re-rank by priority or by what looks quick.

### `E3-T1` — Tema claro y oscuro, y estructura de la aplicación

**Depends on:** `E1-T5`, `E1-T3` · **Priority:** p0 — metadata for scope cuts, not a running order

La persona elige entre **modo claro (el principal, por defecto)** y **modo oscuro**. El tema se
guarda en el motor (`settings_set`, clave `theme`) y se aplica poniendo `data-theme` en `<html>`; los
colores viven únicamente en `src/styles/tokens.css` (§7). No se sigue la preferencia del sistema: la app
arranca clara salvo que la persona haya elegido oscuro.

**`src/lib/theme.ts`:**

- `type Theme = "light" | "dark"`.
- `applyTheme(theme)`: `document.documentElement.dataset.theme = theme`.
- `loadTheme(): Promise<Theme>`: pide `settings_get` con `engineRequest` (paso 5) y valida con zod que
  `theme` sea `"light"` o `"dark"`; ante **cualquier** fallo devuelve `"light"`.
- `saveTheme(theme)`: `settings_set` con `{ key: "theme", value: theme }`.

**`src/screens/SettingsScreen.tsx`:** un `<fieldset>` con `<legend>Tema</legend>` y dos radios nativos
con etiquetas "Claro" y "Oscuro", nombre `theme`. Al cambiar, llama `applyTheme` y `saveTheme` una vez.
Los radios nativos ya se operan con teclado (Espacio, flechas).

**`src/App.tsx` (reemplaza):** encabezado con el nombre del producto, navegación con dos botones
("Inicio" y "Ajustes", el activo lleva `aria-current="page"`) y la pantalla activa. Al montar llama
`applyTheme("light")` de inmediato (sin parpadeo) y luego `loadTheme()` y aplica el resultado. La pantalla
"Inicio" muestra por ahora el mismo texto del paso 1; el paso 14 la reemplaza.

**`src/lib/theme.test.ts`** además de probar `applyTheme`, lee `src/styles/tokens.css` con `node:fs`
(`@types/node` ya está instalado), extrae los pares `--nombre: valor;` de los bloques `:root` y
`:root[data-theme="dark"]` y:

- comprueba que ambos bloques definen los mismos nombres de color (`--bg`, `--surface`, `--fg`,
  `--fg-muted`, `--primary`, `--primary-fg`, `--border`, `--divider`, `--destructive`, `--success`,
  `--focus`);
- calcula la razón de contraste WCAG 2.2 (`(L1+0,05)/(L2+0,05)` con la luminancia relativa estándar) y
  exige **≥ 4,5** para `--fg` sobre `--bg` y `--surface`, `--fg-muted` sobre `--bg` y `--surface`,
  `--primary-fg` sobre `--primary`, `--primary` sobre `--bg`, `--destructive` sobre `--bg` y
  `--success` sobre `--bg`, y **≥ 3** para `--border` sobre `--bg`, en ambos temas;
- recorre `src/` y exige que ningún `.ts`, `.tsx` o `.css` (salvo `tokens.css` y los `*.test.*`) contenga
  `#rrggbb`, `rgb(`, `rgba(` o `hsl(`.

**`src/App.test.tsx` (reemplaza)** sustituye `./lib/ipc.ts` con `vi.mock` para controlar
`engineRequest`.

**Files**
- `src/lib/theme.ts`
- `src/lib/theme.test.ts`
- `src/screens/SettingsScreen.tsx`
- `src/App.tsx`
- `src/App.test.tsx`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** the app starts and `settings_get` reports theme "light" **THE SYSTEM SHALL** set `document.documentElement.dataset.theme` to "light", and WHEN it reports "dark" **THE SYSTEM SHALL** set it to "dark".
2. **WHEN** the user selects the "Oscuro" radio **THE SYSTEM SHALL** set `data-theme` to "dark" and call `settings_set` with key `theme` and value `dark` exactly once.
3. **WHEN** `settings_get` rejects **THE SYSTEM SHALL** fall back to light, keep the app usable and render no element with role `alert`.
4. **WHEN** the "Oscuro" radio is focused and the Space key is pressed **THE SYSTEM SHALL** select it, and the radio group SHALL have the accessible name "Tema".
5. **WHEN** `tokens.css` is parsed **THE SYSTEM SHALL** define the same colour token names in the light and the dark block, every listed text pair SHALL measure at least 4.5:1 and `--border` on `--bg` at least 3:1 in both themes.
6. **WHEN** every `.ts`, `.tsx` and `.css` file under `src` other than `tokens.css` and the test files is scanned **THE SYSTEM SHALL** find no hex, `rgb(`, `rgba(` or `hsl(` colour literal.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm exec vitest run src/lib/theme.test.ts src/App.test.tsx
pnpm typecheck
pnpm lint
pnpm build:ui
```

**Checkpoint**

```bash
git add -A && git commit -m "E3-T1: Tema claro y oscuro, y estructura de la aplicación"
git tag step-13-theme-shell
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E3-T2` — Pantallas de inicio y de revisión de ráfagas

**Depends on:** `E3-T1`, `E2-T5` · **Priority:** p0 — metadata for scope cuts, not a running order

La persona elige una carpeta o archivos, ve el avance del análisis y revisa cada ráfaga con las tomas
marcadas por la app, que puede corregir. Todo el texto de la interfaz está en español. La interfaz nunca
toca archivos ni la base: habla con el motor únicamente a través de `engine_request`.

**`src/lib/engine.ts`:** envoltorios tipados sobre `engineRequest` (paso 5), cada uno con su esquema zod:
`scan`, `analyze`, `cancel`, `bursts`, `select`, `setPick`, `preview`, `setSetting`, `getSettings`;
`pickFolder()` y `pickFiles()` invocan los comandos Tauri `pick_folder` y `pick_files` (devuelven la ruta o
las rutas, o `null` si la persona cancela el diálogo); `onEngineEvent(callback)` escucha el evento
`engine-event` con `listen` de `@tauri-apps/api/event`.

**`HomeScreen.tsx`:** encabezado "Elige tus fotos"; botones "Elegir carpeta" y "Elegir archivos". Flujo:
elegir → `scan` → `analyze` → barra de avance (`role="progressbar"` con `aria-valuenow` = hechas,
`aria-valuemax` = total, y la etiqueta visible "Analizando {hechas} de {total} fotos") mientras llegan las
notificaciones `progress` → al recibir `job_done` con estado `done`, `select` y entrega el resultado a la
pantalla de revisión. Botón "Cancelar" mientras corre. Mensajes (en un elemento `role="alert"`):
-32010 → "Esa carpeta no está permitida. Elígela de nuevo con el botón."; resultado sin fotos →
"No encontré fotos compatibles en esa selección."; cualquier otro error → "No se pudo analizar la
selección."

**`ReviewScreen.tsx`:** a la izquierda, una lista de botones "Ráfaga {n} · {m} fotos"; al centro, las
fotos de la ráfaga activa como botones (cada uno con la vista previa de `preview`, y `aria-label` =
"{nombre del archivo}, elegida" o "{nombre del archivo}, no elegida"), con la insignia visible "Elegida"
en las elegidas; a la derecha, las puntuaciones de la foto enfocada (nitidez relativa, exposición, ojos
abiertos o "sin rostro", combinada). Teclado: las flechas mueven el foco entre fotos (un solo elemento en
el orden de tabulación), Espacio alterna la elección y llama `setPick`. Panel "Ajustes de selección": número
"Fotos por ráfaga" (1–20), tres deslizadores "Peso de nitidez", "Peso de exposición" y "Peso de ojos
abiertos", y el botón "Aplicar", que guarda con `setSetting` y vuelve a llamar `select`.

**`App.tsx` (edita):** "Inicio" muestra `HomeScreen`, y la revisión reemplaza su contenido cuando hay
resultado. **`screens.test.tsx`** sustituye `./lib/engine.ts` con `vi.mock` y ejercita ambas pantallas.

**Files**
- `src/lib/engine.ts`
- `src/screens/HomeScreen.tsx`
- `src/screens/ReviewScreen.tsx`
- `src/screens/screens.test.tsx`
- `src/App.tsx`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** bursts load **THE SYSTEM SHALL** list one button per burst labelled "Ráfaga {n} · {m} fotos" and mark the auto-selected photos with the visible text "Elegida".
2. **WHEN** the user presses Space on a focused photo **THE SYSTEM SHALL** call `setPick` with the toggled value and update that photo's "Elegida" mark and accessible label.
3. **WHEN** `progress` events arrive **THE SYSTEM SHALL** render a `progressbar` whose `aria-valuenow` equals `done` and `aria-valuemax` equals `total`, labelled "Analizando {done} de {total} fotos".
4. **WHEN** the user sets "Fotos por ráfaga" to 2 and presses "Aplicar" **THE SYSTEM SHALL** call `setSetting` for `per_burst` with 2 and then call `select` again.
5. **WHEN** `scan` fails with code -32010 **THE SYSTEM SHALL** show "Esa carpeta no está permitida. Elígela de nuevo con el botón." in an element with role `alert`.
6. **WHEN** the scan finds no supported photos **THE SYSTEM SHALL** show "No encontré fotos compatibles en esa selección." and no burst list.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm exec vitest run src/screens/screens.test.tsx
pnpm exec vitest run src/lib/theme.test.ts
pnpm typecheck
pnpm lint
pnpm build:ui
```

**Checkpoint**

```bash
git add -A && git commit -m "E3-T2: Pantallas de inicio y de revisión de ráfagas"
git tag step-14-review-ui
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E3-T3` — Exportar la selección sin tocar los originales

**Depends on:** `E2-T5`, `E2-T2` · **Priority:** p0 — metadata for scope cuts, not a running order

Exportar **copia** las fotos elegidas a una carpeta de destino. Nunca mueve, renombra ni modifica un
original. Es un trabajo en segundo plano igual que `analyze` (usa `Jobs`, `Job` y el `Emitter` del paso 8),
porque copiar 100 RAW de 47 MB lleva minutos.

**`export.py`:**

- `plan(photos, dest) -> list[tuple[Path, Path]]`: para cada foto elegida decide el archivo de destino
  `dest / nombre`; si ya existe en el disco **o** ya está planificado, agrega `_1`, `_2`… antes de la
  extensión hasta encontrar un nombre libre. Si junto al original hay un sidecar `<mismo nombre>.xmp`
  (sin distinguir mayúsculas), planifica también su copia con el nombre final de la foto.
- `run(...)`: copia cada archivo a `<destino>.part` y lo renombra con `os.replace` (nunca sobrescribe un
  archivo existente, porque `plan` ya eligió un nombre libre), usando `shutil.copyfile`. Emite
  `progress` `{job_id, kind: "export", done, total}` cada archivo y `job_done` con
  `{job_id, kind: "export", state, copied, failed}`.
- Los originales solo se abren en modo lectura.

**`app.py` agrega** `export {session_id, dest}` → `{job_id}`. Reglas, en este orden y **antes de copiar
nada**: sesión inexistente → -32011; `dest` fuera de toda raíz permitida → -32010; `dest` igual a, o
dentro de, la carpeta de cualquier foto de la sesión → -32014 (`DEST_INSIDE_SOURCE`). Las fotos a copiar
son las filas de `selections` con `selected = 1` de esa sesión; si no hay ninguna, el trabajo termina
con `copied` 0.

**`tests/test_export.py`** crea archivos reales pequeños en `tmp_path` (carpeta de origen y de destino
hermanas), concede ambas raíces con `Roots.grant` y compara con `hashlib.sha256`.

**Files**
- `engine/mejores_engine/export.py`
- `engine/mejores_engine/app.py`
- `engine/tests/test_export.py`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `export` runs on a session with 3 selected photos **THE SYSTEM SHALL** create exactly those 3 files in the destination, byte-identical to the originals (equal SHA-256), and report `copied` 3.
2. **WHEN** a file with the same name already exists in the destination, or two photos share a name, **THE SYSTEM SHALL** keep every file by adding `_1`, `_2` before the extension and never overwrite.
3. **WHEN** the destination equals a source folder or lies inside one **THE SYSTEM SHALL** reply with error code -32014 and copy nothing, and WHEN the destination is outside every granted root **THE SYSTEM SHALL** reply with -32010.
4. **WHEN** a selected RAW has a `.xmp` sidecar beside it **THE SYSTEM SHALL** copy the sidecar with the same new base name.
5. **WHEN** the export finishes **THE SYSTEM SHALL** leave every original with the same size, modification time and SHA-256 it had before.
6. **WHEN** no photo is selected **THE SYSTEM SHALL** finish in state `done` with `copied` 0 and create no file in the destination.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:engine
pnpm lint:engine
pnpm typecheck:engine
```

**Checkpoint**

```bash
git add -A && git commit -m "E3-T3: Exportar la selección sin tocar los originales"
git tag step-15-export-engine
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E3-T4` — Botón de exportación en la pantalla de revisión

**Depends on:** `E3-T2`, `E3-T3` · **Priority:** p0 — metadata for scope cuts, not a running order

**`engine.ts` (edita):** agrega `exportSelection(sessionId, dest)` (método `export`, esquema zod
`{ job_id }`).

**`ExportPanel.tsx`:** un botón "Exportar elegidas" (deshabilitado, con el texto visible "Elige al menos
una foto para exportar." cuando no hay ninguna elegida). Al pulsarlo llama `pickFolder()` (el shell
autoriza el destino); si devuelve `null` no hace nada más. Con una ruta, llama `exportSelection` y muestra
"Copiando {hechas} de {total}" con las notificaciones `progress` de tipo `export`. Al terminar muestra, en
un elemento `role="status"`: "Se copiaron {n} fotos a {destino}. Tus originales no se tocaron." Errores en
`role="alert"`: -32014 → "Esa carpeta está dentro de la carpeta de origen. Elige otra."; -32010 →
"Esa carpeta no está permitida. Elígela de nuevo con el botón."; otros → "No se pudo exportar.".

**`ReviewScreen.tsx` (edita)** incluye `<ExportPanel />` en el panel derecho y le pasa el id de sesión y
el número de fotos elegidas. **`screens.test.tsx` (edita)** agrega los casos de abajo.

**Files**
- `src/lib/engine.ts`
- `src/screens/ExportPanel.tsx`
- `src/screens/ReviewScreen.tsx`
- `src/screens/screens.test.tsx`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** the user presses "Exportar elegidas" and picks a destination **THE SYSTEM SHALL** call `exportSelection` with the session id and that destination and show "Copiando {done} de {total}" while `progress` events of kind `export` arrive.
2. **WHEN** `job_done` reports `copied` 4 **THE SYSTEM SHALL** show "Se copiaron 4 fotos a {destino}. Tus originales no se tocaron." in an element with role `status`.
3. **WHEN** `exportSelection` fails with code -32014 **THE SYSTEM SHALL** show "Esa carpeta está dentro de la carpeta de origen. Elige otra." in an element with role `alert` and no success message.
4. **WHEN** no photo is selected **THE SYSTEM SHALL** disable the export button and show "Elige al menos una foto para exportar.".
5. **WHEN** the folder dialog is cancelled and returns null **THE SYSTEM SHALL** not call `exportSelection`.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm exec vitest run src/screens/screens.test.tsx
pnpm exec vitest run src/lib/theme.test.ts
pnpm typecheck
pnpm lint
pnpm build:ui
```

**Checkpoint**

```bash
git add -A && git commit -m "E3-T4: Botón de exportación en la pantalla de revisión"
git tag step-16-export-ui
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E3-T5` — Empaquetado: motor congelado e instalador de Windows

**Depends on:** `E3-T4`, `E2-T4`, `E2-T6` · **Priority:** p0 — metadata for scope cuts, not a running order

El instalador lleva el motor **congelado** con PyInstaller en modo carpeta (`--onedir`, que arranca
en segundos; `--onefile` extraería cientos de MB en cada arranque). Tauri copia esa carpeta como recurso
a `<carpeta de instalación>/engine/`, que es donde `engine.rs` (paso 5) la busca en publicación. La
instalación es por usuario (`installMode: currentUser`), no necesita administrador. **No hay firma de
código en la v1** (§1): Windows mostrará el aviso de SmartScreen, que se documenta en §20.1.

**`app.py` (edita):** agrega `selftest {}` → un objeto con seis booleanos que el motor congelado debe
poder contestar de verdad: `migrations_present` (existe `0001_init.sql` junto al paquete), `model_present`
(existe `assets/face_landmarker.task` con el tamaño esperado), `rawpy_ok`, `cv2_ok`, `mediapipe_ok`
(importan) y `landmarker_loads` (crea el `FaceLandmarker` con el modelo del disco).

**`scripts/build_sidecar.py`** ejecuta, desde `engine/`, PyInstaller con estas opciones y falla (código 1)
si no existe `engine/dist/mejores-engine/mejores-engine.exe` al final:

```python
cmd = [
    "uv", "run", "--frozen", "--directory", str(ENGINE),
    "pyinstaller", "--noconfirm", "--clean", "--onedir", "--console",
    "--name", "mejores-engine",
    "--distpath", "dist", "--workpath", "build", "--specpath", "build",
    "--paths", ".",
    "--add-data", "mejores_engine/migrations;mejores_engine/migrations",
    "--add-data", "mejores_engine/assets;mejores_engine/assets",
    "--collect-all", "mediapipe",
    "--collect-all", "rawpy",
    "mejores_engine/__main__.py",
]
```

(`ENGINE` es `<raíz>/engine`; las rutas de `--add-data` usan `;` porque es Windows.)

**`src-tauri/tauri.bundle.conf.json`** se mezcla con la configuración base solo al empaquetar:

```json
{
  "bundle": {
    "resources": { "../engine/dist/mejores-engine/": "engine/" }
  }
}
```

**`package.json` (edita)** agrega los scripts `"build:sidecar": "uv run --directory engine python ../scripts/build_sidecar.py"`
y `"build:app": "tauri build --config src-tauri/tauri.bundle.conf.json"`.

Tamaño: la v1 se acepta por debajo de 600 MiB (§20.2); mide y anota el tamaño real en el mensaje del
commit.

**Files**
- `scripts/build_sidecar.py`
- `src-tauri/tauri.bundle.conf.json`
- `package.json`
- `engine/mejores_engine/app.py`
- `engine/tests/test_selftest.py`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `pnpm build:sidecar` runs **THE SYSTEM SHALL** produce `engine/dist/mejores-engine/mejores-engine.exe`.
2. **WHEN** that executable runs with `--version` **THE SYSTEM SHALL** print `mejores-engine 0.1.0` and exit 0.
3. **WHEN** that executable receives a `selftest` request with `MT_DATA_DIR` pointing at an empty folder **THE SYSTEM SHALL** answer with all six checks true.
4. **WHEN** that executable receives `settings_get` with `MT_DATA_DIR` pointing at an empty folder **THE SYSTEM SHALL** answer theme "light", proving a fresh database is created and migrated by the packaged build.
5. **WHEN** `pnpm build:app` runs **THE SYSTEM SHALL** produce `src-tauri/target/release/bundle/nsis/Mejores Tomas_0.1.0_x64-setup.exe` smaller than 629145600 bytes.
6. **WHEN** `pnpm test:engine` runs **THE SYSTEM SHALL** pass the `selftest` unit test in the development environment too.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:engine
pnpm lint:engine
pnpm typecheck:engine
pnpm build:sidecar
engine/dist/mejores-engine/mejores-engine.exe --version | grep -qx 'mejores-engine 0.1.0'
MT_DATA_DIR="$(mktemp -d)" && printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"selftest"}' | MT_DATA_DIR="$MT_DATA_DIR" engine/dist/mejores-engine/mejores-engine.exe | grep -qx '{"jsonrpc":"2.0","id":1,"result":{"migrations_present":true,"model_present":true,"rawpy_ok":true,"cv2_ok":true,"mediapipe_ok":true,"landmarker_loads":true}}'
MT_DATA_DIR="$(mktemp -d)" && printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"settings_get"}' | MT_DATA_DIR="$MT_DATA_DIR" engine/dist/mejores-engine/mejores-engine.exe | grep -q '"theme":"light"'
pnpm build:app
test -f 'src-tauri/target/release/bundle/nsis/Mejores Tomas_0.1.0_x64-setup.exe'
test "$(wc -c < 'src-tauri/target/release/bundle/nsis/Mejores Tomas_0.1.0_x64-setup.exe')" -lt 629145600
```

**Checkpoint**

```bash
git add -A && git commit -m "E3-T5: Empaquetado: motor congelado e instalador de Windows"
git tag step-17-packaging
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

---

## Epic acceptance

The epic is done when every task is `done` **and**:

1. **WHEN** the user switches to "Oscuro" in Ajustes **THE SYSTEM SHALL** keep dark after the engine restarts (setting persisted).
2. **WHEN** the installer is built **THE SYSTEM SHALL** contain a frozen engine that passes `selftest` on an empty data folder.

```bash
pnpm test
pnpm test:engine
pnpm build:app
```

Run from the project root. Both criteria must be decidable by these commands.

## Pitfalls

- **Colour literals** — the most common failure is a `#fff` slipped into a component; use the token.
- **PyInstaller and MediaPipe** — if `selftest` reports a false check, add the missing data with `--collect-all <package>` or `--add-data` in `scripts/build_sidecar.py`; never ship a build with a false check.
- **Installer size** — if the installer reaches 600 MiB, report it instead of raising the limit; the decision belongs to the author (blueprint §20.2).
- **Unsigned installer** — Windows SmartScreen will warn on install; that is expected in v1 and documented, not a defect.

## Before moving on

- [ ] Every task in this epic is `done` in `tasks.json` — no task left `in_progress`.
- [ ] Every `verify` command of every task in this epic passed, not just the first one.
- [ ] No `verify` command was edited, and none was skipped because a file it names did not exist.
- [ ] **Every task in this epic has its `checkpoint` tag in version control** — `git tag -l 'step-*'` lists them.
- [ ] Gate command passes clean, run from the project root.
- [ ] Every "Produced" contract above exists with the stated signature.
- [ ] No file outside the subtree was modified.
- [ ] `.env.example` is unchanged: this project adds no required variable.
- [ ] One commit per task, each prefixed with its task id, each followed by its checkpoint tag.
