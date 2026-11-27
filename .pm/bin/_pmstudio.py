"""Select Vitest inputs for the Studio step of a unit's fast check."""
import os
import pathlib
import re
import stat

SOURCE = "studio/src/"
SOURCE_SUFFIXES = (".ts", ".tsx", ".json", ".css")
TEST_SUFFIXES = (".test.ts", ".test.tsx")
# Treat source text as evidence of a read even when the specifier is in a string example.
FILE_MODULE = re.compile(r"""(['"])(?:node:)?fs(?:/promises)?\1""")
GLOB = re.compile(r"\bimport\s*\.\s*meta\s*\.\s*glob\b")


def regular_file(path):
    return stat.S_ISREG(path.lstat().st_mode)


def related_path(path):
    return path.startswith(SOURCE) and path.endswith(SOURCE_SUFFIXES) and not any(c in path for c in "?#\\")


def walk_error(error):
    raise error


def extra_related_paths(co):
    """Find test inputs for reads outside the import graph, including reads by imported test helpers."""
    selected = []
    for directory, folders, files in os.walk(co / SOURCE, onerror=walk_error):
        folder = pathlib.Path(directory)
        for name in folders:
            if (folder / name).is_symlink():
                raise OSError(f"cannot scan symlink {folder / name}")
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            file = folder / name
            if not regular_file(file):
                raise OSError(f"cannot scan non-regular file {file}")
            path = file.relative_to(co).as_posix()
            source = file.read_text(encoding="utf-8")
            if FILE_MODULE.search(source) or (
                (path.endswith(TEST_SUFFIXES) or path.startswith(SOURCE + "test/")) and GLOB.search(source)
            ):
                if not related_path(path):
                    raise OSError(f"cannot pass {path} to Vitest related")
                selected.append(path)
    return sorted(selected)


def unit_selection(co, kind, paths):
    """Describe the suite to run. The changed inputs are repository-relative paths from the unit diff."""
    if kind != "unit":
        return dict(mode="full", reason="whole check or explicit check scope")
    if not paths:
        return dict(mode="full", reason="no changed source paths")
    if (co / SOURCE).is_symlink():
        return dict(mode="full", reason="Studio source is a symlink")
    for path in paths:
        if not related_path(path):
            return dict(mode="full", reason=f"outside the related source paths: {path}")
        if path == SOURCE + "test/setup.ts":
            return dict(mode="full", reason=f"shared test setup changed: {path}")
        try:
            regular = regular_file(co / path)
        except OSError:
            regular = False
        if not regular:
            return dict(mode="full", reason=f"changed path is missing or is not a regular file: {path}")
    try:
        extra = extra_related_paths(co)
    except (OSError, UnicodeError) as error:
        return dict(mode="full", reason=f"cannot scan Studio test inputs: {error}")
    return dict(mode="related", paths=paths, extra_paths=extra)


def related_command(selection):
    paths = sorted(set(selection["paths"]) | set(selection["extra_paths"]))
    return ["bun", "run", "vitest", "related", "--run", "--fsModuleCache=false",
            *["./" + path.removeprefix("studio/") for path in paths]]
