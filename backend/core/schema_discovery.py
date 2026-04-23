from typing import Any


SchemaLeafType = str  # 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown'
OutputSchema = dict[str, "SchemaLeafType | OutputSchema"]


def _build_schema_from_dot_paths(paths: list[str]) -> OutputSchema:
    result: OutputSchema = {}

    for raw in paths:
        path = str(raw or "").strip()
        if not path:
            continue
        keys = [k.strip() for k in path.split(".") if k.strip()]
        if not keys:
            continue

        current: OutputSchema = result
        for idx, key in enumerate(keys):
            is_last = idx == len(keys) - 1
            if is_last:
                current[key] = current.get(key) if isinstance(current.get(key), dict) else "unknown"
            else:
                existing = current.get(key)
                if not isinstance(existing, dict):
                    current[key] = {}
                current = current[key]  # type: ignore[assignment]

    return result


def infer_node_output_schema(subtype: str, config: dict[str, Any] | None = None) -> OutputSchema:
    config = config or {}

    if subtype == "webhook":
        return {
            "id": "string",
            "method": "string",
            "headers": "object",
            "query": "object",
            "body": "object",
            "received_at": "string",
        }
    if subtype == "receive_email":
        return {
            "message_id": "string",
            "from": "string",
            "to": "string",
            "subject": "string",
            "body": "string",
            "html_body": "string",
            "received_at": "string",
            "attachments": "array",
        }
    if subtype == "schedule":
        return {"tick_at": "string", "cron_expression": "string", "timezone": "string"}
    if subtype == "if_else":
        return {
            "matched": "boolean",
            "evaluated_variable": "string",
            "compared_value": "unknown",
            "input": "object",
        }
    if subtype == "switch":
        return {"matched_case": "string", "input": "object"}
    if subtype == "delay":
        return {
            "resumed_at": "string",
            "wait_value": "number",
            "wait_unit": "string",
            "input": "object",
        }
    if subtype == "json_transform":
        keys = [k.strip() for k in str(config.get("keys", "")).split(",") if k.strip()]
        return {
            **(_build_schema_from_dot_paths(keys) if keys else {}),
            "_meta": {"selected_keys": "string"},
        }
    if subtype == "for_each":
        return {"item": "object", "index": "number", "total": "number"}
    if subtype == "slack_msg":
        return {"status": "string", "message_ts": "string", "provider": "string"}
    if subtype == "send_email":
        return {"recipient": "string", "subject": "string", "status": "string", "sent_at": "string"}
    if subtype == "http_request":
        return {"status_code": "number", "headers": "object", "body": "object", "request_url": "string"}
    if subtype in {"db_insert", "collection_insert"}:
        return {"collection_id": "string", "record_id": "string", "status": "string"}
    if subtype == "collection_update":
        return {"collection_id": "string", "record_id": "string", "status": "string"}
    if subtype == "collection_find":
        return {"collection_id": "string", "count": "number", "items": "array", "payload": "object"}
    if subtype == "data_mapper":
        mappings = config.get("mappings")
        if isinstance(mappings, list):
            targets = [str(m.get("target", "")).strip() for m in mappings if isinstance(m, dict)]
            targets = [t for t in targets if t]
        else:
            targets = []
        return {
            **(_build_schema_from_dot_paths(targets) if targets else {}),
            "_meta": {"mappings_count": "number"},
        }
    if subtype == "jira_create_ticket":
        return {"id": "string", "key": "string", "url": "string", "status": "string"}
    if subtype in {"gemini_custom", "gemini_template"}:
        return {"output_text": "string", "model": "string", "usage": {"input_tokens": "number", "output_tokens": "number"}}
    if subtype == "manual_approval":
        return {"approved": "boolean", "approver": "string", "decided_at": "string"}

    return {"result": "unknown"}

