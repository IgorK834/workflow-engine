from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import func, case
from pydantic import BaseModel, Field
from typing import Any
import uuid
import asyncio

from ..core.engine import ExecutionEngine
from ..database import get_db
from ..schemas import WorkflowCreate, WorkflowResponse, WorkflowExecutiveResponse
from ..models import Workflow, WorkflowExecution
from ..core.state_manager import StateManager
from ..core.scheduler import sync_workflows_to_scheduler
from ..core.security import decrypt_value
from ..core.runners import JiraClient, run_node_task
from ..models import SystemSetting, ExecutionStatus, ExecutionStep
from ..core.schema_discovery import infer_node_output_schema

router = APIRouter(prefix="/workflows", tags=["workflows"])
TEST_WORKSPACE_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")


class NodeDryRunRequest(BaseModel):
    type: str = Field(..., description="Typ klocka (trigger/logic/action)")
    subtype: str = Field(..., description="Podtyp runnera, np. http_request")
    config: dict[str, Any] = Field(
        default_factory=dict, description="Konfiguracja klocka z edytora"
    )
    input_data: dict[str, Any] = Field(
        default_factory=dict, description="Mockowane dane wejściowe do testu"
    )


class VariableCatalogItem(BaseModel):
    label: str
    value: str
    sourceNodeName: str


class VariableCatalogResponse(BaseModel):
    node_id: str
    variables: list[VariableCatalogItem]


def _walk_object_paths(value: Any, prefix: str = "", max_depth: int = 6) -> list[str]:
    if max_depth <= 0:
        return []
    paths: list[str] = []

    if isinstance(value, dict):
        for k, v in value.items():
            key = str(k)
            path = f"{prefix}.{key}" if prefix else key
            paths.append(path)
            paths.extend(_walk_object_paths(v, path, max_depth=max_depth - 1))
    elif isinstance(value, list):
        for i, v in enumerate(value[:10]):  # avoid exploding catalogs
            key = str(i)
            path = f"{prefix}.{key}" if prefix else key
            paths.append(path)
            paths.extend(_walk_object_paths(v, path, max_depth=max_depth - 1))

    return paths


def _flatten_schema_paths(schema: dict[str, Any], prefix: str = "") -> list[str]:
    paths: list[str] = []
    for k, v in (schema or {}).items():
        key = str(k)
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(v, dict):
            paths.extend(_flatten_schema_paths(v, path))
        else:
            paths.append(path)
    return paths


def _get_upstream_node_ids(graph_json: dict[str, Any], node_id: str) -> list[str]:
    nodes = graph_json.get("nodes") or []
    edges = graph_json.get("edges") or []
    node_ids = {str(n.get("id")) for n in nodes if isinstance(n, dict) and n.get("id")}
    if node_id not in node_ids:
        return []

    incoming: dict[str, list[str]] = {}
    for e in edges:
        if not isinstance(e, dict):
            continue
        tgt = str(e.get("target", ""))
        src = str(e.get("source", ""))
        if not tgt or not src:
            continue
        incoming.setdefault(tgt, []).append(src)

    visited = {node_id}
    queue = [node_id]
    upstream: list[str] = []
    while queue:
        tgt = queue.pop(0)
        for src in incoming.get(tgt, []):
            if src in visited:
                continue
            visited.add(src)
            upstream.append(src)
            queue.append(src)
    return upstream


async def get_current_workspace_id() -> uuid.UUID:
    # Placeholder do czasu wdrożenia JWT / auth middleware.
    return TEST_WORKSPACE_ID


@router.get("/", response_model=list[WorkflowResponse])
async def list_workflows(
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    result = await db.execute(
        select(Workflow).where(Workflow.workspace_id == workspace_id)
    )
    return result.scalars().all()


@router.post("/", response_model=WorkflowResponse)
async def create_workflow(
    workflow_in: WorkflowCreate,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    new_workflow = Workflow(
        workspace_id=workspace_id,
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
async def list_executions(
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    """Pobiera historie wszystkich uruchomień procesów"""
    result = await db.execute(
        select(WorkflowExecution)
        .where(WorkflowExecution.workspace_id == workspace_id)
        .order_by(WorkflowExecution.started_at.desc())
    )
    return result.scalars().all()


@router.post("/{workflow_id}/execute", response_model=WorkflowExecutiveResponse)
async def execute_workflow(
    workflow_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    """Inicjalizacja nowego wykonania procesu i odpalenie silnika"""
    result = await db.execute(
        select(Workflow).where(
            Workflow.id == workflow_id, Workflow.workspace_id == workspace_id
        )
    )
    workflow = result.scalar_one_or_none()

    if not workflow:
        raise HTTPException(
            status_code=404, detail="Nie znaleziono procesu o podanym ID"
        )

    execution = WorkflowExecution(
        workflow_id=workflow_id,
        workspace_id=workspace_id,
        status=ExecutionStatus.RUNNING,
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    engine = ExecutionEngine(db, execution.id)

    sample_payload = {"kwota_zamowienia": 150, "klient": "Jan Kowalski"}

    await engine.run(workflow.graph_json, initial_payload=sample_payload)

    await db.refresh(execution)

    return execution


@router.post("/{workflow_id}/trigger")
async def trigger_webhook(
    workflow_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    """Publiczny endpoint nasłuchujący na dane"""
    result = await db.execute(
        select(Workflow).where(
            Workflow.id == workflow_id, Workflow.workspace_id == workspace_id
        )
    )
    workflow = result.scalar_one_or_none()

    if not workflow:
        raise HTTPException(
            status_code=404, detail="Nie znaleziono procesu o podanym ID"
        )

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    execution = WorkflowExecution(
        workflow_id=workflow_id,
        workspace_id=workspace_id,
        status=ExecutionStatus.RUNNING,
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)

    engine = ExecutionEngine(db, execution.id)

    await engine.run(workflow.graph_json, initial_payload=payload)

    await db.refresh(execution)
    return {
        "status": "success",
        "execution_id": str(execution.id),
        "payload_received": payload,
    }


@router.post("/test-node")
async def test_workflow_node(
    payload: NodeDryRunRequest,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    """Uruchamia pojedynczy węzeł w trybie bezstanowego dry-run (bez side-effectów)."""
    try:
        output_data = await run_node_task(
            subtype=payload.subtype,
            config=payload.config,
            input_data=payload.input_data,
            db=db,
            workspace_id=workspace_id,
            dry_run=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "status": "success",
        "node_type": payload.type,
        "node_subtype": payload.subtype,
        "output": output_data,
    }


@router.get("/{workflow_id}/variable-catalog", response_model=VariableCatalogResponse)
async def get_variable_catalog(
    workflow_id: uuid.UUID,
    node_id: str,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    """Zwraca katalog zmiennych dostępnych dla danego węzła (runtime + schema fallback)."""
    result = await db.execute(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.workspace_id == workspace_id)
    )
    workflow = result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(status_code=404, detail="Nie znaleziono procesu o podanym ID")

    graph_json = workflow.graph_json or {}
    upstream_node_ids = _get_upstream_node_ids(graph_json, node_id)

    nodes = graph_json.get("nodes") or []
    node_by_id: dict[str, dict[str, Any]] = {}
    for n in nodes:
        if not isinstance(n, dict):
            continue
        nid = n.get("id")
        if nid:
            node_by_id[str(nid)] = n

    # last execution runtime outputs
    exec_result = await db.execute(
        select(WorkflowExecution)
        .where(WorkflowExecution.workflow_id == workflow_id, WorkflowExecution.workspace_id == workspace_id)
        .order_by(WorkflowExecution.started_at.desc())
        .limit(1)
    )
    last_exec = exec_result.scalar_one_or_none()

    runtime_outputs: dict[str, dict[str, Any]] = {}
    if last_exec:
        steps_result = await db.execute(
            select(ExecutionStep).where(ExecutionStep.execution_id == last_exec.id)
        )
        for step in steps_result.scalars().all():
            if step.node_id in upstream_node_ids and isinstance(step.output_data, dict):
                runtime_outputs[step.node_id] = step.output_data

    items: list[VariableCatalogItem] = []
    seen: set[tuple[str, str]] = set()

    for upstream_id in upstream_node_ids:
        node = node_by_id.get(upstream_id) or {}
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        node_label = str((data or {}).get("label") or upstream_id)
        config = (data or {}).get("config") if isinstance((data or {}).get("config"), dict) else {}
        subtype = str((data or {}).get("subtype") or "")

        # runtime paths
        runtime = runtime_outputs.get(upstream_id)
        if runtime:
            for p in _walk_object_paths(runtime):
                token = f"{{{{{p}}}}}"
                key = (node_label, token)
                if key in seen:
                    continue
                seen.add(key)
                items.append(VariableCatalogItem(label=p, value=token, sourceNodeName=node_label))

        # schema fallback paths
        schema = infer_node_output_schema(subtype, config)
        for p in _flatten_schema_paths(schema):
            if p.startswith("_meta."):
                continue
            token = f"{{{{{p}}}}}"
            key = (node_label, token)
            if key in seen:
                continue
            seen.add(key)
            items.append(VariableCatalogItem(label=p, value=token, sourceNodeName=node_label))

    items.sort(key=lambda i: (i.sourceNodeName, i.label))
    return {"node_id": node_id, "variables": items}


@router.put("/{workflow_id}/publish", response_model=WorkflowResponse)
async def publish_workflow(
    workflow_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    """Publikuje proces (zmienia is_active na True)"""
    result = await db.execute(
        select(Workflow).where(
            Workflow.id == workflow_id, Workflow.workspace_id == workspace_id
        )
    )
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
async def toggle_workflow(
    workflow_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    """Zmienia status procesu (Stop/Wznów) poprzez przełączenie flagi is_active."""
    result = await db.execute(
        select(Workflow).where(
            Workflow.id == workflow_id, Workflow.workspace_id == workspace_id
        )
    )
    workflow = result.scalar_one_or_none()

    if not workflow:
        raise HTTPException(
            status_code=404, detail="Nie znaleziono procesu o podanym ID"
        )

    workflow.is_active = not bool(workflow.is_active)
    await db.commit()
    await db.refresh(workflow)
    await sync_workflows_to_scheduler()

    return workflow


@router.delete("/{workflow_id}")
async def delete_workflow(
    workflow_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    """Usuwa proces z bazy danych"""
    result = await db.execute(
        select(Workflow).where(
            Workflow.id == workflow_id, Workflow.workspace_id == workspace_id
        )
    )
    workflow = result.scalar_one_or_none()

    if not workflow:
        raise HTTPException(
            status_code=404, detail="Nie znaleziono procesu o podanym ID"
        )

    await db.delete(workflow)
    await db.commit()
    await sync_workflows_to_scheduler()

    return {"status": "deleted"}


@router.get("/stats")
async def get_workflows_stats(
    days: int = 7,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    """Proste statystyki wykonań z ostatnich dni (pod analitykę)."""
    safe_days = max(1, min(int(days), 90))

    # Grupowanie po dniu na podstawie started_at
    day_bucket = func.date_trunc("day", WorkflowExecution.started_at).label("day")

    stmt = (
        select(
            day_bucket,
            func.count(WorkflowExecution.id).label("total"),
            func.sum(
                case(
                    (WorkflowExecution.status == ExecutionStatus.COMPLETED, 1), else_=0
                )
            ).label("completed"),
            func.sum(
                case((WorkflowExecution.status == ExecutionStatus.FAILED, 1), else_=0)
            ).label("failed"),
            func.sum(
                case((WorkflowExecution.status == ExecutionStatus.PAUSED, 1), else_=0)
            ).label("paused"),
            func.sum(
                case((WorkflowExecution.status == ExecutionStatus.RUNNING, 1), else_=0)
            ).label("running"),
        )
        .where(
            WorkflowExecution.started_at
            >= func.now() - func.make_interval(days=safe_days)
        )
        .where(WorkflowExecution.workspace_id == workspace_id)
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
async def get_workflows_logs(
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    """Najnowsze zdarzenia z tabeli ExecutionStep (pod monitoring/analitykę)."""
    safe_limit = max(1, min(int(limit), 200))

    result = await db.execute(
        select(ExecutionStep)
        .join(WorkflowExecution, ExecutionStep.execution_id == WorkflowExecution.id)
        .where(WorkflowExecution.workspace_id == workspace_id)
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
                "status": (
                    s.status.value if hasattr(s.status, "value") else str(s.status)
                ),
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "finished_at": s.finished_at.isoformat() if s.finished_at else None,
                "error_message": s.error_message,
            }
            for s in steps
        ],
    }


@router.get("/nodes/jira/projects")
async def fetch_jira_projects(
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    """Pobieranie listy projektów z Jira poprzez dane wczytane z ustawień uytkownika."""
    result = await db.execute(
        select(SystemSetting).where(
            SystemSetting.key == "jira_profile",
            SystemSetting.workspace_id == workspace_id,
        )
    )
    setting = result.scalar_one_or_none()

    if not setting or not setting.value:
        raise HTTPException(
            status_code=400, detail="Brak konfiguracji Jira w ustawieniach."
        )

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


@router.post("/{workflow_id}/resume")
async def resume_workflow(
    workflow_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    """Wznawia najnowszą wstrzymaną akcję dla danego procesu."""

    result = await db.execute(
        select(WorkflowExecution)
        .where(
            WorkflowExecution.workflow_id == workflow_id,
            WorkflowExecution.status == ExecutionStatus.PAUSED,
            WorkflowExecution.workspace_id == workspace_id,
        )
        .order_by(WorkflowExecution.started_at.desc())
    )
    execution = result.scalars().first()

    if not execution:
        raise HTTPException(
            status_code=404,
            detail="Ten proces nie ma aktualnie żadnych wstrzymanych akcji.",
        )

    step_result = await db.execute(
        select(ExecutionStep).where(
            ExecutionStep.execution_id == execution.id,
            ExecutionStep.status == ExecutionStatus.PAUSED,
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
        step_id=step.id, status=ExecutionStatus.COMPLETED, output_data=new_output_data
    )

    execution.status = ExecutionStatus.RUNNING
    execution.resume_at = None
    await db.commit()

    wf_result = await db.execute(
        select(Workflow).where(
            Workflow.id == workflow_id,
            Workflow.workspace_id == workspace_id,
        )
    )
    workflow = wf_result.scalar_one_or_none()
    if not workflow:
        raise HTTPException(
            status_code=404, detail="Nie znaleziono procesu o podanym ID"
        )
    engine = ExecutionEngine(db, execution.id)
    asyncio.create_task(engine.run(workflow.graph_json))

    return {"status": "resumed", "message": "Proces pomyślnie wznowiony!"}


@router.get("/{workflow_id}/executions/{execution_id}")
async def get_execution_details(
    workflow_id: uuid.UUID,
    execution_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    """Pobiera szczegóły konkretnej akcji pod widok i śledzenie"""
    stmt = (
        select(WorkflowExecution)
        .options(
            selectinload(WorkflowExecution.steps),
            selectinload(WorkflowExecution.workflow),
        )
        .where(
            WorkflowExecution.id == execution_id,
            WorkflowExecution.workflow_id == workflow_id,
            WorkflowExecution.workspace_id == workspace_id,
        )
    )

    result = await db.execute(stmt)
    execution = result.scalar_one_or_none()

    if not execution:
        raise HTTPException(status_code=404, detail="Nie znaleziono podanej akcji")

    return {
        "execution": {
            "id": str(execution.id),
            "status": (
                execution.status.value
                if hasattr(execution.status, "value")
                else str(execution.status)
            ),
            "started_at": execution.started_at,
            "finished_at": execution.finished_at,
        },
        "workflow": {
            "name": execution.workflow.name,
            "graph_json": execution.workflow.graph_json,
        },
        "steps": [
            {
                "id": str(step.id),
                "node_id": step.node_id,
                "status": (
                    step.status.value
                    if hasattr(step.status, "value")
                    else str(step.status)
                ),
                "input_data": step.input_data,
                "output_data": step.output_data,
                "error_message": step.error_message,
                "started_at": step.started_at,
                "finnished_at": step.finished_at,
            }
            for step in execution.steps
        ],
    }
