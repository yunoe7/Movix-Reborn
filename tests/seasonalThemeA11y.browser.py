"""LOT 0 — point d'entrée Python du scénario accessibilité/mobile/tablette/TV.

Exécution :
    python tests/seasonalThemeA11y.browser.py

Prérequis : Node 20+, playwright-core et esbuild déjà présents dans node_modules,
Chrome local. Python Playwright n'est pas nécessaire : ce wrapper lance le
pilote Node tests/seasonalThemeA11y.runner.mjs, qui produit REPORT.md,
report.json, les captures et la trace dans SEASONAL_THEME_A11Y_DIR (ou un
dossier temporaire hors du dépôt).
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RUNNER = REPO / "tests" / "seasonalThemeA11y.runner.mjs"


def main() -> int:
    override = os.environ.get("SEASONAL_THEME_A11Y_DIR")
    artifact_dir = Path(override).resolve() if override else Path(tempfile.gettempdir()) / "opencode" / "seasonal-theme-e2e" / "a11y"
    artifact_dir.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["SEASONAL_THEME_A11Y_DIR"] = str(artifact_dir)
    command = ["node", str(RUNNER)]

    print(f"[seasonal-a11y] artefacts: {artifact_dir}")
    print(f"[seasonal-a11y] commande: node {RUNNER.relative_to(REPO)}")
    completed = subprocess.run(command, cwd=REPO, env=env, check=False)
    if (artifact_dir / "REPORT.md").exists():
        print(f"[seasonal-a11y] rapport: {artifact_dir / 'REPORT.md'}")
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
