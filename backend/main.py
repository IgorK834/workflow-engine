import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

from azure.monitor.opentelemetry import configure_azure_monitor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

from .database import engine, Base
from .api import workflows, settings
from .core.service_bus import start_message_listener

load_dotenv()

if not os.getenv("ENCRYPTION_MASTER_KEY"):
    raise RuntimeError("CRITICAL ERROR: Brak ENCRYPTIO_MASTER_KEY!")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    worker_task = asyncio.create_task(start_message_listener())
    yield
    worker_task.cancel()
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
