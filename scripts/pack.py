#!/usr/bin/env python3
"""Pack every project file except node_modules into a tar.gz."""

from __future__ import annotations

import argparse
import tarfile
from pathlib import Path

SKIP_DIR_NAMES = {"node_modules", ".data", ".git", "artifacts", ".output", ".vercel", ".nitro"}
SKIP_FILE_NAMES = {
    "kami-paperbox.tar.gz",
    "kami-paperbox.tar",
    "kami-paperbox.tgz",
    "kami-paperbox.zip",
    "kami.config.json",
    ".env",
    ".env.local",
}


def project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def should_skip(path: Path, root: Path, out: Path) -> bool:
    try:
        rel = path.relative_to(root)
    except ValueError:
        return True
    if path.resolve() == out.resolve():
        return True
    for part in rel.parts:
        if part in SKIP_DIR_NAMES:
            return True
        if part in SKIP_FILE_NAMES:
            return True
    return False


def iter_files(root: Path, out: Path):
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        if should_skip(path, root, out):
            continue
        yield path


def pack(root: Path, out: Path, folder: str) -> int:
    out = out.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with tarfile.open(out, "w:gz") as tar:
        for path in iter_files(root, out):
            tar.add(path, arcname=f"{folder}/{path.relative_to(root).as_posix()}")
            count += 1
    return count


def main() -> None:
    root = project_root()
    parser = argparse.ArgumentParser(description="打包本项目全部文件（排除 node_modules）")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=root / "kami-paperbox.tar.gz",
        help="输出路径，默认项目根目录下的 kami-paperbox.tar.gz",
    )
    parser.add_argument(
        "--folder",
        default="kami-paperbox",
        help="压缩包内的根文件夹名",
    )
    args = parser.parse_args()
    out = args.output.expanduser()
    if not out.is_absolute():
        out = Path.cwd() / out
    n = pack(root, out, args.folder)
    size = out.stat().st_size
    print(f"wrote {out} ({n} files, {size} bytes)")


if __name__ == "__main__":
    main()
