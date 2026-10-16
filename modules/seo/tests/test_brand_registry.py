from fastapi.testclient import TestClient
from seo_engine.api import create_app
from seo_engine.repository import Repository


def test_brand_registration_is_persistent_scoped_and_idempotent(tmp_path):
    path = tmp_path / 'seo.sqlite'
    repo = Repository(path)
    site = repo.add_website('owner', 'Material brand', 'https://example.com/')
    with TestClient(create_app(repo, token='fixture-only')) as client:
        headers = {'x-seo-token': 'fixture-only', 'x-workspace-id': 'owner'}
        assert client.post('/api/brands', json={'key': 'material', 'name': 'Material'}, headers=headers).status_code == 200
        duplicate = client.post('/api/brands', json={'key': 'MATERIAL', 'name': 'MATERIAL'}, headers=headers).json()
        assert duplicate['key'] == 'material'
        assert len(client.get('/api/brands', headers=headers).json()) == 1
        other = {**headers, 'x-workspace-id': 'other'}
        assert client.get('/api/brands', headers=other).json() == []
        assert client.post('/api/brands', json={'key': ' ', 'name': ' '}, headers=headers).status_code == 422
        linked = client.patch(f'/api/websites/{site["id"]}/brand', json={'brand_key': 'material'}, headers=headers).json()
        assert linked['id'] == site['id'] and linked['brand_key'] == 'material'
        assert client.patch(f'/api/websites/{site["id"]}/brand', json={'brand_key': 'material'}, headers=other).status_code == 404
    reopened = Repository(path)
    assert reopened.brands('owner') == [{'key': 'material', 'name': 'Material', 'workspace_id': 'owner'}]
    assert reopened.website(site['id'], 'owner')['brand_key'] == 'material'
    assert len(reopened.websites('owner')) == 1
