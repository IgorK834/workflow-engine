import logging
import asyncio
import httpx
import json
import aiosmtplib

from email.message import EmailMessage
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Any

from ..models import SystemSetting

# Konfiguracja loggera
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def execute_webhook(config: dict[str, Any], input_data: dict[str, Any]) -> dict [str, Any]:
    logger.info(f"Odebrano dane z Webhooka: {input_data}")
    return input_data

async def execute_slack_msg(config: dict[str, Any], input_data: dict[str, Any]) -> dict [str, Any]:
    """Symulacja wysłania wiadomości na slacka"""
    channel = config.get("channel", "#general")
    message = config.get("message", "Pusta wiadomość")

    logger.info(f"[SLACK] Wysyłam na kanał {channel}: {message}")

    return {
        "status": "sent",
        "channel": channel,
        "message": message,
        "provider": "slack"
    } 

async def execute_if_else(config: dict[str, Any], input_data: dict[str, Any]) -> dict [str, Any]:
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

    logger.info(f"[IF/ELSE] Sprawdzam: {actual_value} {operator} {target_value} -> Wynik: {result}")

    return {
        "condition_met": result,
        "evaluated_variable": variable,
        "actual_value": actual_value
    }

async def execute_db_insert(config: dict[str, Any], input_data: dict[str, Any]) -> dict [str, Any]:
    """Symulacja zapisu do bazy danych"""
    table = config.get("table", "unknown_table")

    logger.info(f"[DB] Zapisuję do tabeli '{table}' rekord: '{input_data}'")

    return {
        "status": "inserted",
        "table": table,
        "inserted_record": input_data
    }

async def execute_http_request(config: dict[str, Any], input_data: dict[str, Any]) -> dict[str, Any]:
    """Wysyła request do HTTP do zewnętrznego API"""
    url = config.get("url")
    method = config.get("method", "GET").upper()
    headers_str = config.get("headers", {})
    body_str = config.get("body", "{}")

    if not url:
        raise ValueError("URL jest wymagany dla tego węzła")
    
    try:
        headers = json.loads(headers_str) if headers_str.strip() else {}
        body = json.loads(body_str) if body_str.strip() else {}
    except json.JSONDecodeError as e:
        raise ValueError(f"Błąd parsowania JSON w konfiguracji HTTP: {e}")
    
    logger.info(f"[HTTP REQUEST] {method} -> {url}")

    async with httpx.AsyncClient() as client:
        if method in ["POST", "PUT", "PATCH"]:
            response = await client.request(method, url, headers=headers, json=body)
        else:
            response = await client.response(method, url, headers=headers)

        try:
            response_data = response.json()
        except Exception:
            response_data = response.text

        return {
            "status_code": response.status_code,
            "response": response_data,
            "request_url": url
        }
    
async def execute_send_email(config: dict[str, Any], input_data: dict[str, Any], db: AsyncSession = None) -> dict[str, Any]:
    """Wysyłka email"""
    if not db:
        raise ValueError("Brak połączenia z bazą danych")
    
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == "smtp_profile"))
    setting = result.scalar_one_or_none()

    if not setting or not setting.value:
        raise ValueError("Skonfiguruj profil SMTP w ustawieniach!")
    
    smtp_config = setting.value
    server = smtp_config.get("server")
    port = int(smtp_config.get("port", 587))
    login = smtp_config.get("login")
    password = smtp_config.get("password")

    recipient = config.get("recipient", "example@example.com")
    subject = config.get("subject", "Temat")
    body = config.get("body", "Treść")

    logger.inf(f"[EMAIL] Rozpoczynam wysyłkę na: {recipient} | Temat: {subject} przez serwer {server}:{port}")

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

async def execute_delay(config: dict[str, Any], input_data: dict[str, Any]) -> dict[str, Any]:
    """Wstrzymujemy wykonanie procesu na podany czas"""
    try:
        minutes = float(config.get("minutes", 0))
    except ValueError:
        minutes = 0
        
    logger.info(f"[DELAY] Usypiam proces na {minutes} minut...")
    
    await asyncio.sleep(minutes)

    logger.info(f"[DELAY] Wznowiono proces.")

    return input_data

async def execute_json_transform(config: dict[str, Any], input_data: dict[str, Any]) -> dict[str, Any]:
    """Filtracja danych - przepuszcza tylko wybrane klucze JSON"""
    keys_str = config.get("keys", "")

    if not keys_str.strip():
        return input_data
    
    allowed_keys = [k.strip() for k in keys_str.split(",") if k.strip()]

    logger.info(f"[JSON TRANSFORM] Filtrowanie kluczy: {allowed_keys}")

    filtered_data = {k: input_data.get(k) for k in allowed_keys if k in input_data}

    return filtered_data

RUNNERS_REGISTRY = {
    "webhook": execute_webhook,
    "slack_msg": execute_slack_msg,
    "if_else": execute_if_else,
    "db_insert": execute_db_insert,
    "http_request": execute_http_request,
    "send_email": execute_send_email,
    "delay": execute_delay,
    "json_tranform": execute_json_transform
}

async def run_node_task(subtype: str, config: dict[str, Any], input_data: dict[str, Any]) -> dict[str, Any]:
    """Otrzymuje typ klocka i uruchamia odpowiedniego runnera"""
    runner_func = RUNNERS_REGISTRY.get(subtype)

    if not runner_func:
        raise ValueError(f"Brak zdefiniowanego runnera dla klocka o typie: '{subtype}'")
    
    if subtype == "send_email":
        return await runner_func(config, input_data, db=db)
    else:
        return await runner_func(config, input_data)
    
    return await runner_func(config, input_data)