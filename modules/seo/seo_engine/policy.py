"""Same-origin public-web policy, redirects and shared polite request gate."""
import asyncio
import ipaddress
import socket
import time
from urllib.parse import parse_qsl, urljoin, urlsplit, urlunsplit

import httpx
from httpcore._backends.auto import AutoBackend
from protego import Protego

USER_AGENT = "RockBaseSEO/0.1 (+local operator technical audit)"
MAX_BODY = 2_000_000
ASSET_SUFFIXES = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg", ".ico", ".css", ".js", ".woff", ".woff2", ".mp4", ".mp3", ".zip", ".pdf")


class PolicyError(ValueError):
    pass


def normalize_url(value: str, base: str | None = None) -> str:
    value = urljoin(base, value) if base else value.strip()
    p = urlsplit(value)
    if p.scheme.lower() not in {"http", "https"} or not p.hostname or p.username or p.password:
        raise PolicyError("Only public HTTP(S) URLs without credentials are allowed")
    if any(ord(c) < 33 for c in value) or "\\" in value:
        raise PolicyError("Invalid URL characters")
    sensitive = {'access_token', 'refresh_token', 'token', 'api_key', 'apikey', 'key', 'secret', 'password', 'authorization', 'code', 'session', 'sessionid', 'signature', 'x-amz-signature', 'x-amz-credential'}
    if any(key.lower() in sensitive for key, _ in parse_qsl(p.query)):
        raise PolicyError('Credential-bearing query parameters are excluded from crawls and storage')
    host = p.hostname.encode("idna").decode().lower()
    if ":" in host:
        host = f"[{host}]"
    port = p.port
    netloc = host if port in (None, 80 if p.scheme == "http" else 443) else f"{host}:{port}"
    return urlunsplit((p.scheme.lower(), netloc, p.path or "/", p.query, ""))


def origin(url: str) -> str:
    p = urlsplit(normalize_url(url))
    return f"{p.scheme}://{p.netloc}"


def internal_url(value: str, base: str, site: str) -> str | None:
    try:
        url = normalize_url(value, base)
        if origin(url) == origin(site) and not urlsplit(url).path.lower().endswith(ASSET_SUFFIXES):
            return url
    except (ValueError, UnicodeError):
        pass
    return None


async def validate_public(url: str) -> None:
    p = urlsplit(normalize_url(url))
    if p.port not in (None, 80, 443):
        raise PolicyError("Only public web ports 80/443 are allowed")
    try:
        addresses = await asyncio.to_thread(socket.getaddrinfo, p.hostname, p.port or (443 if p.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except OSError as exc:
        raise PolicyError(f"DNS lookup failed: {exc}") from exc
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise PolicyError("Private, loopback, reserved and link-local addresses cannot be crawled")


class PublicNetworkBackend(AutoBackend):
    """Resolve once at connection time and pin TCP to a verified public IP (TLS keeps hostname)."""
    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        addresses = await asyncio.to_thread(socket.getaddrinfo, host, port, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
            raise PolicyError("Connection-time DNS resolved to a forbidden address")
        # Numeric IP cannot be rebound; httpcore still negotiates TLS for the original host.
        return await super().connect_tcp(addresses[0][4][0], port, timeout, local_address, socket_options)


class PoliteClient:
    def __init__(self, site: str, *, transport=None, validate=validate_public, delay: float = 1.1):
        self.site = normalize_url(site)
        self.validate = validate
        self.delay = delay
        self.lock = asyncio.Lock()
        self.next_request = 0.0
        self.parser = Protego.parse("")
        self.robots_ready = False
        self.halted = False
        if transport is None:
            transport = httpx.AsyncHTTPTransport(trust_env=False, retries=0, limits=httpx.Limits(max_connections=2, max_keepalive_connections=2))
            transport._pool._network_backend = PublicNetworkBackend()
        self.client = httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=25, follow_redirects=False, transport=transport, trust_env=False)

    def allowed(self, url: str) -> bool:
        return self.parser.can_fetch(url, "RockBaseSEO")

    async def gate(self):
        async with self.lock:
            await asyncio.sleep(max(0, self.next_request - time.monotonic()))
            self.next_request = time.monotonic() + self.delay

    async def fetch(self, url: str, *, robots: bool = True) -> tuple[httpx.Response, list[dict]]:
        history = {"chain": [], "response": None}
        try:
            return await self._fetch(url, robots=robots, history=history)
        except Exception as exc:
            if history["chain"]:
                exc.redirect_chain = history["chain"]
                if getattr(exc, "response", None) is None:
                    exc.response = history["response"]
            raise

    async def _fetch(self, url: str, *, robots: bool, history) -> tuple[httpx.Response, list[dict]]:
        chain = history["chain"]
        visited = set()
        last_response = None
        for _ in range(9):
            url = normalize_url(url)
            if url in visited:
                error = PolicyError("Redirect loop detected")
                error.response = last_response
                error.redirect_chain = chain
                raise error
            visited.add(url)
            if self.halted:
                raise PolicyError("Scan stopped after HTTP 429; retry later")
            if origin(url) != origin(self.site):
                raise PolicyError("Redirect outside the configured origin was not followed")
            await self.validate(url)
            if robots and self.robots_ready and not self.allowed(url):
                raise PolicyError("Blocked by robots.txt; URL was not fetched")
            await self.gate()
            async with self.client.stream("GET", url) as stream:
                chunks, size = [], 0
                async for chunk in stream.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_BODY:
                        raise PolicyError("Response exceeds 2 MB safety limit")
                    chunks.append(chunk)
                # aiter_bytes already decompresses: do not decode Content-Encoding a second time.
                headers = {k: v for k, v in stream.headers.items() if k.lower() not in {"content-encoding", "content-length", "transfer-encoding"}}
                response = httpx.Response(stream.status_code, headers=headers, content=b"".join(chunks), request=stream.request)
            last_response = response
            history["response"] = response
            if response.status_code == 429:
                self.halted = True
            if response.status_code in {301, 302, 303, 307, 308} and response.headers.get("location"):
                try:
                    next_url = normalize_url(response.headers["location"], url)
                except PolicyError as exc:
                    chain.append({"url": url, "status": response.status_code, "location": ""})
                    exc.response = response
                    exc.redirect_chain = chain
                    raise
                chain.append({"url": url, "status": response.status_code, "location": next_url})
                if next_url in visited:
                    error = PolicyError("Redirect loop detected")
                    error.response = response
                    error.redirect_chain = chain
                    raise error

                # Preserve observed redirect even when the destination is out-of-scope or forbidden.
                if origin(next_url) != origin(self.site) or (robots and self.robots_ready and not self.allowed(next_url)):
                    return response, chain
                url = next_url
            else:
                return response, chain
        error = PolicyError("Redirect limit exceeded (8 hops)")
        error.response = last_response
        error.redirect_chain = chain
        raise error

    async def load_robots(self) -> tuple[str, int]:
        url = origin(self.site) + "/robots.txt"
        response, _ = await self.fetch(url, robots=False)
        if response.status_code in {404, 410}:
            text = ""
        elif response.status_code != 200:
            error = PolicyError(f"robots.txt returned HTTP {response.status_code}; scan refused conservatively")
            error.status_code = response.status_code
            raise error
        else:
            text = response.text
            if "<html" in text[:500].lower():
                raise PolicyError("robots.txt returned HTML; refusing uncertain crawl permissions")
        self.parser = Protego.parse(text)
        self.delay = max(self.delay, self.parser.crawl_delay("RockBaseSEO") or 0)
        self.robots_ready = True
        return text, response.status_code

    async def close(self):
        await self.client.aclose()
