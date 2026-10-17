"""Synthetic R&D site replay. MockTransport only; does not fetch loopback or public websites."""
import html
import json
from pathlib import Path

import httpx

BASE = 'https://owned-seo.example/'
FIXTURE = json.loads((Path(__file__).parent / 'fixtures' / 'rea_owned_site.json').read_text(encoding='utf-8'))


async def allow_fixture(url):
    assert url.startswith(BASE), 'Only the synthetic test origin is admitted'


def response_for(request, hits):
    path = request.url.path
    hits.append(path)
    if path == '/robots.txt':
        return httpx.Response(200, text=f'User-agent: *\nDisallow: /blocked/\nSitemap: {BASE}sitemap.xml\n')
    if path == '/sitemap.xml':
        return httpx.Response(200, headers={'content-type': 'application/xml'},
                              text=f'<urlset><url><loc>{BASE}sitemap-only/</loc></url></urlset>')
    if path in FIXTURE['redirects']:
        status, target = FIXTURE['redirects'][path]
        return httpx.Response(status, headers={'location': target})
    if path not in FIXTURE['pages']:
        return httpx.Response(404, headers={'content-type': 'text/html'}, text='<title>Not found</title>')
    page = FIXTURE['pages'][path]
    parts = ['<!doctype html><html lang="en"><head><meta charset="utf-8">']
    if page['title']:
        parts.append('<title>' + html.escape(page['title']) + '</title>')
    if page.get('description') is not None:
        parts.append('<meta name="description" content="' + html.escape(page['description'], quote=True) + '">')
    canonical = page.get('canonical', path)
    if canonical:
        parts.append('<link rel="canonical" href="' + BASE.rstrip('/') + canonical + '">')
    if page.get('robots'):
        parts.append('<meta name="robots" content="' + page['robots'] + '">')
    parts.append('</head><body>')
    if page.get('h1', True):
        parts.append('<h1>' + html.escape(page['title']) + '</h1>')
    parts.append('<p>' + html.escape(page.get('body', 'Owned synthetic SEO fixture.')) + '</p>')
    for target, anchor in page['links']:
        parts.append('<a href="' + html.escape(target, quote=True) + '">' + html.escape(anchor) + '</a>')
    if path == '/':
        parts.append('<footer><a href="/catalog/" rel="nofollow">Footer catalogue nofollow</a></footer>')
    parts.append('</body></html>')
    return httpx.Response(200, headers={'content-type': 'text/html'}, text=''.join(parts))
