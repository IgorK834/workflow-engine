import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import enigne, Base
from .api import workflows
from .core.service_bus import start_message_listener


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with enigne.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    worker_task = asyncio.create_task(start_message_listener())
    yield
    worker_task.cancel()
    await enigne.dispose()


app = FastAPI(
    title="Workflow Engine API",
    description="Rozproszony silnik automatyzacji procesów w architektórze asynchronicznej.",
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


@app.get("/health", tags=["System"])
async def health_check():
    return {"status": "healthy", "service": "Workflow Engine ASGI"}
