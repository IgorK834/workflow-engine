import re
from typing import Any


_TEMPLATE_RE = re.compile(r"\{\{\s*(.*?)\s*\}\}")
_PURE_TEMPLATE_RE = re.compile(r"^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$")


def resolve_path(data: Any, path: str) -> Any:
    """Resolves dot-paths like 'a.b.0.c' in dict/list structures."""
    if not isinstance(path, str) or not path.strip():
        return None

    normalized = path.strip()

    if isinstance(data, dict) and normalized in data:
        return data.get(normalized)

    current = data
    for part in normalized.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit():
            idx = int(part)
            current = current[idx] if 0 <= idx < len(current) else None
        else:
            return None
        if current is None:
            return None
    return current


def is_pure_template(value: Any) -> str | None:
    """If value is exactly '{{path}}', returns path, otherwise None."""
    if not isinstance(value, str):
        return None
    m = _PURE_TEMPLATE_RE.fullmatch(value.strip())
    return m.group(1) if m else None


def render_template(text: Any, data: dict[str, Any]) -> Any:
    """Renders '{{path}}' occurrences inside a string using resolve_path().

    - Non-string values are returned unchanged.
    - Missing paths render as '' (empty string).
    """
    if not isinstance(text, str) or not text:
        return text

    def replacer(match: re.Match) -> str:
        key = match.group(1).strip()
        resolved = resolve_path(data, key)
        return "" if resolved is None else str(resolved)

    return _TEMPLATE_RE.sub(replacer, text)


def resolve_template_value(value: Any, data: dict[str, Any]) -> Any:
    """Resolves template values preserving types when possible.

    - If value is a pure '{{path}}' template, returns resolved runtime value (not coerced).
    - If value is a string with mixed text/templates, returns rendered string.
    - Otherwise returns value unchanged.
    """
    path = is_pure_template(value)
    if path:
        return resolve_path(data, path)
    return render_template(value, data)

