import asyncio

import httpx
from fastapi.testclient import TestClient

from seo_engine.api import create_app
from seo_engine.crawler import SeoCrawler
from seo_engine.policy import PoliteClient
from seo_engine.repository import Repository
from rea_fixture import BASE, allow_fixture, response_for


def test_owned_rea_fixture_crawl_persistence_and_actions(tmp_path):
    hits = []
    repo = Repository(tmp_path / 'rea.sqlite')
    site = repo.add_website('fixture-workspace', 'Owned REA Fixture', BASE)
    scan = repo.create_scan(site['id'], 100, 'http')

    async def crawl():
        client = PoliteClient(BASE, validate=allow_fixture, delay=0,
                              transport=httpx.MockTransport(lambda request: response_for(request, hits)))
        await SeoCrawler(repo, scan, site, client=client).run()
    asyncio.run(crawl())
    stored = repo.scan(scan['id'])
    assert stored['status'] == 'completed', stored
    assert stored['pages_count'] == 19
    assert '/blocked/' not in hits
    headers = {'x-workspace-id': 'fixture-workspace', 'x-seo-token': 'fixture-only'}
    with TestClient(create_app(Repository(repo.path), token='fixture-only', validate=allow_fixture)) as client:
        root = f"/api/scans/{scan['id']}"
        graph = client.get(root + '/graph', headers=headers).json()
        nodes = {node['url']: node for node in graph['nodes']}
        assert nodes[BASE + 'catalog/']['inlinks'] == 14
        assert nodes[BASE + 'catalog/']['unique_inlinks'] == 13
        assert nodes[BASE + 'catalog/']['followed_inlinks'] == 13
        assert nodes[BASE + 'catalog/collection/slab/specification/']['depth'] == 4
        assert nodes[BASE + 'sitemap-only/']['depth'] is None
        assert nodes[BASE + 'sitemap-only/']['discovery_sources'] == ['canonical', 'sitemap']
        pages = client.get(root + '/pages', headers=headers).json()
        alias = next(p for p in pages if p['url'] == BASE + 'old-url/')
        assert alias['first_status_code'] == 301 and alias['final_status_code'] == 200
        assert [hop['status'] for hop in alias['redirect_chain']] == [301, 302]
        only_redirects = client.get(root + '/pages?status=3xx', headers=headers).json()
        assert [p['url'] for p in only_redirects] == [BASE + 'old-url/']
        groups = client.get(root + '/issue-groups', headers=headers).json()
        by_code = {g['code']: g for g in groups['groups']}
        assert 'canonical_loop' not in by_code, 'Self-canonicals are normal terminals, not cycles'
        assert by_code['duplicate_description']['affected_count'] == 2
        assert by_code['duplicate_description']['eligible_count'] == 15
        assert by_code['canonical_target_error']['affected_urls'] == [BASE + 'canonical-broken/']
        assert by_code['canonical_target_error']['priority'] == 'high'
        assert by_code['canonical_other']['confidence'] == 'review'
        assert by_code['canonical_other']['priority'] == 'low'
        assert by_code['noindex']['issue_type'] == 'insight'
        actions = client.get(root + '/export?kind=actions&format=json', headers=headers).json()['results']
        broken = next(a for a in actions if a['code'] == 'canonical_target_error')
        assert broken['source_url'] == BASE + 'canonical-broken/'
        assert broken['target_url'] == BASE + 'missing/' and broken['target_status_code'] == 404
        assert broken['fix_steps'] and broken['priority_reason']
        assert all(0 <= g['coverage_pct'] <= 100 for g in groups['groups'] if g['coverage_pct'] is not None)
