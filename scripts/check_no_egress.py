#!/usr/bin/env python3
"""Static production-asset no-egress gate; runtime Playwright capture is separate."""
import argparse
from html.parser import HTMLParser
from pathlib import Path
import re
from urllib.parse import urlsplit, unquote

class Resources(HTMLParser):
    def __init__(self):
        super().__init__(); self.urls=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        for key in ('src','poster'):
            if key in a:self.urls.append(a[key])
        if tag=='link' and 'href' in a:self.urls.append(a['href'])

def check_dist(root):
    root=Path(root).resolve()
    if not(root/'index.html').is_file():raise ValueError(f'Production index missing: {root}')
    resources=Resources();resources.feed((root/'index.html').read_text())
    styles=list(root.rglob('*.css'));combined='\n'.join(p.read_text() for p in styles)
    pending=[(u,root) for u in resources.urls]
    for p in styles:
        text=p.read_text()
        pending.extend((m.group(1).strip().strip('\"\''),p.parent) for m in re.finditer(r'url\(([^)]+)\)',text))
        pending.extend((m.group(1),p.parent) for m in re.finditer(r'@import\s+[\"\']([^\"\']+)',text))
    checked=set()
    for url,base in pending:
        if not url or url.startswith(('#','data:')):continue
        parsed=urlsplit(url)
        if parsed.scheme or parsed.netloc or url.startswith('//'):raise ValueError(f'External resource is forbidden: {url}')
        path=(root/parsed.path.lstrip('/') if parsed.path.startswith('/') else base/unquote(parsed.path)).resolve()
        if not path.is_relative_to(root):raise ValueError(f'Asset escapes production root: {url}')
        if not path.is_file():raise ValueError(f'Missing local resource: {url}')
        checked.add(path)
    for family in ('IBM Plex Sans','IBM Plex Mono'):
        if family not in combined:raise ValueError(f'Self-hosted font faces missing: {family}')
    fonts=[p for p in checked if p.suffix in ('.woff','.woff2')]
    if not fonts:raise ValueError('No self-hosted font assets found')
    return {'checked_resources':len(checked),'self_hosted_fonts':len(fonts),'external_resources':0}

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--dist',type=Path,default=Path('frontend/dist'))
    args=parser.parse_args(argv)
    try:
        result=check_dist(args.dist)
    except (ValueError,OSError) as e:
        parser.exit(1,f'No-egress build check failed: {e}\n')
    print('Static no-egress build check passed:',result)
    print('Runtime request capture is a separate acceptance check.')
    return 0
if __name__=='__main__':raise SystemExit(main())
