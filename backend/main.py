import asyncio
import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from azure.monitor.opentelemetry import configure_azure_monitor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

from .database import engine, Base
from .api import workflows, settings
from .core.service_bus import start_message_listener
from .models import WorkflowExecution, ExecutionStatus, Workflow
from .core.engine import ExecutionEngine 
from .core.imap_worker import imap_listener_worker
from .core.scheduler import scheduler, sync_workflows_to_scheduler

logger = logging.getLogger(__name__)

load_dotenv()

if not os.getenv("ENCRYPTION_MASTER_KEY"):
    raise RuntimeError("CRITICAL ERROR: Brak ENCRYPTIO_MASTER_KEY!")

async def scheduler_worker():
    """Worker działający w tle by wybudzić opóźnione procesy."""
    while True:
        await asyncio.sleep(10)
        try:
            async with AsyncSession(engine) as session:
                now = datetime.now(timezone.utc)

                stmt = select(WorkflowExecution).options(selectinload(WorkflowExecution.workflow)).where(
                    WorkflowExecution.status == ExecutionStatus.PAUSED,
                    WorkflowExecution.resume_at <= now
                )

                result = await session.execute(stmt)
                executions = result.scalars().all()

                for exec_record in executions:
                    logger.info(f"[SCHEDULER] Wybudzanie procesu: {exec_record.id}")

                    exec_record.status = ExecutionStatus.RUNNING
                    exec_record.resume_at = None
                    session.add(exec_record)
                    await session.commit()

                    execution_engine = ExecutionEngine(session, exec_record.id)
                    graph_json = exec_record.workflow.graph_json

                    asyncio.create_task(execution_engine.run(graph_json))
        except Exception as e:
            logger.error(f"[Scheduler] Błąd podczas sprawdzania procesów do wybudzenia: {str(e)}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    worker_task = asyncio.create_task(start_message_listener())
    scheduler_task = asyncio.create_task(scheduler_worker())
    imap_task = asyncio.create_task(imap_listener_worker())

    scheduler.start()
    await sync_workflows_to_scheduler()
    
    yield
    
    worker_task.cancel()
    scheduler_task.cancel()
    imap_task.cancel()

    scheduler.shutdown()
    
    await engine.dispose()


app = FastAPI(
    title="Workflow Engine API",
    description="Rozproszony silnik automatyzacji procesów w architekturze asynchronicznej.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(workflows.router, prefix="/api/v1")
app.include_router(settings.router, prefix="/api/v1")


@app.get("/health", tags=["System"])
async def health_check():
    return {"status": "healthy", "service": "Workflow Engine ASGI"}


if os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING"):
    configure_azure_monitor()
    FastAPIInstrumentor.instrument_app(app)
    print("Azure Application Insights zintegrowane poprawnie!")
else:
    print("Brak APPLICATIONINSIGHTS_CONNECTION_STRING - telemetria wyłączona.")