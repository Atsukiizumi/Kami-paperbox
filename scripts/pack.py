#!/usr/bin/env python3
"""Pack the project tree into a tar.gz.

Keeps almost everything. Only drops:
  - node_modules
  - .git (so a local clone / GitHub repo is not overwritten)
  - local secrets (kami.config.json, .env, .data)
  - the output archive itself
"""

from __future__ import annotations

import argparse
import io
import tarfile
from collections import Counter
from pathlib import Path

SKIP_DIR_NAMES = {
    "node_modules",
    ".data",
    ".git",
}

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


def skipped_reason(path: Path, root: Path, out: Path) -> str | None:
    try:
        rel = path.relative_to(root)
    except ValueError:
        return "outside-root"
    try:
        if path.resolve() == out.resolve():
            return "output-archive"
    except OSError:
        pass
    for part in rel.parts:
        if part in SKIP_DIR_NAMES:
            return part
        if part in SKIP_FILE_NAMES:
            return part
    return None


def iter_files(root: Path, out: Path):
    for path in root.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        if skipped_reason(path, root, out):
            continue
        yield path


def iter_dirs(root: Path, out: Path):
    seen = {root}
    for path in root.rglob("*"):
        if path.is_symlink() or not path.is_dir():
            continue
        if skipped_reason(path, root, out):
            continue
        if path in seen:
            continue
        seen.add(path)
        yield path


def pack(root: Path, out: Path, folder: str) -> tuple[int, int, Counter]:
    out = out.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    files = sorted(iter_files(root, out), key=lambda p: p.relative_to(root).as_posix())
    dirs = sorted(iter_dirs(root, out), key=lambda p: p.relative_to(root).as_posix())
    reasons: Counter = Counter()
    for path in root.rglob("*"):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            continue
        reason = skipped_reason(path, root, out)
        if reason:
            reasons[reason] += 1

    manifest_lines = [
        "# Kami Paperbox pack manifest",
        f"# files: {len(files)}",
        f"# dirs: {len(dirs)}",
        "# skipped: " + ", ".join(f"{k}={v}" for k, v in sorted(reasons.items())) if reasons else "# skipped: (none)",
        "",
        *[path.relative_to(root).as_posix() for path in files],
        "",
    ]

    count = 0
    with tarfile.open(out, "w:gz") as tar:
        for path in dirs:
            info = tarfile.TarInfo(name=f"{folder}/{path.relative_to(root).as_posix()}/")
            info.type = tarfile.DIRTYPE
            info.mode = 0o755
            tar.addfile(info)
        for path in files:
            tar.add(path, arcname=f"{folder}/{path.relative_to(root).as_posix()}")
            count += 1
        manifest = "\n".join(manifest_lines).encode("utf-8")
        info = tarfile.TarInfo(name=f"{folder}/PACK-MANIFEST.txt")
        info.size = len(manifest)
        info.mode = 0o644
        tar.addfile(info, fileobj=io.BytesIO(manifest))
        count += 1
    return count, len(dirs), reasons


def main() -> None:
    root = project_root()
    parser = argparse.ArgumentParser(description="打包本项目全部文件（排除 node_modules 与本机秘密）")
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
    n, dirs, reasons = pack(root, out, args.folder)
    size = out.stat().st_size
    skip = ", ".join(f"{k}={v}" for k, v in sorted(reasons.items())) or "none"
    print(f"wrote {out} ({n} files, {dirs} dirs, {size} bytes)")
    print(f"skipped: {skip}")


if __name__ == "__main__":
    main()
