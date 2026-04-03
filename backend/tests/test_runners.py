import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.core.runners import execute_http_request, inject_variables


class TestInjectVariables:
    def test_replaces_single_placeholder(self) -> None:
        assert inject_variables("Hello {{name}}", {"name": "World"}) == "Hello World"

    def test_replaces_multiple_placeholders(self) -> None:
        assert inject_variables("{{a}} and {{b}}", {"a": "1", "b": "2"}) == "1 and 2"

    def test_strips_whitespace_inside_braces(self) -> None:
        assert inject_variables("{{  key  }}", {"key": "x"}) == "x"

    def test_missing_key_becomes_empty_string(self) -> None:
        assert inject_variables("{{missing}}", {}) == ""

    def test_non_string_passthrough(self) -> None:
        assert inject_variables("", {"a": "b"}) == ""
        assert inject_variables(None, {}) is None

    def test_numeric_values_coerced_to_str(self) -> None:
        assert inject_variables("n={{n}}", {"n": 42}) == "n=42"


@pytest.mark.asyncio
async def test_execute_http_request_mocks_httpx_async_client() -> None:
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"ok": True}

    mock_client = AsyncMock()
    mock_client.request = AsyncMock(return_value=mock_response)

    async_cm = AsyncMock()
    async_cm.__aenter__ = AsyncMock(return_value=mock_client)
    async_cm.__aexit__ = AsyncMock(return_value=None)

    with patch("backend.core.runners.httpx.AsyncClient", return_value=async_cm):
        result = await execute_http_request(
            {
                "url": "https://example.com/{{path}}",
                "method": "GET",
                "headers": "{}",
                "body": "{}",
            },
            {"path": "api"},
        )

    assert result["status_code"] == 200
    assert result["response"] == {"ok": True}
    assert result["request_url"] == "https://example.com/api"
    mock_client.request.assert_awaited_once()
    call_kwargs = mock_client.request.await_args
    assert call_kwargs[0][0] == "GET"
    assert call_kwargs[0][1] == "https://example.com/api"
