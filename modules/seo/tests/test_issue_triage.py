from seo_engine import triage

BASE = 'https://example.test/'


def page(path, **values):
    return {'url': BASE + path, 'final_url': BASE + path, 'status_code': 200, 'content_type': 'text/html',
            'title': 'A title', 'description': 'About stone', 'canonical': BASE + path,
            'internal_links': [BASE + 'missing'], 'redirect_chain': [], 'error': '', **values}


def issue(path, code, priority='medium', **details):
    return {'url': BASE + path, 'code': code, 'priority': priority, 'title': code,
            'recommendation': 'Check the observed evidence before editing.', 'details': details}


def test_eligibility_confidence_sorting_and_original_fix_checklist():
    pages = [page('a'), page('b'), page('c'), page('not-html', content_type='image/png'), page('missing', status_code=404)]
    issues = [issue('a', 'duplicate_description'), issue('b', 'duplicate_description'),
              issue('a', 'canonical_target_error', 'high', target_url=BASE + 'missing', target_status=404),
              issue('b', 'noindex', 'high'), issue('c', 'canonical_other')]
    result = triage.group_issues(pages, issues)
    groups = {g['code']: g for g in result['groups']}
    assert result['groups'][0]['code'] == 'canonical_target_error'
    assert groups['duplicate_description']['affected_count'] == 2
    assert groups['duplicate_description']['eligible_count'] == 3
    assert abs(groups['duplicate_description']['coverage_pct'] - 200 / 3) < .01
    assert groups['noindex']['confidence'] == 'review'
    assert groups['noindex']['issue_type'] == 'insight'
    assert groups['canonical_other']['priority'] == 'low'
    assert groups['canonical_target_error']['confidence'] == 'observed'
    assert all(g['priority_reason'] and g['fix_steps'] for g in groups.values())
    assert 'observed' in result['note'].lower()


def test_actions_contain_source_target_status_evidence_and_filter_context():
    pages = [page('a', first_status_code=200, final_status_code=200), page('missing', status_code=404)]
    issues = [issue('a', 'broken_internal_link', 'high', target_url=BASE + 'missing', target_status=404)]
    result = triage.group_issues(pages, issues)
    actions = triage.action_rows(result, pages)
    assert len(actions) == 1
    action = actions[0]
    assert action['source_url'] == BASE + 'a' and action['target_url'] == BASE + 'missing'
    assert action['first_status_code'] == 200 and action['target_status_code'] == 404
    assert action['priority_reason'] and action['fix_steps'] and action['confidence'] == 'observed'
    assert action['eligible_count'] == 1


def test_legacy_issue_gets_read_time_metadata_without_mutation():
    old = issue('a', 'missing_title', 'high')
    enriched = triage.enrich_issue(old)
    assert enriched['category'] == 'metadata' and enriched['confidence'] == 'observed'
    assert 'category' not in old
    unknown = triage.enrich_issue(issue('a', 'future_code'))
    assert unknown['confidence'] == 'unknown' and unknown['issue_type'] == 'warning'
    groups = triage.group_issues([], [old])['groups']
    assert groups[0]['eligible_count'] is None and groups[0]['coverage_pct'] is None


def test_action_target_first_final_status_are_not_collapsed_or_unknown_for_final_body():
    alias = page('old', final_url=BASE + 'final', status_code=404, first_status_code=301, final_status_code=404,
                 redirect_chain=[{'url': BASE + 'old', 'status': 301, 'location': BASE + 'final'}])
    source = page('source')
    issues = [issue('source', 'canonical_target_error', 'high', target_url=BASE + 'old', target_status=404),
              issue('source', 'broken_internal_link', 'high', target_url=BASE + 'final', target_status=404)]
    actions = triage.action_rows(triage.group_issues([source, alias], issues), [source, alias])
    old = next(a for a in actions if a['target_url'] == BASE + 'old')
    assert old['target_status_code'] == 301 and old['target_final_status_code'] == 404
    final = next(a for a in actions if a['target_url'] == BASE + 'final')
    assert final['target_status_code'] == 404 and final['target_final_status_code'] == 404
