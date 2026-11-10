import multiprocessing
import sys

from mejores_engine.app import main

if __name__ == "__main__":
    # Needed by PyInstaller builds; the guard keeps spawned pool workers from re-running main().
    multiprocessing.freeze_support()
    sys.exit(main())
