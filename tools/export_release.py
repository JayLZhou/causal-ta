"""打包可独立运行的源码；显式排除学习会话和缓存。"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from causal_ta import __version__

DEST = ROOT / "dist" / f"causal-ta-{__version__}.zip"
FILES = ["README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md", ".gitignore", "pyproject.toml", "MANIFEST.in"]
DIRECTORIES = ["causal_ta", "tests", "docs", "tools", ".github"]
SUFFIXES = {".py", ".json", ".html", ".css", ".js", ".md", ".png", ".yml"}


def main():
    DEST.parent.mkdir(exist_ok=True)
    paths = [ROOT / name for name in FILES]
    for directory in DIRECTORIES:
        paths.extend(p for p in (ROOT / directory).rglob("*")
                     if p.is_file() and not p.is_symlink()
                     and "__pycache__" not in p.parts and p.suffix in SUFFIXES)
    with ZipFile(DEST, "w", ZIP_DEFLATED) as archive:
        for path in sorted(paths):
            archive.write(path, "causal-ta/" + path.relative_to(ROOT).as_posix())
    print(DEST)


if __name__ == "__main__":
    main()
