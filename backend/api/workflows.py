from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import uuid

from ..core.engine import ExecutionEngine
from ..database import get_db
from ..database import WorkflowCreate, WorkflowResponse, WorkflowExecutiveResponse
from ..models import Workflow, WorkflowExecution
from ..core.state_manager import StateManager
from ..core.scheduler import sync_workflows_to_scheduler

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.get("/", response_model=list(WorkflowResponse))
async def list_workflows(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Workflow))
    return result.scalars().all()


@router.post("/", response_model=WorkflowResponse)
async def create_workflow(
    workflow_in: WorkflowCreate, db: AsyncSession = Depends(get_db)
):
    new_workflow = Workflow(
        name=workflow_in.name,
        description=workflow_in.description,
        graph_json=workflow_in.graph_json.model_dump(),
    )

    db.add(new_workflow)
    await db.commit()
    await db.refresh(new_workflow)
    await sync_workflows_to_scheduler()
    return new_workflow

@router.get("/executions", response_model=list[WorkflowExecutiveResponse])
async def list_executions(db: AsyncSession = Depends(get_db)):
    """Pobiera historie wszystkich uruchomień procesów"""
    result = await db.execute(
        select(WorkflowExecution).order_by(WorkflowExecution.started_at.desc())
    )
    return result.scalars().all()

@router.post("/{workflow_id}/execute", response_model=WorkflowExecutiveResponse)
async def execute_workflow(workflow_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Inicjalizacja nowego wykonania procesu i odpalenie silnika"""
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalar_one_or_none()

    if not workflow:
        raise HTTPException(status_code=404, detail="Nie znaleziono procesu o podanym ID")
    
    state_manager = StateManager(db)
    execution = await state_manager.initialize_execution(workflow_id)

    engine = ExecutionEngine(db, execution.id)

    sample_payload = {"kwota_zamowienia": 150, "klient": "Jan Kowalski"}

    await engine.run(workflow.graph_json, initial_payload=sample_payload)

    await db.refresh(execution)

    return execution

@router.post("/{workflow_id}/trigger")
async def trigger_webhook(workflow_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)):
    """Publiczny endpoint nasłuchujący na dane"""
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalar_one_or_none()

    if not workflow:
        raise HTTPException(status_code=404, detail="Nie znaleziono procesu o podanym ID")
    
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    state_manager = StateManager(db)
    execution = await state_manager.initialize_execution(workflow_id)

    engine = ExecutionEngine(db, execution.id)

    await engine.run(workflow.graph_json, initial_payload=payload)

    await db.refresh(execution)
    return {"status": "success", "execution_id": str(execution.id), "payload_received": payload}