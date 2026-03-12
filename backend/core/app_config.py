import os
import json
from azure.appconfiguration.aio import AzureAppConfigurationClient

AZURE_APP_CONFIG_CONN_STR = os.getenv("AZURE_APP_CONFIG_CONNECTION_STRING")


class FeatureFlags:
    """Słownik nazw flag"""

    CIRCUIT_BREAKER_GLOBAL = "circuit_breaker_global"
    CIRCUIT_BREAKER_SLACK = "circuit_breaker_slack"


async def is_feature_enabled(flag_name: str, default: bool = True) -> bool:
    """
    Pobieramy status Feature Flag z Azure App Configuration.
    """
    if not AZURE_APP_CONFIG_CONN_STR:
        return default
    try:
        async with AzureAppConfigurationClient.from_connection_string(
            AZURE_APP_CONFIG_CONN_STR
        ) as client:
            setting = await client.get_configuration_setting(
                key=f".appconfig.featurefla.{flag_name}"
            )
            flag_data = json.loads(setting.value)
            return flag_data.get("enabled", default)
    except Exception as e:
        print(f"[AppConfig] Błąd pobierania flagi: '{flag_name}': {e}")
        return default
