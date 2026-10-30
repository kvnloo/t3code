#!/usr/bin/env python3
"""Render the P0 example only with an immutable OCI image digest.

No kubectl calls, deployment, credentials, environment modification or
network access. This is not a worker broker.
"""

import argparse
from pathlib import Path
import os
import re
import tempfile

PLACEHOLDER = "REPLACE_WITH_PINNED_IMAGE_DIGEST"
# Deliberately conservative; reject whitespace, tags without digests,
# shell metacharacters and YAML injection. A registry/namespace is required.
IMAGE = re.compile(r"(?=.{1,255}$)[a-z0-9][a-z0-9._:/-]*/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}\Z")


def render(source: str, image: str) -> str:
    if not IMAGE.fullmatch(image) or ".." in image or "//" in image:
        raise ValueError("image must be an OCI repository@sha256:<64 lowercase hex> reference")
    if source.count(PLACEHOLDER) != 1:
        raise ValueError("expected exactly one image placeholder")
    return source.replace(PLACEHOLDER, image)


def write_new_output(path: Path, content: str) -> None:
    """Publish complete private YAML without following or replacing an output path.

    Stage in the same directory, sync the complete file, then hard-link with
    exclusive-create semantics. A failed link leaves the existing path intact.
    """
    staged = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False,
        ) as handle:
            staged = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(staged, path)
    finally:
        if staged is not None:
            staged.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="pushed image ref pinned at sha256 digest")
    parser.add_argument("--output", required=True, type=Path, help="rendered YAML path outside source")
    args = parser.parse_args()
    source = Path(__file__).with_name("k3s.yaml")
    if args.output.resolve() == source.resolve():
        parser.error("refusing to overwrite tracked template")
    try:
        output = render(source.read_text(encoding="utf-8"), args.image)
    except ValueError as error:
        parser.error(str(error))
    try:
        write_new_output(args.output, output)
    except OSError as error:
        parser.error(f"refusing to replace output or could not create private file: {error.strerror}")


if __name__ == "__main__":
    main()
