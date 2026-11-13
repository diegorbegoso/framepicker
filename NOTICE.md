# Avisos de terceros

Mejores Tomas se publica bajo la licencia GNU GPL v3 (ver `LICENSE`). Incluye o usa los siguientes componentes de terceros, cada uno bajo su propia licencia:

| Componente                                                                          | Uso                                           | Licencia                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- |
| Modelo `face_landmarker.task` de Google MediaPipe (`engine/mejores_engine/assets/`) | Detectar si los ojos están abiertos, en local | Apache-2.0                                |
| MediaPipe                                                                           | Ejecutar ese modelo                           | Apache-2.0                                |
| OpenCV (`opencv-contrib-python`)                                                    | Análisis y procesado de imagen                | Apache-2.0                                |
| NumPy                                                                               | Cálculo numérico                              | BSD-3-Clause                              |
| Pillow                                                                              | Lectura y escritura de imágenes               | MIT-CMU (HPND)                            |
| rawpy / LibRaw                                                                      | Lectura de archivos RAW                       | MIT (rawpy); LGPL-2.1 o CDDL-1.0 (LibRaw) |
| Tauri                                                                               | Ventana de escritorio                         | MIT o Apache-2.0                          |
| React, Vite, zod                                                                    | Interfaz                                      | MIT                                       |

El modelo `face_landmarker.task` se descargó de
`https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
(ver `scripts/fetch_model.py`, que comprueba su tamaño y SHA-256). El resto de dependencias, con sus versiones exactas, están en `pnpm-lock.yaml`, `engine/uv.lock` y `src-tauri/Cargo.lock`.

Mejores Tomas analiza todo en tu equipo: no abre conexiones de red ni envía tus fotos a ningún sitio.
