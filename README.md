# Mejores Tomas

Aplicación de escritorio para Windows que elige las mejores tomas de una ráfaga de fotos (JPG, PNG y RAW).
Todo se analiza en tu equipo: sin red, sin cuentas y sin IA en la nube. **Tus originales nunca se modifican.**

## Qué hace

- **Agrupa ráfagas** y propone la toma más nítida y mejor expuesta de cada una (con detección de ojos abiertos).
- **Revisión rápida** con visor, comparación, cuadrícula, marcas y atajos de teclado; tu avance se guarda en sesiones.
- **Correcciones no destructivas**: luz, color, curvas, mezcla de color, detalle, viñeta, LUT (con galería de miniaturas), enderezado y recorte con proporciones. Corrección automática por foto o por ráfaga.
- **Exporta** a otra carpeta (formato, tamaño y calidad a elegir) y, si quieres, **ordena la carpeta** moviendo las no elegidas a una subcarpeta (siempre se puede deshacer).

## Instalar

1. Ve a la página de [Releases](../../releases/latest) y descarga `Mejores Tomas_x.y.z_x64-setup.exe`.
2. Ejecútalo. Se instala solo para tu usuario, sin permisos de administrador.
3. **Aviso de Windows**: como el instalador no está firmado con un certificado de pago, SmartScreen puede mostrar «Windows protegió tu PC». Pulsa **Más información → Ejecutar de todos modos**.

Requisitos: Windows 10 u 11 de 64 bits.

## Privacidad

El motor de análisis no abre ninguna conexión de red y nunca escribe en las carpetas de tus fotos, salvo la función explícita «Ordenar carpeta» (solo mueve, nunca borra, y se puede deshacer). Los datos de la app (sesiones, correcciones, LUT) se guardan en la carpeta de datos de tu usuario.

## Compilar desde el código

Necesitas Node (ver `.nvmrc`), pnpm, Python 3.12 con [uv](https://docs.astral.sh/uv/) y Rust (ver `rust-toolchain.toml`).

```bash
pnpm install
uv sync --directory engine
pnpm dev            # ventana de la app en modo desarrollo
pnpm build:sidecar  # congela el motor de análisis
pnpm build:app      # genera el instalador en src-tauri/target/release/bundle/nsis/
```

La compuerta de calidad completa:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm lint:engine && pnpm typecheck:engine && pnpm test:engine && pnpm test:rust
```

Las convenciones del proyecto están en `CLAUDE.md`.

## Licencia

[GNU GPL v3](LICENSE). Avisos de componentes de terceros en [NOTICE.md](NOTICE.md).
