from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, case
import uuid
import asyncio

from ..core.engine import ExecutionEngine
from ..database import get_db
from ..schemas import WorkflowCreate, WorkflowResponse, WorkflowExecutiveResponse
from ..models import Workflow, WorkflowExecution
from ..core.state_manager import StateManager
from ..core.scheduler import sync_workflows_to_scheduler
from ..core.security import decrypt_value
from ..core.runners import JiraClient
from ..models import SystemSetting, ExecutionStatus, ExecutionStep

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.get("/", response_model=list[WorkflowResponse])
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
        raise HTTPException(
            status_code=404, detail="Nie znaleziono procesu o podanym ID"
        )

    state_manager = StateManager(db)
    execution = await state_manager.initialize_execution(workflow_id)

    engine = ExecutionEngine(db, execution.id)

    sample_payload = {"kwota_zamowienia": 150, "klient": "Jan Kowalski"}

    await engine.run(workflow.graph_json, initial_payload=sample_payload)

    await db.refresh(execution)

    return execution


@router.post("/{workflow_id}/trigger")
async def trigger_webhook(
    workflow_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db)
):
    """Publiczny endpoint nasłuchujący na dane"""
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalar_one_or_none()

    if not workflow:
        raise HTTPException(
            status_code=404, detail="Nie znaleziono procesu o podanym ID"
        )

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    state_manager = StateManager(db)
    execution = await state_manager.initialize_execution(workflow_id)

    engine = ExecutionEngine(db, execution.id)

    await engine.run(workflow.graph_json, initial_payload=payload)

    await db.refresh(execution)
    return {
        "status": "success",
        "execution_id": str(execution.id),
        "payload_received": payload,
    }


@router.put("/{workflow_id}/publish", response_model=WorkflowResponse)
async def publish_workflow(workflow_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Publikuje proces (zmienia is_active na True)"""
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalar_one_or_none()

    if not workflow:
        raise HTTPException(
            status_code=404, detail="Nie znaleziono procesu o podanym ID"
        )

    workflow.is_active = True

    await db.commit()
    await db.refresh(workflow)
    await sync_workflows_to_scheduler()

    return workflow


@router.patch("/{workflow_id}/toggle", response_model=WorkflowResponse)
async def toggle_workflow(workflow_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Zmienia status procesu (Stop/Wznów) poprzez przełączenie flagi is_active."""
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalar_one_or_none()

    if not workflow:
        raise HTTPException(status_code=404, detail="Nie znaleziono procesu o podanym ID")

    workflow.is_active = not bool(workflow.is_active)
    await db.commit()
    await db.refresh(workflow)
    await sync_workflows_to_scheduler()

    return workflow

@router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Usuwa proces z bazy danych"""
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    workflow = result.scalar_one_or_none()

    if not workflow:
        raise HTTPException(status_code=404, detail="Nie znaleziono procesu o podanym ID")
    
    await db.delete(workflow)
    await db.commit()
    await sync_workflows_to_scheduler()

    return {"status": "deleted"}


@router.get("/stats")
async def get_workflows_stats(days: int = 7, db: AsyncSession = Depends(get_db)):
    """Proste statystyki wykonań z ostatnich dni (pod analitykę)."""
    safe_days = max(1, min(int(days), 90))

    # Grupowanie po dniu na podstawie started_at
    day_bucket = func.date_trunc("day", WorkflowExecution.started_at).label("day")

    stmt = (
        select(
            day_bucket,
            func.count(WorkflowExecution.id).label("total"),
            func.sum(case((WorkflowExecution.status == ExecutionStatus.COMPLETED, 1), else_=0)).label(
                "completed"
            ),
            func.sum(case((WorkflowExecution.status == ExecutionStatus.FAILED, 1), else_=0)).label("failed"),
            func.sum(case((WorkflowExecution.status == ExecutionStatus.PAUSED, 1), else_=0)).label("paused"),
            func.sum(case((WorkflowExecution.status == ExecutionStatus.RUNNING, 1), else_=0)).label("running"),
        )
        .where(WorkflowExecution.started_at >= func.now() - func.make_interval(days=safe_days))
        .group_by(day_bucket)
        .order_by(day_bucket.desc())
    )

    result = await db.execute(stmt)
    rows = result.all()

    return {
        "days": safe_days,
        "series": [
            {
                "day": (r.day.isoformat() if getattr(r, "day", None) else None),
                "total": int(r.total or 0),
                "completed": int(r.completed or 0),
                "failed": int(r.failed or 0),
                "paused": int(r.paused or 0),
                "running": int(r.running or 0),
            }
            for r in rows
        ],
    }


@router.get("/logs")
async def get_workflows_logs(limit: int = 50, db: AsyncSession = Depends(get_db)):
    """Najnowsze zdarzenia z tabeli ExecutionStep (pod monitoring/analitykę)."""
    safe_limit = max(1, min(int(limit), 200))

    result = await db.execute(
        select(ExecutionStep)
        .order_by(ExecutionStep.started_at.desc())
        .limit(safe_limit)
    )
    steps = result.scalars().all()

    return {
        "limit": safe_limit,
        "items": [
            {
                "id": str(s.id),
                "execution_id": str(s.execution_id),
                "node_id": s.node_id,
                "status": (s.status.value if hasattr(s.status, "value") else str(s.status)),
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "finished_at": s.finished_at.isoformat() if s.finished_at else None,
                "error_message": s.error_message,
            }
            for s in steps
        ],
    }

@router.get("/nodes/jira/projects")
async def fetch_jira_projects(db: AsyncSession = Depends(get_db)):
    """Pobieranie listy projektów z Jira poprzez dane wczytane z ustawień uytkownika."""
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == "jira_profile"))
    setting = result.scalar_one_or_none()

    if not setting or not setting.value:
        raise HTTPException(status_code=400, detail="Brak konfiguracji Jira w ustawieniach.")
    
    jira_config = setting.value
    domain = jira_config.get("domain")
    email = jira_config.get("email")
    api_token = decrypt_value(jira_config.get("api_token", ""))

    client = JiraClient(domain, email, api_token)

    try:
        projects = await client.get_projects()
        return [{"id": p["id"], "key": p["key"], "name": p["name"]} for p in projects]
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
from ..core.engine import ExecutionEngine

@router.post("/{workflow_id}/resume")
async def resume_workflow(workflow_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Wznawia najnowszą wstrzymaną akcję dla danego procesu."""
    
    result = await db.execute(
        select(WorkflowExecution)
        .where(
            WorkflowExecution.workflow_id == workflow_id,
            WorkflowExecution.status == ExecutionStatus.PAUSED
        )
        .order_by(WorkflowExecution.created_at.desc())
    )
    execution = result.scalars().first()
    
    if not execution:
        raise HTTPException(status_code=404, detail="Ten proces nie ma aktualnie żadnych wstrzymanych akcji.")

    step_result = await db.execute(
        select(ExecutionStep).where(
            ExecutionStep.execution_id == execution.id,
            ExecutionStep.status == ExecutionStatus.PAUSED
        )
    )
    step = step_result.scalars().first()
    
    if not step:
        raise HTTPException(status_code=404, detail="Brak zatrzymanego kroku.")

    output_data = step.output_data or {}
    original_input = output_data.get("original_input", {})
    
    new_output_data = {
        "status": "success",
        "decision": "approved",
        "payload": original_input,
    }
    
    state_manager = StateManager(db)
    await state_manager.update_step_status(
        step_id=step.id,
        status=ExecutionStatus.COMPLETED,
        output_data=new_output_data
    )

    execution.status = ExecutionStatus.RUNNING
    execution.resume_at = None
    await db.commit()

    workflow = await db.get(Workflow, workflow_id)
    engine = ExecutionEngine(db, execution.id)
    asyncio.create_task(engine.run(workflow.graph_json))

    return {"status": "resumed", "message": "Proces pomyślnie wznowiony!"}