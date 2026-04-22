import logging
import httpx
import json
import aiosmtplib
import re
import base64
import os

from email.message import EmailMessage
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Any
from datetime import datetime, timezone, timedelta

from ..models import SystemSetting
from .security import decrypt_value

import google.generativeai as genai

# Konfiguracja loggera
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Funkcja pomocnicza do http_request
def inject_variables(text: str, data: dict) -> str:
    """Wyszukuje tagi {{klucz}} i podmienia je."""
    if not isinstance(text, str) or not text:
        return text

    def replacer(match):
        key = match.group(1).strip()
        return str(data.get(key, ""))

    return re.sub(r"\{\{\s*(.*?)\s*\}\}", replacer, text)

class JiraClient:
    """Pomocniczy klient do komunikacji z Jira REST API v3"""
    def __init__(self, domain: str, email: str, api_token: str):
        self.base_url = f"https://{domain}.atlassian.net/rest/api/v3"
        auth_str = f"{email}:{api_token}"
        encoded_auth = base64.b64encode(auth_str.encode()).decode()
        self.headers = {
            "Authorization": f"Basic {encoded_auth}",
            "Accept": "application/json",
            "Content-Type": "application/json"
        }

    async def get_projects(self):
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.base_url}/projects", headers=self.headers)
            resp.raise_for_status()
            return resp.json()
        
    async def get_issue_types(self, project_id: str):
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.base_url}/issuetype/project?ProjectId={project_id}", headers=self.headers)
            resp.raise_for_status()
            return resp.json()

async def execute_webhook(config: dict[str, Any], input_data: dict[str, Any]) -> dict[str, Any]:
    logger.info(f"Odebrano dane z Webhooka: {input_data}")
    return input_data


async def execute_slack_msg(config: dict[str, Any], input_data: dict[str, Any]) -> dict[str, Any]:
    """Symulacja wysłania wiadomości na slacka"""
    channel = config.get("channel", "#general")
    message = config.get("message", "Pusta wiadomość")

    logger.info(f"[SLACK] Wysyłam na kanał {channel}: {message}")

    return {
        "status": "sent",
        "channel": channel,
        "message": message,
        "provider": "slack",
    }


async def execute_if_else(config: dict[str, Any], input_data: dict[str, Any]) -> dict[str, Any]:
    def _resolve_path(data: Any, path: str) -> Any:
        if not isinstance(path, str) or not path.strip():
            return None

        normalized_path = path.strip()
        m = re.fullmatch(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}", normalized_path)
        if m:
            normalized_path = m.group(1)

        if isinstance(data, dict) and normalized_path in data:
            return data.get(normalized_path)

        current = data
        for part in normalized_path.split("."):
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

    def _resolve_runtime_value(value: Any) -> Any:
        if not isinstance(value, str):
            return value
        m = re.fullmatch(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}", value.strip())
        if not m:
            return value
        resolved = _resolve_path(input_data, m.group(1))
        return resolved

    def _to_number(value: Any) -> float:
        if isinstance(value, bool):
            raise ValueError("bool nie jest liczbą w tym kontekście")
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            return float(value.strip().replace(",", "."))
        raise ValueError("Nie można rzutować na number")

    def _to_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "yes", "y", "t"}:
                return True
            if normalized in {"false", "0", "no", "n", "f"}:
                return False
        raise ValueError("Nie można rzutować na boolean")

    def _to_datetime(value: Any) -> datetime:
        if isinstance(value, datetime):
            parsed = value
        elif isinstance(value, str):
            normalized = value.strip()
            if normalized.endswith("Z"):
                normalized = normalized[:-1] + "+00:00"
            parsed = datetime.fromisoformat(normalized)
        else:
            raise ValueError("Nie można rzutować na datetime")

        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed

    def _is_empty(value: Any) -> bool:
        if value is None:
            return True
        if isinstance(value, str):
            return value.strip() == ""
        if isinstance(value, (list, dict, tuple, set)):
            return len(value) == 0
        return False

    def _coerce_pair(actual: Any, target: Any, value_type: str) -> tuple[Any, Any]:
        if value_type == "string":
            return str(actual), str(target)
        if value_type == "number":
            return _to_number(actual), _to_number(target)
        if value_type == "boolean":
            return _to_bool(actual), _to_bool(target)
        if value_type == "date":
            return _to_datetime(actual), _to_datetime(target)

        # auto
        for caster in (_to_datetime, _to_number, _to_bool):
            try:
                return caster(actual), caster(target)
            except (ValueError, TypeError):
                continue
        return actual, target

    def _evaluate_rule(rule: dict[str, Any]) -> bool:
        field = rule.get("field", "")
        operator = str(rule.get("operator", "equals"))
        value_type = str(rule.get("value_type", "auto")).lower()
        raw_target_value = _resolve_runtime_value(rule.get("value"))
        actual_value = _resolve_path(input_data, str(field))

        if operator == "is_empty":
            return _is_empty(actual_value)
        if operator == "is_not_empty":
            return not _is_empty(actual_value)

        coerced_actual, coerced_target = _coerce_pair(actual_value, raw_target_value, value_type)

        if operator == "equals":
            return coerced_actual == coerced_target
        if operator == "not_equals":
            return coerced_actual != coerced_target
        if operator == "greater":
            return coerced_actual > coerced_target
        if operator == "greater_or_equal":
            return coerced_actual >= coerced_target
        if operator == "less":
            return coerced_actual < coerced_target
        if operator == "less_or_equal":
            return coerced_actual <= coerced_target
        if operator == "contains":
            if isinstance(coerced_actual, (list, tuple, set)):
                return coerced_target in coerced_actual
            if isinstance(coerced_actual, dict):
                return str(coerced_target) in coerced_actual
            return str(coerced_target).lower() in str(coerced_actual).lower()
        if operator == "not_contains":
            if isinstance(coerced_actual, (list, tuple, set)):
                return coerced_target not in coerced_actual
            if isinstance(coerced_actual, dict):
                return str(coerced_target) not in coerced_actual
            return str(coerced_target).lower() not in str(coerced_actual).lower()
        if operator == "starts_with":
            return str(coerced_actual).lower().startswith(str(coerced_target).lower())
        if operator == "ends_with":
            return str(coerced_actual).lower().endswith(str(coerced_target).lower())

        logger.warning(f"[IF/ELSE] Nieobsługiwany operator '{operator}'")
        return False

    def _evaluate_ast(node: Any) -> bool:
        if not isinstance(node, dict):
            return False

        rules = node.get("rules")
        if isinstance(rules, list):
            mode = str(node.get("condition", "AND")).upper()
            outcomes = [_evaluate_ast(child) for child in rules]
            if not outcomes:
                return False
            return all(outcomes) if mode == "AND" else any(outcomes)

        try:
            return _evaluate_rule(node)
        except Exception as e:
            logger.error(f"[IF/ELSE] Błąd ewaluacji reguły: {e}")
            return False

    legacy_variable = config.get("variable")
    legacy_operator = config.get("operator", "equals")
    legacy_value = config.get("value")
    legacy_tree = {
        "condition": "AND",
        "rules": [
            {
                "field": legacy_variable,
                "operator": legacy_operator,
                "value": legacy_value,
                "value_type": "auto",
            }
        ],
    }

    tree = config.get("rule_tree") or config.get("ast") or legacy_tree
    result = _evaluate_ast(tree)

    logger.info(f"[IF/ELSE] Wynik ewaluacji AST: {result}")

    return {
        "condition_met": result,
        "evaluation_mode": "ast",
    }


async def execute_db_insert(config: dict[str, Any], input_data: dict[str, Any]) -> dict[str, Any]:
    """Symulacja zapisu do bazy danych"""
    table = config.get("table", "unknown_table")

    logger.info(f"[DB] Zapisuję do tabeli '{table}' rekord: '{input_data}'")

    return {"status": "inserted", "table": table, "inserted_record": input_data}


async def execute_http_request(config: dict[str, Any], input_data: dict[str, Any]) -> dict[str, Any]:
    """Węzeł HTTP wspierający zoptymalizowane struktury JSON oraz dynamiczne formularze."""
    raw_url = config.get("url", "")
    method = config.get("method", "GET").upper()

    if not raw_url:
        raise ValueError("Krok przerwany: Brak podanego adresu URL w konfiguracji węzła HTTP.")

    url = inject_variables(raw_url, input_data)

    headers = {}
    headers_config = config.get("headers", {})
    if isinstance(headers_config, dict):
        for k, v in headers_config.items():
            if k.strip():
                headers[k.strip()] = inject_variables(str(v), input_data)
    elif isinstance(headers_config, list):  # Legacy fallback dla starszych procesów
        for h in headers_config:
            k = h.get("key", "").strip()
            v = h.get("value", "")
            if k:
                headers[k] = inject_variables(str(v), input_data)
    elif isinstance(headers_config, str) and headers_config.strip():
        try:
            headers_parsed = json.loads(inject_variables(headers_config, input_data))
            if isinstance(headers_parsed, dict):
                headers = headers_parsed
        except json.JSONDecodeError:
            pass

    params = {}
    params_config = config.get("query_params", {})
    if isinstance(params_config, dict):
        for k, v in params_config.items():
            if k.strip():
                params[k.strip()] = inject_variables(str(v), input_data)
    elif isinstance(params_config, list): # Legacy fallback
        for p in params_config:
            k = p.get("key", "").strip()
            v = p.get("value", "")
            if k:
                params[k] = inject_variables(str(v), input_data)

    body_type = config.get("body_type", "json").lower()
    body_config = config.get("body", {})
    
    json_body = None
    data_body = None
    content_body = None

    if method in ["POST", "PUT", "PATCH", "DELETE"]:
        if body_type == "json":
            if isinstance(body_config, dict):
                json_body = {}
                for k, v in body_config.items():
                    if k.strip():
                        if isinstance(v, (int, float, bool, dict, list)):
                            json_body[k.strip()] = v
                        elif isinstance(v, str):
                            json_body[k.strip()] = inject_variables(v, input_data)
                        else:
                            json_body[k.strip()] = inject_variables(str(v), input_data)
            elif isinstance(body_config, list): # Legacy fallback dla typowanych pól w arrayach
                json_body = {}
                for b in body_config:
                    k = b.get("key", "").strip()
                    v = b.get("value", "")
                    target_type = b.get("type", "string").lower()
                    
                    if k:
                        injected_val = inject_variables(str(v), input_data)
                        try:
                            if target_type == "int":
                                json_body[k] = int(injected_val)
                            elif target_type == "float":
                                json_body[k] = float(injected_val)
                            elif target_type in ["bool", "boolean"]:
                                json_body[k] = injected_val.lower() in ['true', '1', 'yes', 't']
                            else:
                                json_body[k] = injected_val
                        except ValueError:
                            json_body[k] = injected_val
                            
        elif body_type == "form-data" and isinstance(body_config, list):
            data_body = {}
            for b in body_config:
                k = b.get("key", "").strip()
                v = b.get("value", "")
                if k:
                    data_body[k] = inject_variables(str(v), input_data)
                    
        elif body_type == "raw" and isinstance(body_config, str):
            content_body = inject_variables(body_config, input_data)
            
        elif isinstance(body_config, str) and body_config.strip():
             try:
                 json_body = json.loads(inject_variables(body_config, input_data))
             except:
                 content_body = inject_variables(body_config, input_data)

    logger.info(f"[HTTP REQUEST] {method} -> {url}")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method, 
                url, 
                params=params,
                headers=headers, 
                json=json_body,
                data=data_body,
                content=content_body
            )

            try:
                response_body = response.json()
            except Exception:
                response_body = response.text

            return {
                "status_code": response.status_code,
                "body": response_body,
                "headers": dict(response.headers),
                "request_url": str(response.url)
            }
            
    except httpx.RequestError as exc:
        logger.error(f"[HTTP REQUEST] Błąd połączenia z {url}: {exc}")
        raise ValueError(f"Błąd sieciowy podczas komunikacji z zewnętrznym API: {exc}")

async def execute_send_email(
    config: dict[str, Any], input_data: dict[str, Any], db: AsyncSession = None
) -> dict[str, Any]:
    """Wysyłka email"""
    if not db:
        raise ValueError("Brak połączenia z bazą danych")

    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == "smtp_profile")
    )
    setting = result.scalar_one_or_none()

    if not setting or not setting.value:
        raise ValueError("Skonfiguruj profil SMTP w ustawieniach!")

    smtp_config = setting.value
    server = smtp_config.get("server")
    port = int(smtp_config.get("port", 587))
    login = smtp_config.get("login")
    raw_password = smtp_config.get("password", "")
    password = decrypt_value(raw_password) if raw_password else None

    recipient = config.get("recipient", "example@example.com")
    subject = config.get("subject", "Temat")
    body = config.get("body", "Treść")

    logger.info(
        f"[EMAIL] Rozpoczynam wysyłkę na: {recipient} | Temat: {subject} przez serwer {server}:{port}"
    )

    message = EmailMessage()
    message["From"] = login
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)

    try:
        await aiosmtplib.send(
            message,
            hostname=server,
            port=port,
            username=login,
            password=password,
            start_tls=True,
        )

        logger.info("[EMAIL] Wysłano pomyślnie!")
        return {"status": "email_sent", "recipient": recipient, "subject": subject}
    except Exception as e:
        logger.error(f"[EMAIL] Błąd wysyłki SMTP: {str(e)}")
        raise ValueError(f"Wsytąpił błąd podczas wysyłania e-maila: {str(e)}")


async def execute_delay(
    config: dict[str, Any], input_data: dict[str, Any]
) -> dict[str, Any]:
    """Wstrzymujemy wykonanie procesu na podany czas"""
    try:
        value = float(config.get("value", 0))
    except ValueError:
        value = 0

    unit = config.get("unit", "minutes")

    if unit == "seconds":
        delta = timedelta(seconds=value)
    elif unit == "hours":
        delta = timedelta(hours=value)
    elif unit == "days":
        delta = timedelta(days=value)
    else:
        delta = timedelta(minutes=value)

    target_time = datetime.now(timezone.utc) + delta

    logger.info(
        f"[DELAY] Proces uśpiony. Zaplanowano wznowienie na : {target_time.isoformat()}"
    )

    return {
        "__pause__": True,
        "resume_at": target_time.isoformat(),
        "original_input": input_data,
    }


async def execute_json_transform(
    config: dict[str, Any], input_data: dict[str, Any]
) -> dict[str, Any]:
    """Filtracja danych - przepuszcza tylko wybrane klucze JSON"""
    keys_str = config.get("keys", "")

    if not keys_str.strip():
        return input_data

    allowed_keys = [k.strip() for k in keys_str.split(",") if k.strip()]

    logger.info(f"[JSON TRANSFORM] Filtrowanie kluczy: {allowed_keys}")

    filtered_data = {k: input_data.get(k) for k in allowed_keys if k in input_data}

    return filtered_data


async def execute_switch(
    config: dict[str, Any], input_data: dict[str, Any]
) -> dict[str, Any]:
    """Wielokrotne rozgałęzienie w oparciu o warunki logiczne"""
    variable = config.get("variable", "")
    cases = config.get("cases", [])

    actual_value = input_data.get(variable)

    for case in cases:
        operator = case.get("operator", "equals")
        target_value = case.get("value", "")

        result = False

        try:
            if operator == "equals":
                result = str(actual_value) == str(target_value)
            elif operator == "greater":
                result = str(actual_value) > str(target_value)
            elif operator == "less":
                result = str(actual_value) < str(target_value)
            elif operator == "contains":
                result = str(target_value).lower() in str(actual_value).lower()
        except (ValueError, TypeError) as e:
            logger.error(f"[SWITCH] Błąd ewaluacji warunku: {e}")

        if result:
            logger.info(
                f"[SWITCH] Zmienna '{actual_value}' spełnia warunek '{target_value}'. Wybieram wyjście: {case.get('id')}"
            )
            return {
                "status": "success",
                "selected_handle": case.get("id"),
                "payload": input_data,
            }

    logger.info(
        f"[SWITCH] Zmienna '{actual_value}' nie spełnia adnego z warunków. Wybieram wyjście 'default'"
    )
    return {"status": "success", "selected_handle": "default", "payload": input_data}


async def execute_for_each(
    config: dict[str, Any], input_data: dict[str, Any]
) -> dict[str, Any]:
    """Węzeł rozgałęziający"""
    array_key = config.get("array_variable", "")
    target_workflow_id = config.get("target_workflow_id")

    if not array_key or not target_workflow_id:
        raise ValueError("Skonfiguruj węzeł: brak zmiennej lub id docelowego procesu!")

    items = input_data.get(array_key)
    if not isinstance(items, list):
        raise ValueError(f"Zmienna wejściowa '{array_key}' nie jest poprawną tablicą!")

    logger.info(
        f"[FOR EACH] Przygotowano {len(items)} elementów do iteracji na procesie {target_workflow_id}."
    )

    return {
        "__spawn_subworkflows__": True,
        "target_workflow_id": target_workflow_id,
        "items": items,
    }

async def execute_jira_create_ticket(config: dict[str, Any], input_data: dict[str, Any], db: AsyncSession = None) -> dict[str, Any]:
    """Węzeł tworzący ticket w Jira przy uyciu ADF"""
    if not db:
        raise ValueError("[JIRA] Brak połączenia z bazą danych")
    
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == "jira_profile"))
    setting = result.scalar_one_or_none()

    if not setting or not setting.value:
        raise ValueError("[JIRA] Skonfiguruj połączenie z Jira w zakładze ustawienia.")
    
    jira_config = setting.value
    domain = jira_config.get("domain")
    email = jira_config.get("email")
    raw_api_token = jira_config.get("api_token", "")
    api_token = decrypt_value(raw_api_token) if raw_api_token else None

    # Dynamiczne mapowanie wartości
    project_key = inject_variables(config.get("project_key", ""), input_data)
    issue_type = config.get("issue_type", "Task")
    summary = inject_variables(config.get("summary", ""), input_data)
    description_text = inject_variables(config.get("description", ""), input_data)

    if not all([domain, email, api_token, project_key, summary]):
        raise ValueError("[JIRA] Brak wymaganej konfiguracji dla węzła Jira!")
    
    jira = JiraClient(domain, email, api_token)

    payload = {
        "fields": {
            "project": {"key": project_key},
            "summary": summary,
            "issuetype": {"name": issue_type},
            "description": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": description_text}]
                    }
                ]
            }
        }
    }  

    logger.info(f"[JIRA] Tworzę zgłoszenie w projekcie: {project_key}: {summary}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(f"{jira.base_url}/issue", json=payload, headers=jira.headers)

        if response.status_code != 201:
            logger.error(f"[JIRA] Error {response.text}")
            raise ValueError(f"[JIRA] Api error: {response.status_code} - {response.text}")
        
        data = response.json()
        return {
            "issue_id": data["id"],
            "issue_key": data["key"],
            "url": f"https://{domain}/atlassian.net/browse/{data['key']}",
            "status": "created"
        }
    
async def execute_manual_approval(config: dict[str, Any], input_data: dict[str, Any]):
    """Węzeł wstrzymujący proces i oczekujący w tym czasie na ręczną akceptację uytkownika"""
    logger.info(f"[MANUAL APPROVAL] Proces wstrzymany. Oczkeuje na kliknięcie 'Akceptuj' w panelu Moje Procesy")

    return {
        "__pause__": True,
        "manual_approval": True,
        "original_input": input_data,
    }


async def execute_gemini_custom(
    config: dict[str, Any], input_data: dict[str, Any]
) -> dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("Brak zmiennej środowiskowej GEMINI_API_KEY (konfiguracja globalna).")

    prompt = config.get("prompt", "")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("Krok przerwany: Brak promptu w konfiguracji węzła Gemini (Własny Prompt).")

    final_prompt = inject_variables(prompt, input_data)

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = await model.generate_content_async(final_prompt)

        generated_text = getattr(response, "text", None)
        if not generated_text:
            raise ValueError("Gemini zwrócił pustą odpowiedź.")

        return {"generated_text": generated_text}
    except Exception as e:
        logger.error(f"[GEMINI CUSTOM] Błąd wywołania API: {e}", exc_info=True)
        raise


async def execute_gemini_template(
    config: dict[str, Any], input_data: dict[str, Any]
) -> dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("Brak zmiennej środowiskowej GEMINI_API_KEY (konfiguracja globalna).")

    template_type = config.get("template_type", "summarize")
    target_variable = config.get("target_variable", "")

    if not isinstance(target_variable, str) or not target_variable.strip():
        raise ValueError("Krok przerwany: Brak 'target_variable' w konfiguracji węzła Gemini (Szablon).")

    templates: dict[str, str] = {
        "summarize": "Jesteś asystentem. Zwięźle podsumuj poniższy tekst w 5-7 punktach.",
        "translate_en": "Przetłumacz poniższy tekst na naturalny język angielski (zachowaj sens i ton).",
        "extract_key_info": "Wyciągnij z poniższego tekstu kluczowe informacje w postaci listy punktów.",
        "fix_language": "Popraw błędy językowe i stylistyczne poniższego tekstu (bez zmiany znaczenia).",
        "extract_entities": "Wypisz encje (osoby, firmy, miejsca, daty, kwoty) znalezione w tekście w formacie JSON.",
    }

    system_prompt = templates.get(str(template_type), templates["summarize"])
    injected_input = inject_variables(target_variable, input_data)
    final_prompt = f"{system_prompt}\n\nTEKST:\n{injected_input}"

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = await model.generate_content_async(final_prompt)

        generated_text = getattr(response, "text", None)
        if not generated_text:
            raise ValueError("Gemini zwrócił pustą odpowiedź.")

        return {
            "generated_text": generated_text,
            "template_type": template_type,
        }
    except Exception as e:
        logger.error(f"[GEMINI TEMPLATE] Błąd wywołania API: {e}", exc_info=True)
        raise


RUNNERS_REGISTRY = {
    "webhook": execute_webhook,
    "slack_msg": execute_slack_msg,
    "if_else": execute_if_else,
    "db_insert": execute_db_insert,
    "http_request": execute_http_request,
    "send_email": execute_send_email,
    "delay": execute_delay,
    "json_transform": execute_json_transform,
    "switch": execute_switch,
    "for_each": execute_for_each,
    "jira_create_ticket": execute_jira_create_ticket,
    "manual_approval": execute_manual_approval,
    "gemini_custom": execute_gemini_custom,
    "gemini_template": execute_gemini_template,
}


async def run_node_task(
    subtype: str,
    config: dict[str, Any],
    input_data: dict[str, Any],
    db: AsyncSession = None,
) -> dict[str, Any]:
    """Otrzymuje typ klocka i uruchamia odpowiedniego runnera"""
    runner_func = RUNNERS_REGISTRY.get(subtype)

    if not runner_func:
        raise ValueError(f"Brak zdefiniowanego runnera dla klocka o typie: '{subtype}'")

    if subtype == "send_email":
        return await runner_func(config, input_data, db=db)
    else:
        return await runner_func(config, input_data)
