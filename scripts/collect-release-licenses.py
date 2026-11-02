"""Collect target-specific license texts before bundling. Fail closed on missing texts."""
import argparse
import json
from pathlib import Path
import shutil
import socket
socket.setdefaulttimeout(20)
import subprocess
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def metadata(manifest, target):
    return json.loads(subprocess.check_output([
        'cargo', 'metadata', '--locked', '--format-version', '1',
        '--filter-platform', target, '--manifest-path', str(manifest)
    ], cwd=ROOT))['packages']

def license_files(base):
    for item in base.rglob('*'):
        if item.is_file() and (item.name.lower().startswith(('license', 'licence', 'copying', 'copyright', 'unlicense', 'ofl')) or 'notice' in item.name.lower()):
            yield item

def fetch_exact_license(package, base, dest):
    vcs_path = base / '.cargo_vcs_info.json'
    if not vcs_path.exists():
        return False
    vcs = json.loads(vcs_path.read_text(encoding='utf-8'))
    repo = (package.get('repository') or '').removesuffix('.git').rstrip('/')
    if not repo.startswith('https://github.com/'):
        return False
    sha = vcs.get('git', {}).get('sha1')
    if not sha:
        return False
    subdir = vcs.get('path_in_vcs', '')
    prefixes = list(dict.fromkeys([subdir, *[str(p) for p in Path(subdir).parents], '']))
    for prefix in prefixes:
        prefix = '' if prefix == '.' else prefix.replace('\\','/').strip('/')
        for name in ['LICENSE', 'LICENSE_MIT', 'LICENSE_APACHE', 'LICENSE-MIT', 'LICENSE-APACHE', 'LICENSE.txt', 'LICENSE.md', 'LICENCE', 'LICENCE.md']:
            suffix = '/'.join(filter(None, [prefix, name]))
            url = repo.replace('https://github.com/', 'https://raw.githubusercontent.com/') + f'/{sha}/{suffix}'
            try:
                with urllib.request.urlopen(url, timeout=15) as response:
                    data = response.read(1024 * 1024)
                dest.mkdir(parents=True, exist_ok=True)
                (dest / name).write_bytes(data)
                (dest / 'SOURCE.txt').write_text(url + '\n', encoding='utf-8')
                return True
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise
    return False

def fetch_npm_license(info, dest):
    from urllib.parse import quote
    url = 'https://registry.npmjs.org/' + quote(info['name'], safe='') + '/' + info['version']
    with urllib.request.urlopen(url, timeout=20) as response:
        published = json.load(response)
    repository = published.get('repository') or info.get('repository') or {}
    repo = repository.get('url', '') if isinstance(repository, dict) else repository
    repo = repo.removeprefix('git+').removesuffix('.git').replace('git://github.com/', 'https://github.com/').replace('ssh://git@github.com/', 'https://github.com/')
    if not repo.startswith('https://github.com/'):
        return False
    refs = [published.get('gitHead')] if published.get('gitHead') else ['v'+info['version'], info['version']]
    for ref in refs:
        for name in ['LICENSE', 'UNLICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENSE-MIT', 'UNLICENSE.md', 'license']:
            source = repo.replace('https://github.com/', 'https://raw.githubusercontent.com/') + '/' + ref + '/' + name
            try:
                with urllib.request.urlopen(source, timeout=15) as response:
                    data = response.read(1024*1024)
                dest.mkdir(parents=True, exist_ok=True)
                (dest/name).write_bytes(data)
                (dest/'SOURCE.txt').write_text(source+'\nVersion provenance: '+url+'\n', encoding='utf-8')
                return True
            except urllib.error.HTTPError as error:
                if error.code != 404: raise
    return False

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', required=True)
    args = parser.parse_args()
    packages = {}
    for manifest in [ROOT / 'src-tauri/Cargo.toml']:
        for package in metadata(manifest, args.target):
            if package.get('source'):
                packages[package['id']] = package
    rows = []
    missing = []
    for package in packages.values():
        print('Rust notice:', package['name'], package['version'], flush=True)
        base = Path(package['manifest_path']).parent
        dest = ROOT / 'release-legal/third-party-licenses' / f"rust-{package['name']}-{package['version']}"
        for source in license_files(base):
            target = dest / source.relative_to(base)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        if not dest.exists() or not any(license_files(dest)):
            if not fetch_exact_license(package, base, dest):
                license_name = package.get('license') or ''
                if 'Apache-2.0' in license_name:
                    # Old dual-licensed crates sometimes omit a LICENSE file entirely.
                    # Choose their declared Apache branch, retain complete published source/notices.
                    dest.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(ROOT/'LICENSE', dest/'LICENSE-APACHE-2.0')
                    shutil.copytree(base, ROOT/'release-legal/third-party-sources'/dest.name, dirs_exist_ok=True)
                    (dest/'SOURCE.txt').write_text('Published crate '+package['name']+' '+package['version']+' declares '+license_name+'. Apache-2.0 branch selected; complete published source and declarations included.\n', encoding='utf-8')
                elif package['name']=='convert_case' and package['version']=='0.4.0':
                    # This published version has no license text at its source commit.
                    # Retain its entire published source and the upstream author's pinned MIT text.
                    source='https://api.github.com/repos/rutrum/convert-case/git/blobs/c0ce8f0a3b7351d84a1420d11a8c045d333870a3'
                    import base64
                    with urllib.request.urlopen(source, timeout=20) as response: text=json.load(response)
                    dest.mkdir(parents=True, exist_ok=True)
                    (dest/'LICENSE').write_bytes(base64.b64decode(text['content']))
                    (dest/'SOURCE.txt').write_text('Published 0.4.0 declares MIT but omits the text. Upstream MIT text pinned by Git blob: '+source+'; complete published source retained.\n', encoding='utf-8')
                    shutil.copytree(base, ROOT/'release-legal/third-party-sources'/dest.name, dirs_exist_ok=True)
                else:
                    missing.append(package['name'])
        if 'MPL' in (package.get('license') or ''):
            shutil.copytree(base, ROOT / 'release-legal/third-party-sources' / dest.name, dirs_exist_ok=True)
        rows.append(('Rust', package['name'], package['version'], package.get('license') or 'See texts', dest.relative_to(ROOT / 'release-legal').as_posix()))
    # Follow installed production/peer dependencies through pnpm's real package graph.
    def resolve_package(base, name):
        for parent in [base, *base.parents]:
            candidate = parent / 'node_modules' / name / 'package.json'
            if candidate.is_file():
                return candidate.resolve().parent
        return None
    info = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    pending = [(ROOT, name) for name in info.get('dependencies', {})]
    seen = set()
    while pending:
        parent, name = pending.pop()
        base = resolve_package(parent, name)
        if base is None:
            continue  # Optional/peer packages absent on this target are not shipped.
        if base in seen:
            continue
        seen.add(base)
        info = json.loads((base / 'package.json').read_text(encoding='utf-8'))
        print('npm notice:', info['name'], info['version'], flush=True)
        for key in ['dependencies', 'optionalDependencies', 'peerDependencies']:
            pending.extend((base, dep) for dep in info.get(key, {}))
        dest = ROOT / 'release-legal/third-party-licenses' / ('npm-' + info['name'].replace('@', '').replace('/', '_') + '-' + info['version'])
        for source in license_files(base):
            target = dest / source.relative_to(base)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        if not dest.exists() or not any(license_files(dest)):
            if not fetch_npm_license(info, dest):
                if info.get('license') == 'MIT':
                    # Published manifest explicitly declares MIT but no separate upstream text exists.
                    # Preserve its original notices/authorship verbatim in the complete package source.
                    # Supply standard MIT terms without inventing copyright names or years.
                    source = ROOT/'release-legal/third-party-sources'/dest.name
                    shutil.copytree(base, source, dirs_exist_ok=True, ignore=shutil.ignore_patterns('node_modules'))
                    template=(ROOT/'node_modules/react/LICENSE').read_text(encoding='utf-8')
                    terms=template[template.index('Permission is hereby granted'):]
                    dest.mkdir(parents=True, exist_ok=True)
                    (dest/'LICENSE-MIT.txt').write_text('Published '+info['name']+' '+info['version']+' declares MIT in package.json but omits a separate license text. Original published package, manifest, author and any copyright notices are retained in third-party-sources/'+dest.name+'. No new copyright holder is inferred. Standard MIT terms follow.\n\n'+terms, encoding='utf-8')
                    (dest/'SOURCE.txt').write_text('Exact installed published package '+info['name']+' '+info['version']+' is included in third-party-sources; package.json retains its MIT declaration and author metadata.\n', encoding='utf-8')
                else:
                    missing.append(info['name'])
        rows.append(('npm', info['name'], info['version'], str(info.get('license', 'See texts')), dest.relative_to(ROOT / 'release-legal').as_posix()))
    if missing:
        raise SystemExit('Missing original license texts: ' + ', '.join(sorted(missing)))
    text = '# Third-party notices\n\n'
    text += f'Target: `{args.target}`. Includes target Cargo graphs and installed production npm dependency/peer packages (a conservative superset of bundled JavaScript).\n\n'
    text += 'Components retain their original licenses. MarkdownShelf does not relicense them. Original texts are in third-party-licenses/. Applicable MPL sources and complete published sources for packages that omit a license text are in third-party-sources/, included in the installer. Such omissions and supplied standard terms are identified in each SOURCE/license note; authorship is never inferred. For alternative licenses, use a supplied permitted license branch.\n\n'
    text += '| Ecosystem | Component | Version | Declared license | Texts |\n| --- | --- | --- | --- | --- |\n'
    for kind, name, version, license_name, path in sorted(rows):
        license_name = license_name.replace('|', ' OR ')
        text += f'| {kind} | {name} | {version} | {license_name} | [{path}]({path}) |\n'
    (ROOT / 'release-legal/THIRD_PARTY_NOTICES.md').write_text(text, encoding='utf-8')
    print(f'Collected {len(rows)} component notices for {args.target}')

if __name__ == '__main__':
    main()
