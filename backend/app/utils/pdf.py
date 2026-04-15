from __future__ import annotations

import shutil
import subprocess
import tempfile

from app.core.logger import logger


def html_to_pdf_bytes(*, html: str) -> bytes:
    """Convert HTML to PDF.

    Engine: wkhtmltopdf (external binary).
    """
    return _wkhtmltopdf_bytes(html)


def _wkhtmltopdf_bytes(html: str) -> bytes:
    exe = shutil.which("wkhtmltopdf")
    if not exe:
        raise RuntimeError(
            "PDF generation is not available on this server. "
            "Install wkhtmltopdf and ensure it is on PATH."
        )
    try:
        with tempfile.TemporaryDirectory(prefix="wkhtmltopdf_") as td:
            in_path = f"{td}/in.html"
            out_path = f"{td}/out.pdf"
            with open(in_path, "w", encoding="utf-8") as f:
                f.write(html)
            # Minimal args: quiet + local file input → PDF file output
            proc = subprocess.run(
                [exe, "--quiet", in_path, out_path],
                capture_output=True,
                text=True,
                check=False,
            )
            if proc.returncode != 0:
                msg = (proc.stderr or proc.stdout or "").strip() or f"wkhtmltopdf exited {proc.returncode}"
                raise RuntimeError(f"wkhtmltopdf failed: {msg}")
            with open(out_path, "rb") as f:
                return f.read()
    except RuntimeError:
        raise
    except Exception as e:  # pragma: no cover
        logger.exception("wkhtmltopdf failed: %s", e)
        raise RuntimeError("PDF generation failed.") from e

