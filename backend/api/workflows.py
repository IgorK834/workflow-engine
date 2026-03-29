from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import uuid

from ..database import get_db
from ..database import WorkflowCreate, WorkflowResponse, WorkflowExecutiveResponse
from ..models import Workflow, WorkflowExecution
from ..core.state_manager import StateManager

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
    """Inicjacja nowego wykonania procesu"""
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalar_one_or_none()

    if not workflow:
        raise HTTPException(status_code=404, detail="Nie znaleziono procesu o danym ID")
    
    state_manager = StateManager(db)
    execution = await state_manager.initialize_execution(workflow_id)

    return execution