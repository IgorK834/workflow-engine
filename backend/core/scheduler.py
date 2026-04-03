import uuid
import logging
import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

from ..database import engine
from ..models import Workflow, WorkflowExecution, ExecutionStatus
from .engine import ExecutionEngine

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

async def trigger_scheduled_workflow(workflow_id: uuid.UUID):
    """Funkcja wywoływana cyklicznie przez APScheduler dla danego procesu."""
    logger.info(f"[SCHEDULER] Uruchamiam cyklicznie proces: {workflow_id}")

    try:
        async with AsyncSession(engine) as session:
            # Sprawdzanie czy proces istnieje i jest aktywny
            stmt = select(Workflow).where(Workflow.id == workflow_id)
            result = await session.execute(stmt)
            workflow = result.scalar_one_or_none()

            if not workflow or not workflow.is_active:
                logger.info(f"[SCHEDULER] Proces {workflow_id} jest nieaktywny. Pomijam.")
                return
            
            # Tworzenie nowej historii uruchomienia
            execution = WorkflowExecution(workflow_id=workflow.id, status=ExecutionStatus.PENDING)

            session.add(execution)
            await session.commit()
            await session.refresh(execution)

            # Uruchomienie w tle ExecutionEngine
            engine_instance = ExecutionEngine(session, execution.id)
            asyncio.create_task(
                engine_instance.run(
                    workflow.graph_json,
                    initial_payload={"trigger_source": "schedule"}
                )
            )

    except Exception as e:
        logger.error(f"[SCHEDULE] Błąd podczas uruchamiania zaplanowanego zadania {workflow_id}: {e}")

async def sync_workflows_to_scheduler():
    """Odświeza plan na podstawie aktualnych aktywnych procesów w bazie."""
    scheduler.remove_all_jobs()

    try:
        async with AsyncSession(enigne) as session:
            stmt = select(Workflow).where(Workflow.is_active == True)
            result = await session.execute(stmt)
            active_workflows = result.scalars().all()

            jobs_added = 0
            for wf in active_workflows:
                graph = wf.graph_json
                nodes = graph.get("nodes", [])

                for node in nodes:
                    data_block = node.get("data", {})
                    if data_block.get("subtype") == "schedule":
                        config = data_block.get("config", {})
                        schedule_type = config.get("schedule_type", "interval")

                        trigger = None

                        # Obsłucha interwałów
                        if schedule_type == "interval":
                            try:
                                val = int(config.get("interval_value", 15))
                            except ValueError:
                                val = 15

                            unit = config.get("interval_unit", "minutes")
                            if unit == "minutes":
                                trigger = IntervalTrigger(minutes=val)
                            elif unit == "hours":
                                trigger = IntervalTrigger(hours=val)
                            elif unit == "days":
                                trigger = IntervalTrigger(days=val)
                            else:
                                trigger = IntervalTrigger(minutes=val)

                        # Obsługa wyrazeń cron
                        elif schedule_type == "cron":
                            cron_expr = config.get("cron_expression", "0 8 * * *")
                            try:
                                trigger = CronTrigger.from_crontab(cron_expr)
                            except Exception as e:
                                logger.error(f"[SCHEDULER] Niepoprawne wyrazenie cron '{cron_expr}' dla proce {wf.id}")
                                continue
                        
                        # Rejestracja zadania w APScheduler
                        if trigger:
                            scheduler.add_job(
                                trigger_scheduled_workflow,
                                trigger=trigger,
                                args=[wf.id],
                                id=str(wf.id),
                                replace_existing=True
                            )
                            jobs_added += 1
                            break

            logger.info(f"[SCHEDULER] Zsynchronizowano pomyślnie! Aktywne zadania (Cron/Interval): {jobs_added}")
    except Exception as e:
        logger.error(f"[SCHEDULER] Błąd synchronizacji zadań z bazą: {e}")

