import os
import json
import asyncio
from typing import Any
from azure.servicebus.aio import ServiceBusClient
from azure.servicebus import ServiceBusMessage

# Pobieramy konfigurację ze zmiennych środowiskowych
CONNECTION_STR = os.getenv("SERVICEBUS_CONNECTION_STR")
QUEUE_NAME = os.getenv("SERVICEBUS_QUEUE_NAME")


async def send_task_to_queue(task_data: dict[str, Any]) -> None:
    """
    Wysyła zadanie do kolejki Service Bus.
    Azure SDK automatycznie stosuje Retry Policy i Exponential Backoff.
    """

    if not CONNECTION_STR:
        print(
            f"[OSTRZEŻENIE] Brak konfiguracji Service Bus. Pomijam wysłanie zadania: {task_data}"
        )
        return

    async with ServiceBusClient.from_connection_string(CONNECTION_STR) as client:
        async with client.get_queue_sender(queue_name=QUEUE_NAME) as sender:
            message = ServiceBusMessage(json.dumps(task_data))
            await sender.send_messages(message)
            print(f"Wysłano zadanie do kolejki: {task_data}")


async def process_message(msg: ServiceBusMessage) -> bool:
    """Symulacja przetwarzania ciękiego zadania"""
    try:
        task_data = json.loads(str(msg))
        print(f"Przetwarzanie zadania: {task_data}")
        # Tutaj w przyszłości podepniemy State Manager i wykonanie konkretnego skryptu/API
        await asyncio.sleep(2)
        print(f"Zakończono przetwarzanie zadania: {task_data}")
        return True
    except Exception as e:
        print(f"Wystąpił błąd podczas przetwarzania zadania: {e}")
        return False


async def start_message_listener() -> None:
    """
    Asynchroniczny worker działający w ętli.
    Słucha i pobiera nowe wiadomości z kolejki
    """
    if not CONNECTION_STR:
        print(
            "[Service Bus Worker] Brak połączenia z Azure. Worker nasłuchujący jest wyłączony."
        )
        return
    print(f"[Service Bus Worker] Uruchomiono naskluchiwanie na kolejce: {QUEUE_NAME}")

    try:
        async with ServiceBusClient.from_connection_string(
            conn_str=CONNECTION_STR
        ) as client:
            async with client.get_queue_receiver(
                queue_name=QUEUE_NAME, prefetch_count=10
            ) as receiver:
                async for msg in receiver:
                    # Przetwarzanie wiadomości
                    success = await process_message(msg)

                    if success:
                        await receiver.complete_message(msg)
                    else:
                        await receiver.abandon_message(msg)
    except asyncio.CancelledError:
        print("[Service Bus Worker] Worker został zatrzymany.")
    except Exception as e:
        print(f"[Service Bus Worker] Wystąpił błąd: {e}")
