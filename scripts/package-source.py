"""Build the public source archive. Exclude credentials, caches and browser data."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
allowed_roots = ['src', 'tests', 'scripts', 'docs', '.github', 'public/filings']
files = [p for folder in allowed_roots if (root / folder).exists() for p in (root / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
files += [root / name for name in ['package.json', 'package-lock.json', 'requirements-collector.txt', 'tsconfig.json', 'next.config.ts', 'next-env.d.ts', 'postcss.config.mjs', '.gitignore', '.env.example', 'README.md'] if (root / name).exists()]
files += [root / 'public' / 'favicon.svg']
(root / 'public').mkdir(exist_ok=True)
with ZipFile(root / 'public' / 'source.zip', 'w', ZIP_DEFLATED) as archive:
    for file in sorted(files):
        archive.write(file, 'value-finder/' + file.relative_to(root).as_posix())
print(f'Packaged {len(files)} source files.')
