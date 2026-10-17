import csv
import io

from fastapi.testclient import TestClient

from seo_engine.api import create_app
from seo_engine.repository import Repository
from test_engine import allow_test, page


def test_graph_group_export_scope_and_legacy_readback(tmp_path):
    repo = Repository(tmp_path / 'seo.sqlite')
    site = repo.add_website('w1', 'Fixture', 'https://example.com/')
    scan = repo.create_scan(site['id'], 100, 'http')
    source = page('/', '<title>Stone</title><h1>Stone</h1><a href="/missing">=danger</a><a href="/missing">Again</a>')
    missing = page('/missing', status=404)
    repo.save_page(scan['id'], source)
    repo.save_page(scan['id'], missing)
    repo.save_issues(scan['id'], [{'url': source['url'], 'code': 'broken_internal_link', 'priority': 'high',
                                 'title': 'Broken', 'recommendation': 'Replace link',
                                 'details': {'target_url': missing['url'], 'target_status': 404}}])
    repo.update_scan(scan['id'], status='completed')
    stored = repo.graph(scan['id'])
    repo.save_graph(scan['id'], stored)
    assert Repository(repo.path).graph(scan['id']) == stored
    headers = {'x-seo-token': 'fixture', 'x-workspace-id': 'w1'}
    with TestClient(create_app(repo, token='fixture', validate=allow_test)) as client:
        root = f"/api/scans/{scan['id']}"
        for tail in ('graph', 'issue-groups', 'export?kind=links', 'export?kind=actions', 'export?kind=issue-groups'):
            assert client.get(f'{root}/{tail}').status_code == 401
            assert client.get(f'{root}/{tail}', headers={**headers, 'x-workspace-id': 'w2'}).status_code == 404
        graph = client.get(f'{root}/graph', headers=headers).json()
        assert graph['available'] and len([e for e in graph['edges'] if e['kind'] == 'hyperlink']) == 2
        groups = client.get(f'{root}/issue-groups', headers=headers).json()
        assert groups['groups'][0]['eligible_count'] == 1
        assert client.get(f'{root}/issue-groups?category=metadata', headers=headers).json()['groups'] == []
        exported = client.get(f'{root}/export?kind=actions&format=json', headers=headers).json()
        assert exported['results'][0]['target_status_code'] == 404
        assert exported['coverage']['scope'] == 'observed_scan'
        assert client.get(f'{root}/export?kind=actions&priority=low&format=json', headers=headers).json()['results'] == []
        assert client.get(f'{root}/export?kind=actions&category=metadata&format=json', headers=headers).json()['results'] == []
        assert client.get(f'{root}/export?kind=actions&confidence=unknown&format=json', headers=headers).json()['results'] == []
        assert client.get(f'{root}/export?kind=issue-groups&issue_type=insight&format=json', headers=headers).json()['results'] == []
        csv_links = client.get(f'{root}/export?kind=links&format=csv', headers=headers)
        assert csv_links.text.startswith(chr(65279)), 'CSV requires a real UTF-8 BOM, not literal backslash-u text'
        records = list(csv.DictReader(io.StringIO(csv_links.text.lstrip('\ufeff'))))
        assert records[0]['anchor'].startswith("'=")
        pages = client.get(f'{root}/pages', headers=headers).json()
        assert pages[0]['depth'] == 0 and pages[1]['inlinks'] == 2
        assert client.get(f'{root}/export?kind=unsupported', headers=headers).status_code == 422
    # An old JSON page has no occurrence capture; no new network or invented edges.
    older = repo.create_scan(site['id'], 10, 'http')
    old = {k: v for k, v in source.items() if k not in {'link_edges', 'link_edges_truncated'}}
    repo.save_page(older['id'], old)
    repo.update_scan(older['id'], status='completed')
    with TestClient(create_app(repo, token='fixture', validate=allow_test)) as client:
        legacy = client.get(f"/api/scans/{older['id']}/graph", headers=headers).json()
        assert legacy['available'] is False and legacy['coverage']['legacy']
        empty = client.get(f"/api/scans/{older['id']}/export?kind=actions", headers=headers)
        assert empty.status_code == 200 and 'source_url' in empty.text


def test_mixed_snapshot_fields_export_without_dictwriter_failure(tmp_path):
    repo = Repository(tmp_path / 'mixed.sqlite')
    site = repo.add_website('w1', 'Fixture', 'https://example.com/')
    scan = repo.create_scan(site['id'], 2, 'http')
    a, b = page('/a'), page('/b')
    a['new_field_only_on_one_row'] = 'valid'
    repo.save_page(scan['id'], a)
    repo.save_page(scan['id'], b)
    repo.update_scan(scan['id'], status='completed')
    with TestClient(create_app(repo, token='fixture', validate=allow_test)) as client:
        response = client.get(f"/api/scans/{scan['id']}/export?kind=pages", headers={'x-seo-token': 'fixture', 'x-workspace-id': 'w1'})
        assert response.status_code == 200
        assert len(list(csv.DictReader(io.StringIO(response.text.lstrip('\ufeff'))))) == 2


def test_historical_summary_agrees_with_read_time_issue_priorities_without_db_rewrite(tmp_path):
    import json
    repo = Repository(tmp_path / 'old-summary.sqlite')
    site = repo.add_website('w1', 'Fixture', 'https://example.com/')
    scan = repo.create_scan(site['id'], 10, 'http')
    repo.save_page(scan['id'], page())
    repo.save_issues(scan['id'], [{'url': 'https://example.com/', 'code': 'noindex', 'priority': 'high',
                                 'title': 'Noindex', 'recommendation': 'Review intent', 'details': {}}])
    repo.update_scan(scan['id'], status='completed', summary={'priority_counts': {'high': 1}})
    current = repo.scan(scan['id'])
    assert current['summary']['priority_counts'] == {'low': 1}
    with repo.connect() as db:
        retained = db.execute('SELECT summary FROM scans WHERE id=?', (scan['id'],)).fetchone()[0]
    assert json.loads(retained)['priority_counts'] == {'high': 1}, 'Do not migrate historical evidence in place'
