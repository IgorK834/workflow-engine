import logging
from typing import Any

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

RUNNERS_REGISTRY = {
    "webhook": execute_webhook,
    "slack_msg": execute_slack_msg,
    "if_else": execute_if_else,
    "db_insert": execute_db_insert
}

async def run_node_task(subtype: str, config: dict[str, Any], input_data: dict[str, Any]) -> dict[str, Any]:
    """Otrzymuje typ klocka i uruchamia odpowiedniego runnera"""
    runner_func = RUNNERS_REGISTRY.get(subtype)

    if not runner_func:
        raise ValueError(f"Brak zdefiniowanego runnera dla klocka o typie: '{subtype}'")
    
    return await runner_func(config, input_data)