"""Freeze the analysis engine with PyInstaller (one folder, console) for the Windows installer.

Usage (from the project root):
    pnpm build:sidecar

Exit 1 when engine/dist/mejores-engine/mejores-engine.exe does not exist afterwards.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1] / "engine"
EXE = ENGINE / "dist" / "mejores-engine" / "mejores-engine.exe"


def main() -> int:
    # PyInstaller resolves relative --add-data sources against --specpath (engine/build), so every
    # source path is passed absolute.
    package = ENGINE / "mejores_engine"
    cmd = [
        "uv", "run", "--frozen", "--directory", str(ENGINE),
        "pyinstaller", "--noconfirm", "--clean", "--onedir", "--console",
        "--name", "mejores-engine",
        "--distpath", "dist", "--workpath", "build", "--specpath", "build",
        "--paths", ".",
        "--add-data", f"{package / 'migrations'};mejores_engine/migrations",
        "--add-data", f"{package / 'assets'};mejores_engine/assets",
        "--collect-all", "mediapipe",
        "--collect-all", "rawpy",
        str(package / "__main__.py"),
    ]  # fmt: skip
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        print(f"pyinstaller failed with exit code {result.returncode}", file=sys.stderr)
        return 1
    if not EXE.is_file():
        print(f"missing after the build: {EXE}", file=sys.stderr)
        return 1
    print(f"engine frozen: {EXE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
