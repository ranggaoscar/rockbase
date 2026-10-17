from seo_engine import graph

BASE = 'https://example.test/'


def edge(source, target, *, follow=True, kind='hyperlink', occurrence=0):
    return {'source_url': BASE + source, 'target_url': BASE + target, 'kind': kind,
            'anchor': 'Material', 'rel': [] if follow else ['nofollow'], 'follow': follow, 'occurrence': occurrence}


def page(path, edges=(), chain=()):
    return {'url': BASE + path, 'final_url': BASE + path, 'status_code': 200, 'indexable': True,
            'content_type': 'text/html', 'redirect_chain': list(chain), 'link_edges': list(edges)}


def test_occurrences_types_and_shortest_depth_are_not_crawl_order():
    pages = [page('deep', [edge('deep', 'catalog')]), page('catalog', [edge('catalog', 'level2')]),
             page('level2', [edge('level2', 'level3')]), page('level3', [edge('level3', 'deep')]),
             page('', [edge('', 'catalog'), edge('', 'catalog', follow=False, occurrence=1),
                       edge('', 'deep', kind='canonical'), edge('', 'nofollow', follow=False)])]
    result = graph.build_graph(pages, BASE)
    nodes = {n['url']: n for n in result['nodes']}
    assert nodes[BASE + 'deep']['depth'] == 4
    assert nodes[BASE + 'deep']['path'] == [BASE, BASE + 'catalog', BASE + 'level2', BASE + 'level3', BASE + 'deep']
    assert nodes[BASE + 'catalog']['inlinks'] == 3
    assert nodes[BASE + 'catalog']['unique_inlinks'] == 2
    assert nodes[BASE + 'catalog']['unique_followed_inlinks'] == 2
    assert nodes[BASE]['outlinks'] == 3 and nodes[BASE]['unique_outlinks'] == 2
    assert nodes[BASE + 'nofollow']['depth'] is None
    assert nodes[BASE + 'deep']['inlinks'] == 1
    assert result['histogram'][-1] == {'depth': 4, 'count': 1}
    relation = next(e for e in result['edges'] if e['source_url'] == BASE and e['target_url'] == BASE + 'catalog')
    assert relation['source_status_code'] == 200 and relation['target_status_code'] == 200


def test_sitemap_redirect_and_legacy_are_distinct():
    old, dest = BASE + 'old', BASE + 'dest'
    chain = [{'url': old, 'location': dest, 'status': 301}]
    alias = page('old', [edge('dest', 'catalog')], chain)
    alias['final_url'] = dest
    pages = [page('', [edge('', 'old')]), alias, page('dest', [edge('dest', 'catalog')]), page('catalog')]
    result = graph.build_graph(pages, BASE, sitemap_edges=[{'source_url': BASE + 'sitemap.xml', 'target_url': BASE + 'isolated'}])
    nodes = {n['url']: n for n in result['nodes']}
    assert nodes[dest]['depth'] == 1 and nodes[dest]['redirect_hops'] == 1
    assert nodes[BASE + 'catalog']['inlinks'] == 1, 'Aliased final document must not double-count links'
    assert nodes[BASE + 'isolated']['depth'] is None
    assert nodes[BASE + 'isolated']['discovery_sources'] == ['sitemap']
    assert nodes[BASE + 'isolated']['observed'] is False
    legacy = page('')
    del legacy['link_edges']
    legacy['internal_links'] = [BASE + 'catalog']
    old_graph = graph.build_graph([legacy], BASE)
    assert old_graph['available'] is False and old_graph['coverage']['legacy']
    assert not any(e['kind'] == 'hyperlink' for e in old_graph['edges'])


def test_scan_edge_budget_and_unsafe_targets_are_explicit():
    pages = [page('', [edge('', 'a'), edge('', 'b'), edge('', '?access_token=do-not-store')])]
    result = graph.build_graph(pages, BASE, max_edges=1, limited=True)
    assert result['coverage']['truncated'] and result['coverage']['complete'] is False
    assert len(result['edges']) == 1
    assert 'do-not-store' not in str(result)
