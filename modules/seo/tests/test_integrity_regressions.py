import httpx

from seo_engine.rules import audit_pages, extract_page

BASE = 'https://example.test/'


def page(path, html, chain=()):
    url = BASE + path
    response = httpx.Response(200, headers={'content-type': 'text/html'}, text=html,
                              request=httpx.Request('GET', url))
    return extract_page(url, response, list(chain), BASE)


def test_self_canonical_terminates_without_loop_including_inbound_consolidation():
    target = page('target', '<title>Target</title><link rel="canonical" href="/target">')
    alias = page('alias', '<title>Alias</title><link rel="canonical" href="/target">')
    issues = audit_pages([target, alias])
    assert not any(i['code'] == 'canonical_loop' for i in issues)
    assert not any(i['code'] == 'canonical_target_error' for i in issues)
    assert any(i['code'] == 'canonical_other' for i in issues)


def test_duplicate_metadata_without_canonical_and_alias_order():
    a = page('a', '<title> Shared title </title><meta name="description" content="Shared description">')
    b = page('b', '<title>shared title</title><meta name="description" content="shared description">')
    alias = {**a, 'url': BASE + 'alias', 'redirect_chain': [{'url': BASE + 'alias', 'status': 301, 'location': BASE + 'a'}]}
    issues = audit_pages([alias, b, a])
    for code in ('duplicate_title', 'duplicate_description'):
        assert {i['url'] for i in issues if i['code'] == code} == {BASE + 'a', BASE + 'b'}


def test_canonical_to_direct_target_is_not_misclassified_by_an_alias_snapshot():
    target = page('target', '<link rel="canonical" href="/target">')
    source = page('source', '<link rel="canonical" href="/target">')
    alias = {**target, 'url': BASE + 'alias', 'redirect_chain': [{'url': BASE + 'alias', 'status': 301, 'location': BASE + 'target'}]}
    issues = audit_pages([target, source, alias])
    assert not any(i['code'] == 'canonical_target_redirect' and i['url'] == source['url'] for i in issues)


def test_multiple_canonical_tags_conflict_and_safe_values_only():
    p = page('a', '<link rel="canonical" href="/b"><link rel="CANONICAL" href="/c"><link rel="canonical" href="/?token=discard-me">')
    assert 'discard-me' not in str(p)
    assert {e['target_url'] for e in p['link_edges']} == {BASE + 'b', BASE + 'c'}
    assert any(i['code'] == 'canonical_conflict' for i in audit_pages([p]))


def test_canonical_target_redirect_and_noindex_are_both_retained():
    target = page('target', '<meta name="robots" content="noindex"><link rel="canonical" href="/target">')
    alias = {**target, 'url': BASE + 'old', 'first_status_code': 301,
             'redirect_chain': [{'url': BASE + 'old', 'status': 301, 'location': BASE + 'target'}]}
    source = page('source', '<link rel="canonical" href="/old">')
    findings = {i['code'] for i in audit_pages([source, alias, target]) if i['url'] == source['url']}
    assert {'canonical_target_redirect', 'canonical_target_noindex'} <= findings


def test_single_redirect_is_not_multi_hop_chain():
    alias = page('target', '<title>Target</title>')
    alias.update(url=BASE + 'alias', first_status_code=301,
                 redirect_chain=[{'url': BASE + 'alias', 'status': 301, 'location': BASE + 'target'}])
    issues = audit_pages([alias])
    assert any(i['code'] == 'redirect' for i in issues)
    assert not any(i['code'] == 'redirect_chain' for i in issues)


def test_whitespace_robots_tokens_and_anchor_storage_bounds():
    p = page('a', '<meta name="robots" content="noindex nofollow"><a href="/b">' + 'x' * 3000 + '</a>')
    assert p['indexable'] is False
    assert p['link_edges'][0]['follow'] is False
    assert len(p['link_edges'][0]['anchor']) == 2000
    assert any(i['code'] == 'noindex' for i in audit_pages([p]))


def test_redirect_target_network_failure_retains_already_observed_hop():
    import asyncio
    import pytest
    from seo_engine.policy import PoliteClient
    from seo_engine.rules import failed_page

    hits = []
    def respond(request):
        hits.append(request.url.path)
        if request.url.path == '/start':
            return httpx.Response(301, headers={'location': '/unavailable'})
        raise httpx.ConnectError('Synthetic network failure', request=request)

    async def crawl():
        async def permit(url):
            pass
        client = PoliteClient(BASE, validate=permit, delay=0, transport=httpx.MockTransport(respond))
        try:
            with pytest.raises(httpx.ConnectError) as error:
                await client.fetch(BASE + 'start')
            failed = failed_page(BASE + 'start', error.value)
            assert failed['first_status_code'] == 301
            assert failed['redirect_chain'] == [{'url': BASE + 'start', 'status': 301, 'location': BASE + 'unavailable'}]
        finally:
            await client.close()
    asyncio.run(crawl())
    assert hits == ['/start', '/unavailable']


def test_redirect_destination_validation_failure_retains_hop_without_fetch():
    import asyncio
    import pytest
    from seo_engine.policy import PolicyError, PoliteClient
    from seo_engine.rules import failed_page

    hits = []
    def respond(request):
        hits.append(request.url.path)
        return httpx.Response(302, headers={'location': '/next'})

    async def crawl():
        async def validate(url):
            if url.endswith('/next'):
                raise PolicyError('Synthetic connection-time policy rejection')
        client = PoliteClient(BASE, validate=validate, delay=0, transport=httpx.MockTransport(respond))
        try:
            with pytest.raises(PolicyError) as error:
                await client.fetch(BASE + 'start')
            failed = failed_page(BASE + 'start', error.value)
            assert failed['first_status_code'] == 302
            assert failed['redirect_chain'] == [{'url': BASE + 'start', 'status': 302, 'location': BASE + 'next'}]
        finally:
            await client.close()
    asyncio.run(crawl())
    assert hits == ['/start']
