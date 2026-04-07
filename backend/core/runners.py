import logging
import httpx
import json
import aiosmtplib
import re
import base64

from email.message import EmailMessage
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Any
from datetime import datetime, timezone, timedelta

from ..models import SystemSetting
from .security import decrypt_value

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
    variable = config.get("variable")
    operator = config.get("operator")
    target_value = config.get("value")
    actual_value = config.get("variable")

    result = False
    try:
        if operator == "equals":
            result = str(actual_value) == str(target_value)
        elif operator == "greater":
            result = float(actual_value) > float(target_value)
        elif operator == "less":
            result = float(actual_value) < float(target_value)
        elif operator == "contains":
            result = str(target_value).lower() in str(actual_value).lower()
    except (ValueError, TypeError) as e:
        logger.error(f"[IF/ELSE] Błąd warunku! {e}")
        result = False

    logger.info(
        f"[IF/ELSE] Sprawdzam: {actual_value} {operator} {target_value} -> Wynik: {result}"
    )

    return {
        "condition_met": result,
        "evaluated_variable": variable,
        "actual_value": actual_value,
    }


async def execute_db_insert(config: dict[str, Any], input_data: dict[str, Any]) -> dict[str, Any]:
    """Symulacja zapisu do bazy danych"""
    table = config.get("table", "unknown_table")

    logger.info(f"[DB] Zapisuję do tabeli '{table}' rekord: '{input_data}'")

    return {"status": "inserted", "table": table, "inserted_record": input_data}


async def execute_http_request(config: dict[str, Any], input_data: dict[str, Any]) -> dict[str, Any]:
    """Węzeł HTTP wspierający dynamiczne formularze (Klucz-Wartość) i różne typy Body."""
    raw_url = config.get("url", "")
    method = config.get("method", "GET").upper()

    if not raw_url:
        raise ValueError("Krok przerwany: Brak podanego adresu URL w konfiguracji węzła HTTP.")

    url = inject_variables(raw_url, input_data)

    headers = {}
    headers_config = config.get("headers", [])
    if isinstance(headers_config, list):
        for h in headers_config:
            k = h.get("key", "").strip()
            v = h.get("value", "")
            if k:
                headers[k] = inject_variables(str(v), input_data)
    elif isinstance(headers_config, str) and headers_config.strip():
        try:
            headers = json.loads(inject_variables(headers_config, input_data))
        except json.JSONDecodeError:
            pass

    params = {}
    params_config = config.get("query_params", [])
    if isinstance(params_config, list):
        for p in params_config:
            k = p.get("key", "").strip()
            v = p.get("value", "")
            if k:
                params[k] = inject_variables(str(v), input_data)

    body_type = config.get("body_type", "json").lower()
    body_config = config.get("body", [])
    
    json_body = None
    data_body = None
    content_body = None

    if method in ["POST", "PUT", "PATCH", "DELETE"]:
        if body_type == "json" and isinstance(body_config, list):
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
