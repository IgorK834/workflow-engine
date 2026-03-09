from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from ..database import get_db
from ..database import WorkflowCreate, WorkflowResponse
from ..models import Workflow

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
    await db.comit()
    await db.refresh(new_workflow)
    return new_workflow
