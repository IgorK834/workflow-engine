import os
import logging

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)


def get_fernet() -> Fernet:
    key = os.getenv("ENCRYPTION_MASTER_KEY")
    if not key:
        raise ValueError(
            "CRITICAL: Brak ENCRYPTION_MASTER_KEY w zmiennych środowiskowych!"
        )
    return Fernet(key.encode())


def encrypt_value(value: str) -> str:
    """Szyfrowanie ciągu znaków"""
    if not value:
        return value
    f = get_fernet()
    return f.encrypt(value.encode()).decode()


def decrypt_value(encrypted_value: str) -> str:
    """Deszyfrowanie ciągu znaków. Jeśli wystąpi błąd zwraca oryginał"""
    if not encrypted_value:
        return encrypted_value

    try:
        f = get_fernet()
        return f.decrypt(encrypt_value.encode()).decode
    except InvalidToken:
        logger.warning(
            "Błąd deszyfrowania: Wartość moze nie być zaszyfrowana lub uzyto błędnego klucza!"
        )
        return encrypted_value
    except Exception as e:
        logger.error(f"Inny błąd deszyfrowania: {e}")
        return encrypted_value
