import asyncio
import gzip
from unittest.mock import patch

import httpx
import pytest

from seo_engine.crawler import SeoCrawler
from seo_engine.policy import PolicyError, PoliteClient, PublicNetworkBackend, normalize_url
from seo_engine.repository import Repository


async def allow_test(url):
    pass


def test_gzip_is_decoded_exactly_once():
    async def run():
        client = PoliteClient("https://example.com/", validate=allow_test, delay=0, transport=httpx.MockTransport(lambda req: httpx.Response(200, headers={"content-encoding": "gzip"}, content=gzip.compress(b"User-agent: *\nAllow: /"))))
        text, status = await client.load_robots()
        assert status == 200 and "Allow" in text
        await client.close()
    asyncio.run(run())


def test_denied_robots_is_real_issue_not_fabricated_page(tmp_path):
    repo = Repository(tmp_path / "seo.sqlite")
    site = repo.add_website("workspace", "Site", "https://example.com/")
    scan = repo.create_scan(site["id"], 100, "auto")
    async def run():
        client = PoliteClient(site["base_url"], validate=allow_test, delay=0, transport=httpx.MockTransport(lambda req: httpx.Response(403, text="Forbidden")))
        await SeoCrawler(repo, scan, site, client=client).run()
    asyncio.run(run())
    result = repo.scan(scan["id"])
    assert result["status"] == "failed" and result["summary"]["robots_status"] == 403
    assert result["pages_count"] == 0 and result["issues_count"] == 1
    assert repo.rows("issues", scan["id"])[0]["code"] == "crawl_blocked"


def test_credentials_never_admitted():
    for url in ["https://example.com/?access_token=secret", "https://example.com/?code=oauth", "https://example.com/?X-Amz-Signature=private"]:
        with pytest.raises(PolicyError):
            normalize_url(url)


def test_dns_rebinding_rejected_at_connection():
    async def run():
        backend = PublicNetworkBackend()
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 443))]):
            with pytest.raises(PolicyError):
                await backend.connect_tcp("public-looking.example", 443)
    asyncio.run(run())
