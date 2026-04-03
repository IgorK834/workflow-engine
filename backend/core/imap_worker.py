import asyncio
import logging
import email
import aioimaplib

from email.policy import default
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import engine
from ..models import SystemSetting, Workflow, WorkflowExecution, ExecutionStatus
from .security import decrypt_value
from .engine import ExecutionEngine

logger = logging.getLogger(__name__)

def extract_plain_text_body(msg) -> str:
    """Ekstrakcja czystego body z wiadomości html."""
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    body = payload.decode(part.get_content_charset() or 'utf-8', errors='ignore')
                    break
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode(msg.get_content_charset() or 'utf-8', errors='ignore')
    
    return body

async def impa_listener_worker():
    """Worker srawdzający skrzynkę i wyzwalający procesy."""
    logger.info("[IMAP WORKER] Zainicjowano workera odbierającego pocztę.")

    while True:
        await asyncio.sleep(30)

        try:
            async with AsyncSession(engine) as session:
                # Pobieranie ustawień IMAP z bazy
                stmt = select(SystemSetting).where(SystemSetting.key == "imap_profile")
                result = await session.execute(stmt)
                setting = result.scalar_one_or_none()

                if not setting or not setting.value or not setting.value.get("login"):
                    continue

                config = setting.value
                server = config.get("server")
                port = int(config.get("port", 993))
                login_user = config.get("login")
                raw_password = config.get("password", "")

                if not raw_password:
                    continue

                password = decrypt_value(raw_password)

                # Połączenie z IMAP
                client = aioimaplib.IMAP4_SSL(host=server, port=port)
                await client.wait_hello_from_server()
                await client.login(login_user, password)
                await client.select('INBOX')

                # Wyszukiwanie nieprzeczytanych wiadomości
                status, data = await client.search('UNSEEN')
                if status != 'OK' or not data[0]:
                    await client.logout()
                    continue

                msg_nums = data[0].split()

                if not msg_nums:
                    await client.logout()
                    continue

                logger.info(f"[IMAP WORKER] Znaleziono {len(msg_nums)} nowych wiadomości.")

                # Pobieranie aktywnych procesów z bazy
                wf_stmt = select(Workflow).where(Workflow.is_active == True)
                wf_result = await session.execute(wf_stmt)
                active_worfklows = wf_result.scalars().all()

                # Przetwarzanie wiadomości w pętli
                for num in msg_nums:
                    status, msg_data = await client.fetch(num, '(RFC822)')
                    if status != 'OK':
                        continue

                    raw_email = msg_data[1]
                    msg = email.message_from_bytes(raw_email, policy=default)

                    sender = str(msg.get("From", ""))
                    subject = str(msg.get("Subject", ""))
                    body = extract_plain_text_body(msg)

                    payload = {
                        "email_from": sender,
                        "email_subject": subject,
                        "email_body": body
                    } 

                    # Sprawdzenie czy któryś workflow nie nasłuchuje na ten adres email
                    for wf in active_worfklows:
                        graph = wf.graph_json
                        nodes = graph.get("nodes", [])

                        for node in nodes:
                            data_block = node.get("data", {})
                            if data_block.get("subtype") == "receive_email":
                                node_config = data_block.get("config", {})

                                from_filter = node_config.get("from_filter", "").strip().lower()
                                subject_filter = node_config.get("subject_filter", "").strip().lower()

                                # Sprawdzanie warunków
                                match_from = not from_filter or from_filter in sender.lower()
                                match_subject = not subject_filter or subject_filter in subject.lower()

                                if match_from and match_subject:
                                    logger.info(f"[IMAP WOKRER] Odpalanie procesu '{wf.name}' dla maila od {sender}")

                                    # Utworzenie wykonania
                                    execution = WorkflowExecution(workflow_id=wf.id, status=ExecutionStatus.RUNNING)
                                    
                                    session.add(execution)
                                    await session.commit()
                                    await session.refresh(execution)

                                    # Uruchomienie Engine w tle
                                    engine_instance = ExecutionEngine(session, execution.id)
                                    asyncio.create_task(engine_instance.run(graph, initial_payload=payload))
                    
                    # Oznaczenie wiadomości jako przeczytanej
                    await client.store(num, '+FLAGS', r'\SEEN')

                await client.logout()

        except Exception as e:
            logger.error(f"[IMAP WORKER] Wystąpił błąd podczas odbierania poczty: {e}")