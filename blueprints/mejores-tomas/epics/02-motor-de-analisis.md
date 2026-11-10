# Epic 02: Motor de análisis

> El motor lee fotos (incluidos RAW), calcula sus rasgos en paralelo con progreso y cancelación, agrupa ráfagas, puntúa y elige las mejores, y reutiliza lo ya calculado.

| | |
|---|---|
| **Epic id** | `02-motor-de-analisis` |
| **Tasks** | `E2-T1` … `E2-T6` |
| **Depends on** | `01-fundamentos` |
| **Unlocks** | `03-interfaz-y-entrega` |
| **Parallel with** | nothing — it edits `app.py` and `rpc.py` that the other epics read |

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
engine/
  mejores_engine/
    features.py analyze.py grouping.py eyes.py scoring.py     # NEW (steps 7-11)
    rpc.py app.py __main__.py                                 # edit (steps 7, 8, 9, 11)
    store.py                                                  # edit (step 12)
    assets/face_landmarker.task                               # NEW (step 10)
    migrations/0002_feature_cache.sql                         # NEW (step 12)
  tests/test_features.py test_analyze.py test_grouping.py test_eyes.py
        test_scoring.py test_pipeline.py test_cache.py        # NEW
scripts/bench_raw.py fetch_model.py                           # NEW (steps 7, 10)
```

Everything outside this subtree is out of scope. If a task seems to require editing a file not listed here, stop and report — it means the epic boundary is wrong.

## Data model touched here

| Entity | Fields this epic adds or reads | Notes |
|---|---|---|
| `photos` | `width, height, exif_time, dhash` | Filled by `analyze`; `exif_time` is ISO local time without zone |
| `scores` | `photo_id, sharpness, exposure, mean_luma, clip_hi, clip_lo, eyes_open, engine_version, computed_at` | One row per photo; `eyes_open` is NULL when no face is found |
| `bursts / burst_members` | `id, session_id, position / burst_id, photo_id, position` | Rebuilt entirely on every `bursts` call |
| `selections` | `burst_id, photo_id, source, selected` | `source = 'user'` rows are never overwritten by `select` |
| `feature_cache` | `path, size_bytes, mtime_ns, features_version, eyes, features_json` | Added by migration 0002; no foreign keys |

## Contracts

**Consumed** — already exists, do not rebuild:

| From | Interface | Guarantee |
|---|---|---|
| `01-fundamentos` | `Dispatcher`, `RpcError`, `Store.session()`, `settings.get_all`, `Roots` | As listed in that epic's Produced table |

**Produced** — later steps depend on exactly these signatures. Changing one breaks them:

| Export | Signature | Used by |
|---|---|---|
| `features.py` → `Features`, `extract`, `hamming_hex`, `preview_data_url`, `FEATURES_VERSION` | `extract(path: Path, fmt: str, eyes: bool = False) -> Features` | steps 8, 9, 12; `03-interfaz-y-entrega` |
| `analyze.py` → `Jobs`, `Job` | `analyze`, `cancel`, `job_status` RPC methods; `progress` and `job_done` notifications | step 15, `03-interfaz-y-entrega` |
| `grouping.py` → `Frame`, `group_frames`, `natural_key` | `group_frames(frames, time_gap_s, hamming_max)` | step 11 |
| `scoring.py` → `sharpness_norm`, `fill_eyes`, `combined`, `choose` | pure functions over lists of floats | step 11 |
| RPC methods `preview`, `bursts`, `select`, `set_pick` | see blueprint §5 table (reproduced in each step's Do) | `03-interfaz-y-entrega` |

## Conventions that bite in this area

- Workers of the process pool must call top-level, picklable functions and must not touch the database; only the job thread writes to SQLite, through its own connection.
- If a feature formula changes, bump `FEATURES_VERSION` so the cache invalidates.
- Tests build every image with numpy/OpenCV and fake `rawpy.imread` with `monkeypatch`. Never commit a RAW file or a real photo.
- MediaPipe writes warnings to stderr only; keep it that way (a `ping` after landmarker use must still yield exactly one stdout line).
- The engine never opens a socket. `test_pipeline.py` replaces `socket.socket` to prove it.

Full project rules: `CLAUDE.md`. Area rules: `.claude/rules/*.md`. Both sit in the project root — the builder copied them there from the bundle's `workspace/` before task one.

---

## Tasks

Listed in the same order as `tasks.json`. That order is the build order — work top to bottom and do not re-rank by priority or by what looks quick.

### `E2-T1` — Rasgos por foto: vista previa, nitidez, exposición y huella

**Depends on:** `E1-T6` · **Priority:** p0 — metadata for scope cuts, not a running order

Este módulo convierte un archivo en los números que usan los pasos siguientes. La decisión de
diseño que lo hace viable con RAW de 45 MB es **no revelar el RAW**: se extrae la vista previa JPEG que la
cámara ya incrustó. En 2.128 archivos ARW de Sony medidos antes de escribir este blueprint, leer y analizar
esa vista previa (1616×1080) costó 44 ms por foto en un solo proceso y 29,5 s en total con 6 procesos, frente
a 0,27 s por foto del revelado a mitad de tamaño. La vista previa no trae subsegundos en el EXIF; el
agrupado (paso 9) lo compensa.

**`features.py`** define `FEATURES_VERSION = "1"` (cambia cuando cambie cualquier fórmula de abajo; la
caché del paso 12 depende de él) y:

```python
@dataclass(frozen=True)
class Features:
    width: int
    height: int
    exif_time: str | None      # ISO 8601 local, "2026-11-04T13:47:39", or None
    dhash: str                 # 16 lowercase hex digits
    sharpness: float           # variance of the Laplacian over the centre crop
    mean_luma: float           # 0..255
    clip_hi: float             # fraction of pixels >= 250
    clip_lo: float             # fraction of pixels <= 5
    exposure: float            # 0..1
    eyes_open: float | None = None   # filled from step 10 on
```

`extract(path: Path, fmt: str) -> Features`:

1. **Obtener los bytes de una imagen.** `jpg` y `png`: el contenido del archivo. `raw`: abre con
   `rawpy.imread(str(path))` y llama `extract_thumb()`; si su `format` es `rawpy.ThumbFormat.JPEG` usa
   `thumb.data`; si es `BITMAP`, codifícalo a JPEG con `cv2.imencode`; si lanza
   `rawpy.LibRawNoThumbnailError` o `LibRawUnsupportedThumbnailError`, recurre a
   `raw.postprocess(half_size=True, use_camera_wb=True, no_auto_bright=True)` y codifícalo igual.
2. **Decodificar** con `cv2.imdecode(..., cv2.IMREAD_COLOR)`; si devuelve `None`, lanza
   `RpcError(DECODE_FAILED, "cannot decode <nombre>")`. Deriva `gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)`.
3. **Fórmulas** (todas sobre `gray`, `h, w = gray.shape`):
   - `sharpness = cv2.Laplacian(gray[h//4:3*h//4, w//4:3*w//4], cv2.CV_64F).var()`
   - `mean_luma = gray.mean()`, `clip_hi = (gray >= 250).mean()`, `clip_lo = (gray <= 5).mean()`
   - `exposure = clamp(1 - 0.5 * abs(mean_luma - 118) / 118 - 4 * clip_hi - 2 * clip_lo, 0, 1)`
   - `dhash`: `small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)`;
     `bits = (small[:, 1:] > small[:, :-1]).flatten()` (64 booleanos, fila a fila); el hash es el entero
     cuyo bit más significativo es `bits[0]`, escrito como 16 dígitos hexadecimales en minúscula.
4. **EXIF** con `PIL.Image.open(BytesIO(bytes)).getexif()`: toma `ExifIFD` (`get_ifd(0x8769)`) etiqueta
   `36867` (DateTimeOriginal) y, si falta, la etiqueta base `306`. Convierte `"YYYY:MM:DD HH:MM:SS"` a ISO
   `"YYYY-MM-DDTHH:MM:SS"`; cualquier fallo o formato raro da `None`. Un PNG sin EXIF da `None`.

`hamming_hex(a: str, b: str) -> int` devuelve `(int(a, 16) ^ int(b, 16)).bit_count()`.

`preview_data_url(path: Path, fmt: str, max_px: int = 960) -> str`: mismo paso 1 y 2, redimensiona con
`cv2.INTER_AREA` para que el lado mayor sea como máximo `max_px` (sin ampliar), codifica JPEG calidad 85
y devuelve `data:image/jpeg;base64,<…>`.

**`rpc.py`:** agrega `DECODE_FAILED = -32015`. **`app.py`:** agrega el método
`preview {photo_id, max_px?: int = 960}` → `{data_url}`; busca la foto en `photos` (si no existe,
`NOT_FOUND` -32011) y usa `preview_data_url`.

**`scripts/bench_raw.py <carpeta>`** toma hasta 60 archivos RAW de la carpeta, llama a `extract` en un
solo proceso, e imprime `files/s: <n>` en una línea. Es la herramienta de la compuerta manual de
rendimiento de §20.1; no forma parte de las compuertas automáticas porque depende de RAW reales.

**Pruebas (`tests/test_features.py`)**: genera todas las imágenes con numpy/OpenCV dentro de la prueba
(damero nítido de 512×512, su copia con `cv2.GaussianBlur`, grises uniformes, JPEG con EXIF escrito con
Pillow); sustituye `rawpy.imread` con `monkeypatch` por un objeto falso con `extract_thumb()` que devuelve
los bytes de un JPEG, y otro que lanza `rawpy.LibRawNoThumbnailError` y ofrece `postprocess`. No se
versionan archivos RAW.

**Files**
- `engine/mejores_engine/features.py`
- `engine/mejores_engine/rpc.py`
- `engine/mejores_engine/app.py`
- `engine/tests/test_features.py`
- `scripts/bench_raw.py`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `extract` reads a sharp 512x512 checkerboard and a Gaussian-blurred copy of it **THE SYSTEM SHALL** report a `sharpness` at least 10 times higher for the sharp image.
2. **WHEN** the image is uniformly grey at value 118 **THE SYSTEM SHALL** report `exposure` 1.0, and WHEN it is all white or all black **THE SYSTEM SHALL** report `exposure` 0.0 with `clip_hi` 1.0 or `clip_lo` 1.0.
3. **WHEN** a JPEG carries DateTimeOriginal "2026:11:04 13:47:39" **THE SYSTEM SHALL** return `exif_time` "2026-11-04T13:47:39", and WHEN a PNG has no EXIF **THE SYSTEM SHALL** return `exif_time` None.
4. **WHEN** a RAW file is read **THE SYSTEM SHALL** use the embedded JPEG preview and return the same features as for that JPEG, and WHEN no embedded preview exists **THE SYSTEM SHALL** fall back to a half-size demosaic.
5. **WHEN** a file cannot be decoded **THE SYSTEM SHALL** raise error code -32015, and WHEN `preview` is called **THE SYSTEM SHALL** return a `data:image/jpeg;base64,` URL whose decoded longest side is at most `max_px`.
6. **WHEN** `hamming_hex` compares "0000000000000000" with "ffffffffffffffff" **THE SYSTEM SHALL** return 64, and WHEN the same image is hashed twice **THE SYSTEM SHALL** return the same 16-digit hash.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:engine
pnpm lint:engine
pnpm typecheck:engine
test -f scripts/bench_raw.py
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T1: Rasgos por foto: vista previa, nitidez, exposición y huella"
git tag step-07-features
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E2-T2` — Trabajo de análisis en paralelo con progreso y cancelación

**Depends on:** `E2-T1` · **Priority:** p0 — metadata for scope cuts, not a running order

`analyze` procesa todas las fotos de una sesión con un pool de procesos, guarda los rasgos en la base
y avisa del avance. El bucle de `serve` atiende peticiones una a una, así que el trabajo corre en un **hilo
en segundo plano** y las notificaciones salen por un emisor con candado.

**`rpc.py` (edita):** agrega `class Emitter` con `__init__(sink: TextIO)`, `send_line(line: str)` y
`notify(method: str, params: dict[str, Any])`. Todos los envíos toman un `threading.Lock` y hacen `flush`.
`serve(dispatcher, source, emitter)` pasa a recibir el emisor en lugar del `sink`.
**`app.py` (edita):** `build_dispatcher(store_factory=Store, emitter=None, executor_factory=None,
extractor=features.extract)`; sin emisor usa uno que descarta. `main()` crea
`Emitter(sys.stdout)`. **`__main__.py` (edita):** llama `multiprocessing.freeze_support()` antes de
`main()` (necesario para PyInstaller en el paso 17).

**`analyze.py`** guarda un registro `Jobs` (id → `Job`) y expone el trabajo:

- `analyze {session_id, eyes?: bool = true}` → `{job_id}` inmediato. Sesión inexistente: -32011. Si ya hay
  un trabajo de análisis en marcha para esa sesión: -32602 con el mensaje "job already running".
- El hilo del trabajo crea el pool (`ProcessPoolExecutor(max_workers=min(os.cpu_count() or 1, 6))` por
  defecto; las pruebas inyectan `ThreadPoolExecutor`), envía una tarea por foto
  (`extractor(Path(ruta), formato)`), y por cada resultado ejecuta, en su **propia conexión** de la base,
  `UPDATE photos SET width, height, exif_time, dhash` y un `INSERT OR REPLACE INTO scores` con
  `engine_version = FEATURES_VERSION`. Confirma la transacción cada 20 resultados y al final.
- Un fallo en una foto (por ejemplo -32015) **no aborta** el trabajo: suma a `failed` y agrega
  `{path, message}` a `errors`.
- **Progreso:** notificación `progress` con `{job_id, kind: "analyze", done, total}` al inicio, cada vez que
  cambie `done` con un mínimo de 250 ms entre envíos, **y un latido cada 1000 ms aunque `done` no cambie**,
  y siempre al terminar. Al terminar, `job_done` con `{job_id, kind, state, computed, cached, failed}`
  (`cached` vale 0 hasta el paso 12).
- `cancel {job_id}` → `{state}`: marca el evento de cancelación; el hilo hace
  `executor.shutdown(wait=False, cancel_futures=True)`, deja el estado en `cancelled` y emite `job_done`.
  Debe completarse en menos de 1 s con tareas de hasta 0,3 s.
- `job_status {job_id}` → `{state, done, total, computed, cached, failed, errors}` con `state` en
  `running | done | cancelled | failed`. Un `job_id` desconocido: -32011.

**Pruebas (`tests/test_analyze.py`)**: un `ListEmitter` de prueba guarda las notificaciones con la hora
de recepción; un extractor falso duerme un tiempo configurable y devuelve `Features` fijos; los casos
con proceso real usan tres JPEG sintéticos escritos en `tmp_path` y `features.extract`.

**Files**
- `engine/mejores_engine/analyze.py`
- `engine/mejores_engine/rpc.py`
- `engine/mejores_engine/app.py`
- `engine/mejores_engine/__main__.py`
- `engine/tests/test_analyze.py`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `analyze` runs over a session of 40 photos with a fake extractor **THE SYSTEM SHALL** end in state `done`, store `dhash` for all 40 rows, and emit a last `progress` with `done` equal to `total`.
2. **WHEN** a single photo takes 2.5 seconds to analyse **THE SYSTEM SHALL** still emit `progress` notifications no more than 1.2 seconds apart.
3. **WHEN** `cancel` is called 0.3 seconds into a 50-photo job whose extractor takes 0.2 seconds per photo **THE SYSTEM SHALL** report state `cancelled` within 1.0 second of the call and emit `job_done` with state `cancelled`.
4. **WHEN** the extractor raises error code -32015 for one photo **THE SYSTEM SHALL** finish in state `done` with `failed` equal to 1, record that path in `errors`, and store the other photos.
5. **WHEN** three real JPEG files are analysed with a real `ProcessPoolExecutor` of 2 workers **THE SYSTEM SHALL** store a non-null `dhash` for each of them.
6. **WHEN** `analyze` is called for a session that already has a running job **THE SYSTEM SHALL** reply with error code -32602, and for an unknown session SHALL reply -32011.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:engine
pnpm lint:engine
pnpm typecheck:engine
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T2: Trabajo de análisis en paralelo con progreso y cancelación"
git tag step-08-analyze-job
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E2-T3` — Agrupación de ráfagas por tiempo y parecido visual

**Depends on:** `E2-T2` · **Priority:** p0 — metadata for scope cuts, not a running order

Una ráfaga es una secuencia de fotos consecutivas que se parecen y están cerca en el tiempo. Los
valores por defecto salen de medir 600 fotos reales: entre fotos consecutivas con hasta 1 s de diferencia,
la distancia de Hamming de la huella (paso 7) tuvo mediana 6 y percentil 90 de 19; entre fotos separadas
más de 10 s, mediana 31. Con umbral 22 se parten el 7 % de los vecinos de una misma ráfaga (28 de 409) y se
unen por error el 10 % de los pares lejanos (9 de 91). Por eso el umbral es un ajuste del usuario
(`hamming_max`, por defecto 22) igual que el hueco de tiempo (`time_gap_s`, por defecto 2.0 s).

**`grouping.py`:**

```python
@dataclass(frozen=True)
class Frame:
    photo_id: str
    name: str            # file name, used for natural ordering
    when: float          # seconds since the epoch
    dhash: str | None    # None when the photo failed to decode

def natural_key(name: str) -> list[object]: ...      # "IMG_10" sorts after "IMG_2"
def when_of(exif_time: str | None, mtime_ns: int) -> float: ...
def group_frames(frames: list[Frame], time_gap_s: float, hamming_max: int) -> list[list[Frame]]: ...
```

- `when_of`: si hay `exif_time`, `datetime.fromisoformat(exif_time).timestamp()` (hora local, igual que
  `mtime`); si no, `mtime_ns / 1e9`.
- `group_frames` ordena por `(when, natural_key(name))` y recorre consecutivos: el siguiente fotograma
  se une al grupo actual **solo si** `next.when - prev.when <= time_gap_s` **y** ninguno de los dos tiene
  `dhash` `None` **y** `hamming_hex(prev.dhash, next.dhash) <= hamming_max`. Si no, abre un grupo nuevo.
  Una foto sin `dhash` queda sola. El orden de salida es determinista.

**`app.py`:** agrega `bursts {session_id}` → `{bursts: [{id, position, photos: [{id, path, format,
exif_time}]}]}`. Lee los ajustes `time_gap_s` y `hamming_max`, **borra las ráfagas previas de la sesión** y
las reconstruye (idempotente), guardando `bursts` y `burst_members` con posiciones desde 0. Sesión
inexistente: -32011.

**Files**
- `engine/mejores_engine/grouping.py`
- `engine/mejores_engine/app.py`
- `engine/tests/test_grouping.py`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** two frames are 0.4 seconds apart with a hash distance of 6 **THE SYSTEM SHALL** place them in one burst.
2. **WHEN** two frames are 2.5 seconds apart with a hash distance of 0 and `time_gap_s` is 2.0 **THE SYSTEM SHALL** start a new burst.
3. **WHEN** two frames are 1 second apart and the hash distance is 23 with `hamming_max` 22 **THE SYSTEM SHALL** start a new burst, and WHEN the distance is exactly 22 **THE SYSTEM SHALL** keep them together.
4. **WHEN** a photo has no `exif_time` **THE SYSTEM SHALL** order it by file modification time, and WHEN two frames tie on time **THE SYSTEM SHALL** order them by natural file name so IMG_2 comes before IMG_10.
5. **WHEN** a frame has no hash **THE SYSTEM SHALL** leave it in a burst of its own.
6. **WHEN** `bursts` runs twice on the same session **THE SYSTEM SHALL** return the same memberships and positions and leave exactly one set of burst rows in the database.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:engine
pnpm lint:engine
pnpm typecheck:engine
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T3: Agrupación de ráfagas por tiempo y parecido visual"
git tag step-09-bursts
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E2-T4` — Ojos abiertos con MediaPipe local

**Depends on:** `E2-T1` · **Priority:** p1 — metadata for scope cuts, not a running order

Mide qué tan abiertos están los ojos usando el modelo FaceLandmarker de MediaPipe que corre **en el
equipo**: no hay llamadas a la red ni créditos. MediaPipe 1.x ya no trae la API `solutions`; solo la API
`tasks`, que necesita un archivo de modelo. Este paso lo descarga una vez, verifica su huella y lo
versiona en el repositorio (3,7 MB).

**Modelo (verificado al escribir este blueprint):**

- URL: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
- Tamaño: 3758596 bytes
- SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- Destino: `engine/mejores_engine/assets/face_landmarker.task`

**`scripts/fetch_model.py`** (solo biblioteca estándar): si el destino existe y su SHA-256 coincide, no
descarga nada y sale con 0. Si no, descarga con `urllib.request.urlopen`, escribe a un archivo temporal,
compara tamaño y SHA-256 y solo entonces lo mueve al destino. Si la huella no coincide, borra el
temporal y sale con 1. Las constantes de arriba son los valores del script. Ejecútalo una vez y versiona
el modelo (`.gitattributes` ya lo marca como binario).

**`eyes.py`:**

- `eyes_from_blendshapes(faces: list[dict[str, float]]) -> float | None`: para cada rostro,
  `1 - clamp((eyeBlinkLeft + eyeBlinkRight) / 2, 0, 1)`; devuelve el **mínimo** entre rostros (un ojo
  cerrado perjudica la foto) o `None` si no hay rostros.
- `score(bgr: np.ndarray) -> float | None`: crea una vez por proceso un
  `mediapipe.tasks.python.vision.FaceLandmarker` con `output_face_blendshapes=True`, `num_faces=6`,
  `RunningMode.IMAGE`, lo guarda en una variable de módulo y lo reutiliza. Convierte BGR a RGB contiguo,
  llama `detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))` y pasa los blendshapes
  (`category_name` → `score`) a `eyes_from_blendshapes`. En fotos de ráfaga medidas, tarda unos 8 ms.

**`features.py` (edita):** `extract(path, fmt, eyes: bool = False)`. Con `eyes=True` llama
`eyes.score(bgr)` y guarda el resultado en `Features.eyes_open`; con `False` ni importa ni carga el
modelo. `analyze` pasa `eyes` desde su parámetro (valor por defecto verdadero).

MediaPipe escribe avisos en `stderr`; nunca en `stdout`.

**Files**
- `scripts/fetch_model.py`
- `engine/mejores_engine/eyes.py`
- `engine/mejores_engine/features.py`
- `engine/mejores_engine/assets/face_landmarker.task`
- `engine/tests/test_eyes.py`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `uv run --directory engine python ../scripts/fetch_model.py` runs **THE SYSTEM SHALL** leave `face_landmarker.task` with size 3758596 and SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`, and WHEN the file is already correct **THE SYSTEM SHALL** exit 0 without downloading.
2. **WHEN** a download returns bytes whose SHA-256 differs **THE SYSTEM SHALL** delete the temporary file, leave any existing model untouched and exit 1.
3. **WHEN** `eyes_from_blendshapes` receives one face with both blink scores 0.9 **THE SYSTEM SHALL** return 0.1, with both 0.05 it SHALL return 0.95, with two faces it SHALL return the lower value, and with no faces it SHALL return None.
4. **WHEN** the real landmarker processes a uniform grey 512x512 image **THE SYSTEM SHALL** return None and not raise.
5. **WHEN** `extract` runs with `eyes=False` **THE SYSTEM SHALL** not load the model, and with `eyes=True` **THE SYSTEM SHALL** fill `eyes_open` (None when no face is found).
6. **WHEN** the engine answers a `ping` after the landmarker has run in the same process **THE SYSTEM SHALL** write exactly one line to stdout.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
uv run --directory engine python ../scripts/fetch_model.py
pnpm test:engine
pnpm lint:engine
pnpm typecheck:engine
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T4: Ojos abiertos con MediaPipe local"
git tag step-10-eyes
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E2-T5` — Puntuación combinada y selección por ráfaga

**Depends on:** `E2-T3`, `E2-T4` · **Priority:** p0 — metadata for scope cuts, not a running order

Convierte los rasgos de cada ráfaga en una puntuación explicable y elige las mejores. Las
puntuaciones no son absolutas: la nitidez se compara **dentro** de la ráfaga, porque lo que importa es
cuál de estas tomas parecidas es la mejor.

**`scoring.py`:**

- `sharpness_norm(values: list[float]) -> list[float]`: cada valor entre el máximo de la lista; si el máximo
  es 0, todos valen 1.0.
- `fill_eyes(values: list[float | None]) -> list[float | None]`: si **todos** son `None` se devuelve igual
  (los ojos no cuentan); si alguno tiene valor, los `None` toman el **promedio** de los que sí lo tienen,
  para no premiar ni castigar a la foto en la que el rostro no se detectó.
- `combined(sharp: float, exposure: float, eyes: float | None, weights: dict[str, float]) -> float`:
  `Σ(peso·valor) / Σ(peso)` sobre las métricas disponibles (si `eyes` es `None` su peso no suma).
- `choose(members: list[Scored], weights, per_burst: int) -> list[str]`: ordena por
  `(-combined, natural_key(nombre))` y devuelve los `per_burst` primeros ids (todos si hay menos).

**`app.py` agrega:**

- `select {session_id}` → `{bursts: [{id, position, photos: [{id, path, scores: {sharpness,
  sharpness_norm, exposure, eyes_open, combined}, selected, source}]}]}`. Reconstruye las ráfagas si no
  existen (llama la misma lógica que `bursts`), lee `weights` y `per_burst` de los ajustes, calcula y
  guarda en `selections` filas `source='auto'` para todos los miembros. **Si una ráfaga ya tiene alguna
  fila `source='user'`, no se toca esa ráfaga.**
- `set_pick {burst_id, photo_id, selected}` → `{burst_id, photo_id, selected, source: "user"}`; guarda una
  fila `source='user'` para esa foto. Ids desconocidos: -32011.

**`tests/test_pipeline.py`** recorre `scan → analyze → bursts → select` con seis JPEG sintéticos (dos
ráfagas de tres: una toma nítida y dos desenfocadas en cada una), un extractor real en un
`ThreadPoolExecutor`, y `socket.socket` sustituido por una función que lanza `AssertionError`, para
demostrar que **todo el flujo funciona sin red**.

**Files**
- `engine/mejores_engine/scoring.py`
- `engine/mejores_engine/app.py`
- `engine/tests/test_scoring.py`
- `engine/tests/test_pipeline.py`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** a burst has sharpness 100, 50 and 25 with equal exposure and `per_burst` is 1 **THE SYSTEM SHALL** select exactly the sharpest photo.
2. **WHEN** one photo has `eyes_open` None and another has 0.8 **THE SYSTEM SHALL** give the first the burst average, and WHEN every photo has None **THE SYSTEM SHALL** ignore the eyes weight entirely.
3. **WHEN** the eyes weight is set to 0 **THE SYSTEM SHALL** produce the same ranking whatever the `eyes_open` values.
4. **WHEN** `per_burst` is 2 **THE SYSTEM SHALL** select exactly 2 photos from a burst of 3 and all photos from a burst of 2 or fewer, and WHEN two photos tie **THE SYSTEM SHALL** prefer the one that comes first in natural file-name order.
5. **WHEN** the user has set a pick on a burst and `select` runs again **THE SYSTEM SHALL** leave that burst's selections unchanged.
6. **WHEN** the pipeline scan, analyze, bursts and select runs on six synthetic photos with network sockets disabled **THE SYSTEM SHALL** finish and select the sharp frame of each burst.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:engine
pnpm lint:engine
pnpm typecheck:engine
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T5: Puntuación combinada y selección por ráfaga"
git tag step-11-scoring
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

### `E2-T6` — Caché incremental de rasgos entre sesiones

**Depends on:** `E2-T5` · **Priority:** p1 — metadata for scope cuts, not a running order

Volver a analizar una carpeta que no cambió no debe repetir el trabajo. Es además la primera
prueba real de que las migraciones solo avanzan: la tabla nueva llega como migración `0002` sobre bases de
datos que ya tienen datos.

**`migrations/0002_feature_cache.sql`:**

```sql
CREATE TABLE feature_cache (
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ns INTEGER NOT NULL,
  features_version TEXT NOT NULL,
  eyes INTEGER NOT NULL CHECK (eyes IN (0, 1)),
  features_json TEXT NOT NULL,
  PRIMARY KEY (path, size_bytes, mtime_ns, features_version, eyes)
);
```

**`store.py` (edita):** agrega `"feature_cache"` a `EXPECTED_TABLES`.

**`analyze.py` (edita):** antes de enviar una foto al pool, busca en `feature_cache` por
`(ruta, size_bytes, mtime_ns, FEATURES_VERSION, eyes)`. Con acierto, usa el JSON guardado como si fuera
el resultado del extractor (cuenta en `cached`); sin acierto, la envía al pool (cuenta en `computed`) y,
al llegar el resultado, lo guarda en la caché. `job_done` y `job_status` informan `computed` y `cached`
reales. Una foto que falló nunca entra en la caché.

**Prueba de migración:** crea una base con solo la migración `0001` (apunta `MIGRATIONS_DIR` a una carpeta
temporal que contiene solo ese archivo con `monkeypatch`), inserta una sesión y una foto, restaura el
directorio real, vuelve a abrir el `Store` y comprueba que existen `0002` y `feature_cache` y que la foto
sigue ahí.

**Files**
- `engine/mejores_engine/migrations/0002_feature_cache.sql`
- `engine/mejores_engine/analyze.py`
- `engine/mejores_engine/store.py`
- `engine/tests/test_cache.py`

**Acceptance**

Copied from this task's `acceptance` array in `tasks.json` — identical after the emphasis normalization. Each one is decidable by a command below, on this machine, during the build.

1. **WHEN** `analyze` runs a second time over unchanged files **THE SYSTEM SHALL** report `computed` 0 and `cached` equal to the photo count.
2. **WHEN** one file's modification time changes **THE SYSTEM SHALL** recompute exactly that file and serve the others from the cache.
3. **WHEN** `FEATURES_VERSION` changes, or the `eyes` flag differs, **THE SYSTEM SHALL** treat every entry as a miss.
4. **WHEN** migration `0002` applies to a database that is at `0001` and holds a session and a photo **THE SYSTEM SHALL** keep both rows and create `feature_cache`.
5. **WHEN** a photo fails to decode **THE SYSTEM SHALL** not write a cache entry for it.

**Verify** — every command, in order, run from the project root. Each one exits 0 when this task is correct; the last one exiting 0 is what makes the task done.

```bash
pnpm test:engine
pnpm lint:engine
pnpm typecheck:engine
test -f engine/mejores_engine/migrations/0002_feature_cache.sql
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T6: Caché incremental de rasgos entre sesiones"
git tag step-12-cache
```

Run both after the last `Verify` command exits 0, before starting the next task. The tag is this task's rollback target and the thing the build's final gate counts — if the next task goes wrong, `git reset --hard` to *this* tag rather than debugging forward. Never invent the tag: copy the `checkpoint` field. If it is missing from `tasks.json`, stop and report.

---

## Epic acceptance

The epic is done when every task is `done` **and**:

1. **WHEN** the pipeline scan, analyze, bursts and select runs on six synthetic photos with network sockets disabled **THE SYSTEM SHALL** select the sharp frame of each burst.
2. **WHEN** `analyze` runs a second time over unchanged files **THE SYSTEM SHALL** compute zero of them.

```bash
pnpm test:engine
pnpm lint:engine
pnpm typecheck:engine
```

Run from the project root. Both criteria must be decidable by these commands.

## Pitfalls

- **Process pool on Windows uses `spawn`** — anything a worker imports at module level runs again in every worker; keep `features.py` import-light and put MediaPipe behind a function.
- **Do not compare sharpness across bursts** — the Laplacian variance depends on the scene; only the ratio to the burst's best is meaningful.
- **Real RAW is never in the test suite** — the RAW paths are covered by fakes; real files are exercised by `scripts/bench_raw.py` in the manual gate.

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
