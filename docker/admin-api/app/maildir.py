"""Read Maildir directly from the vmail volume (mounted read-only).

Maildir layout per mailbox:
  /var/vmail/<domain>/<local_part>/Maildir/
    ├── new/        # unseen
    ├── cur/        # seen
    └── tmp/
"""
from __future__ import annotations

import email
import hashlib
import heapq
import os
import re
import time
from datetime import datetime, timezone
from email.header import decode_header
from email.message import Message
from pathlib import Path
from typing import Any


VMAIL_ROOT = Path(os.getenv("VMAIL_ROOT", "/var/vmail"))

# Cap bytes read when only headers / verification code / snippet are needed.
# A verification mail's code lives at the very top; reading the whole body of a
# large attachment mail just to grab a 6-digit code wastes memory and CPU.
_MAX_PARSE_BYTES = int(os.getenv("MAILDIR_MAX_PARSE_BYTES", str(256 * 1024)))

# Short-TTL cache for latest_code: the接码 workload polls the same mailbox
# repeatedly; caching the result for a couple of seconds collapses bursts of
# identical scans into one filesystem walk.
_CODE_CACHE_TTL = float(os.getenv("LATEST_CODE_CACHE_TTL", "3.0"))
_CODE_CACHE_MAX = 5000
_CODE_CACHE: dict[str, tuple[float, Any]] = {}

# Heuristic verification code patterns (priority order).
# Whole string match wins first; then contextual capture.
_CODE_PATTERNS: list[re.Pattern[str]] = [
    # "code: 123456", "验证码：123456", "Your code is 987654"
    re.compile(
        r"(?:verification|verify|confirm(?:ation)?|one[- ]?time|otp|code|passcode|pin|验证码|校验码|动态码|授权码)"
        r"\s*(?:is|:|：|=|\-|为|是)?\s*\*?\*?\s*([A-Z0-9]{4,8})\b",
        re.IGNORECASE,
    ),
    # Bare 4-8 digit sequences anywhere (fallback).
    re.compile(r"\b([0-9]{4,8})\b"),
    # Alphanumeric 6-8 chars (e.g. "A3F9K2")
    re.compile(r"\b([A-Z0-9]{6,8})\b"),
]


def _mailbox_dir(email_addr: str) -> Path:
    local_part, _, domain = email_addr.partition("@")
    if not local_part or not domain:
        raise ValueError(f"invalid email: {email_addr}")
    return VMAIL_ROOT / domain.lower() / local_part.lower() / "Maildir"


def _decode(value: str | bytes | None) -> str:
    if not value:
        return ""
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8", errors="ignore")
        except Exception:
            return value.decode("latin-1", errors="ignore")
    # RFC 2047 encoded header (e.g. "=?utf-8?b?...?=")
    try:
        parts = decode_header(value)
        out = []
        for chunk, charset in parts:
            if isinstance(chunk, bytes):
                out.append(chunk.decode(charset or "utf-8", errors="ignore"))
            else:
                out.append(chunk)
        return "".join(out).strip()
    except Exception:
        return value


def _uid_for_path(p: Path) -> str:
    # Stable short id derived from relative path. 12 hex chars ~ 48 bits, enough for a mailbox.
    rel = str(p.relative_to(VMAIL_ROOT))
    return hashlib.sha1(rel.encode("utf-8")).hexdigest()[:12]


def _scan_with_mtime(d: Path) -> list[tuple[str, float]]:
    """Single scandir pass returning (path, mtime). scandir caches stat info on
    the DirEntry so this avoids the double stat (is_file + sort key) that
    iterdir()+p.stat() incurred."""
    out: list[tuple[str, float]] = []
    try:
        with os.scandir(d) as it:
            for e in it:
                if e.name.startswith("."):
                    continue
                try:
                    if e.is_file(follow_symlinks=False):
                        out.append((e.path, e.stat().st_mtime))
                except OSError:
                    continue
    except (FileNotFoundError, NotADirectoryError):
        pass
    return out


def _collect_files(mbox_dir: Path) -> list[Path]:
    entries = _scan_with_mtime(mbox_dir / "new") + _scan_with_mtime(mbox_dir / "cur")
    entries.sort(key=lambda t: t[1], reverse=True)
    return [Path(p) for p, _ in entries]


def _recent_files(mbox_dir: Path, n: int) -> list[Path]:
    """Return the newest n files without fully sorting the whole mailbox
    (heapq.nlargest is O(m) memory / O(m log n) time vs O(m log m) full sort)."""
    entries = _scan_with_mtime(mbox_dir / "new") + _scan_with_mtime(mbox_dir / "cur")
    top = heapq.nlargest(n, entries, key=lambda t: t[1])
    return [Path(p) for p, _ in top]


def _parse(p: Path, max_bytes: int | None = _MAX_PARSE_BYTES) -> Message:
    """Parse a Maildir file. By default only the first max_bytes are read, which
    is enough for headers, snippet and verification-code extraction; pass
    max_bytes=None to read the full message (used when rendering a mail)."""
    with p.open("rb") as fh:
        data = fh.read() if max_bytes is None else fh.read(max_bytes)
    return email.message_from_bytes(data)


def _extract_text(msg: Message) -> str:
    """Return best-effort text representation (prefer text/plain)."""
    if msg.is_multipart():
        # Prefer text/plain, fallback text/html stripped of tags.
        plain_chunks: list[str] = []
        html_chunks: list[str] = []
        for part in msg.walk():
            ctype = part.get_content_type()
            if part.get_content_maintype() == "multipart":
                continue
            try:
                payload = part.get_payload(decode=True)
            except Exception:
                continue
            if not payload:
                continue
            charset = part.get_content_charset() or "utf-8"
            try:
                text = payload.decode(charset, errors="ignore")
            except LookupError:
                text = payload.decode("utf-8", errors="ignore")
            if ctype == "text/plain":
                plain_chunks.append(text)
            elif ctype == "text/html":
                html_chunks.append(text)
        if plain_chunks:
            return "\n".join(plain_chunks)
        if html_chunks:
            return _strip_html("\n".join(html_chunks))
        return ""
    else:
        payload = msg.get_payload(decode=True) or b""
        charset = msg.get_content_charset() or "utf-8"
        try:
            text = payload.decode(charset, errors="ignore")
        except LookupError:
            text = payload.decode("utf-8", errors="ignore")
        if msg.get_content_type() == "text/html":
            return _strip_html(text)
        return text


_TAG_RE = re.compile(r"<[^>]+>")
_STYLE_RE = re.compile(r"<(style|script)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_WS_RE = re.compile(r"\n\s*\n+")


def _strip_html(html: str) -> str:
    html = _STYLE_RE.sub("", html)
    text = _TAG_RE.sub("", html)
    # decode common entities
    for k, v in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'")):
        text = text.replace(k, v)
    return _WS_RE.sub("\n\n", text).strip()


def _header_date(msg: Message) -> str:
    raw = msg.get("Date")
    if not raw:
        return ""
    try:
        dt = email.utils.parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return raw


def list_messages(email_addr: str, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    mbox = _mailbox_dir(email_addr)
    if not mbox.is_dir():
        return {"items": [], "total": 0, "limit": limit, "offset": offset}
    files = _collect_files(mbox)
    total = len(files)
    slice_ = files[offset : offset + limit]
    items: list[dict[str, Any]] = []
    for p in slice_:
        try:
            msg = _parse(p)
        except Exception:
            continue
        items.append(
            {
                "uid": _uid_for_path(p),
                "from": _decode(msg.get("From")),
                "to": _decode(msg.get("To")),
                "subject": _decode(msg.get("Subject")),
                "date": _header_date(msg),
                "seen": p.parent.name == "cur",
                "size": p.stat().st_size,
                "snippet": _snippet(msg),
            }
        )
    return {"items": items, "total": total, "limit": limit, "offset": offset}


def _snippet(msg: Message, max_len: int = 180) -> str:
    body = _extract_text(msg)
    body = re.sub(r"\s+", " ", body).strip()
    return body[:max_len]


def get_message(email_addr: str, uid: str) -> dict[str, Any] | None:
    mbox = _mailbox_dir(email_addr)
    if not mbox.is_dir():
        return None
    for p in _collect_files(mbox):
        if _uid_for_path(p) == uid:
            msg = _parse(p, max_bytes=None)
            body = _extract_text(msg)
            return {
                "uid": uid,
                "from": _decode(msg.get("From")),
                "to": _decode(msg.get("To")),
                "cc": _decode(msg.get("Cc")),
                "subject": _decode(msg.get("Subject")),
                "date": _header_date(msg),
                "message_id": _decode(msg.get("Message-ID")),
                "seen": p.parent.name == "cur",
                "size": p.stat().st_size,
                "body_text": body,
                "codes": extract_codes(msg.get("Subject", "") + "\n" + body),
            }
    return None


# Common English / Chinese words that look like codes but are not.
_STOP_WORDS = {
    "VERIFY", "YOUR", "CODE", "EMAIL", "LOGIN", "SIGN", "SIGNIN", "SIGNUP",
    "CONFIRM", "VERIFICATION", "EXPIRES", "MINUTES", "MINUTE", "WINDSURF",
    "GOOGLE", "APPLE", "ONLY", "HELLO", "THANKS", "PLEASE", "ENTER", "BELOW",
    "ABOVE", "CLICK", "HERE", "FROM", "WITH", "THIS", "THAT", "THESE",
    "THOSE", "SUBJECT", "NOREPLY", "REPLY", "SUPPORT", "SERVICE", "HTTPS",
    "HTTP", "LINK", "ACCOUNT", "PASSWORD", "TOKEN", "AUTH", "START", "USING",
    "USER", "ADMIN", "RESET", "ACTION", "NEEDED", "DONE", "SECURE", "SAFE",
}


def _is_plausible_code(code: str) -> bool:
    if not code:
        return False
    # Must contain at least one digit, OR be an all-digit sequence.
    has_digit = any(c.isdigit() for c in code)
    has_alpha = any(c.isalpha() for c in code)
    if not has_digit:
        return False  # ignore pure-letter tokens like "Verify"
    if has_alpha and code.upper() in _STOP_WORDS:
        return False
    return True


def extract_codes(text: str) -> list[str]:
    if not text:
        return []
    seen: list[str] = []
    for pat in _CODE_PATTERNS:
        for m in pat.finditer(text):
            code = m.group(1).strip()
            if not _is_plausible_code(code):
                continue
            if code not in seen:
                seen.append(code)
        if seen:
            break
    return seen[:5]


def _latest_code_uncached(email_addr: str, max_scan: int) -> dict[str, Any] | None:
    mbox = _mailbox_dir(email_addr)
    if not mbox.is_dir():
        return None
    for p in _recent_files(mbox, max_scan):
        try:
            msg = _parse(p)
        except Exception:
            continue
        body = _extract_text(msg)
        text = (_decode(msg.get("Subject")) or "") + "\n" + body
        codes = extract_codes(text)
        if codes:
            return {
                "code": codes[0],
                "all_codes": codes,
                "from": _decode(msg.get("From")),
                "subject": _decode(msg.get("Subject")),
                "date": _header_date(msg),
                "uid": _uid_for_path(p),
            }
    return None


def latest_code(email_addr: str, max_scan: int = 20) -> dict[str, Any] | None:
    key = f"{email_addr.lower()}:{max_scan}"
    now = time.monotonic()
    cached = _CODE_CACHE.get(key)
    if cached is not None and now - cached[0] < _CODE_CACHE_TTL:
        return cached[1]
    result = _latest_code_uncached(email_addr, max_scan)
    if len(_CODE_CACHE) >= _CODE_CACHE_MAX:
        # drop expired entries; if still full, clear outright (cheap, rare)
        for k in [k for k, v in _CODE_CACHE.items() if now - v[0] >= _CODE_CACHE_TTL]:
            _CODE_CACHE.pop(k, None)
        if len(_CODE_CACHE) >= _CODE_CACHE_MAX:
            _CODE_CACHE.clear()
    _CODE_CACHE[key] = (now, result)
    return result
