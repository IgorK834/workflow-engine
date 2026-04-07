import uuid
import logging
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from datetime import datetime, timezone, timedelta

from .parser import DAGParser
from .state_manager import StateManager
from .runners import run_node_task
from ..database import engine as db_engine
from ..models import ExecutionStatus, ExecutionStep, WorkflowExecution, Workflow
from ..schemas import WorkflowGraph

logger = logging.getLogger(__name__)


class ExecutionEngine:
    """
    Główny silnik wykonawczy
    pobiera plan z DAGParsera, uruchamia kolejne węzły i przekazuje dane.
    """

    def __init__(self, db: AsyncSession, execution_id: uuid.UUID):
        self.db = db
        self.execution_id = execution_id
        self.state_manager = StateManager(db)

    async def run(self, graph_json: dict, initial_payload: dict = None):
        if initial_payload is None:
            initial_payload = {}

        logger.info(f"[{self.execution_id}] Rozpoczyna wykonywanie procesu...")

        # Parsowanie grafu do obiektu Pydantic
        try:
            graph = WorkflowGraph(**graph_json)
            parser = DAGParser(graph)
            execution_order = parser.get_execution_plan()
        except Exception as e:
            logger.error(f"[{self.execution_id}] Błąd parsowania grafu: {e}")
            await self.state_manager.update_execution_status(
                self.execution_id, ExecutionStatus.FAILED
            )
            return

        node_outputs = {}
        completed_node_ids = set()

        result = await self.db.execute(
            select(ExecutionStep).where(ExecutionStep.execution_id == self.execution_id)
        )

        existing_steps = result.scalars().all()

        for step in existing_steps:
            if step.status in [ExecutionStatus.COMPLETED, ExecutionStatus.PAUSED]:
                completed_node_ids.add(step.node_id)

                if step.output_data:
                    if step.output_data.get("__pause__"):
                        node_outputs[step.node_id] = step.output_data.get(
                            "original_input", {}
                        )

                        if step.status == ExecutionStatus.PAUSED:
                            await self.state_manager.update_step_status(
                                step_id=step.id,
                                status=ExecutionStatus.COMPLETED,
                                output_data=step.output_data,
                            )
                    else:
                        node_outputs[step.node_id] = step.output_data

        # Iteracja po węzłach zgodnie z schematem
        for node_id in execution_order:
            if node_id in completed_node_ids:
                continue

            node = next((n for n in graph.nodes if n.id == node_id), None)
            if not node:
                continue

            # Budowanie input_data
            incoming_edges = [e for e in graph.edges if e.target == node_id]

            input_data = {}

            if not incoming_edges:
                input_data = initial_payload
            else:
                valid_edges_count = 0
                for edge in incoming_edges:
                    if edge.source not in node_outputs:
                        continue

                    source_output = node_outputs[edge.source]
                    selected_handle = source_output.get("selected_handle")

                    if selected_handle is not None:
                        if edge.sourceHandle != selected_handle:
                            continue

                    payload = source_output.get("payload", source_output)
                    filtered_payload = {
                        k: v
                        for k, v in payload.items()
                        if k not in ["selected_handle", "status"]
                    }

                    input_data.update(filtered_payload)
                    valid_edges_count += 1

                if valid_edges_count == 0:
                    logger.info(f"[{self.execution_id}] Pomijam węzeł {node_id}")
                    continue

            # Rejestracja startu kroku w bazie danych
            step = await self.state_manager.create_step(
                execution_id=self.execution_id, node_id=node_id, input_data=input_data
            )

            # Wykonanie zadania przez odpowiedniego runnera
            try:
                logger.info(
                    f"[{self.execution_id}] Start węzła: {node_id} ({node.data.subtype})"
                )

                output_data = await run_node_task(
                    subtype=node.data.subtype,
                    config=node.data.config,
                    input_data=input_data,
                    db=self.db,
                )

                if isinstance(output_data, dict) and output_data.get("__pause__"):
                    resume_at_str = output_data.get("resume_at")
                    resume_at_dt = datetime.fromisoformat(resume_at_str)

                    await self.state_manager.update_step_status(
                        step_id=step.id,
                        status=ExecutionStatus.PAUSED,
                        output_data=output_data,
                    )

                    await self.db.execute(
                        update(WorkflowExecution)
                        .where(WorkflowExecution.id == self.execution_id)
                        .values(status=ExecutionStatus.PAUSED, resume_at=resume_at_dt)
                    )
                    await self.db.commit()

                    logger.info(
                        f"[{self.execution_id}] Proces zatrzymany. Zwolniono zasoby. Wznowienie po: {resume_at_dt}"
                    )

                    return

                if isinstance(output_data, dict) and output_data.get(
                    "__spawn_subworkflows__"
                ):
                    target_wf_id_str = output_data.get("target_workflow_id")
                    items = output_data.get("items", [])

                    try:
                        target_wf_id = uuid.UUID(target_wf_id_str)
                    except ValueError:
                        raise ValueError(
                            f"Niepoprawny format UUID procesu docelowego: {target_wf_id_str}"
                        )

                    result = await self.db.execute(
                        select(Workflow).where(Workflow.id == target_wf_id)
                    )
                    target_workflow = result.scalar_one_or_none()

                    if not target_workflow:
                        raise ValueError(
                            f"Proces podrzędny o ID {target_wf_id} nie istnieje lub został usunięty."
                        )

                    for item in items:
                        item_payload = (
                            item if isinstance(item, dict) else {"iteration_item": item}
                        )

                        sub_exec = WorkflowExecution(
                            workflow_id=target_wf_id,
                            status=ExecutionStatus.PENDING,
                            parent_id=self.execution_id,
                        )
                        self.db.add(sub_exec)
                        await self.db.commit()
                        await self.db.refresh(sub_exec)

                        async def run_sub_execution(exec_id, payload, graph):
                            async with AsyncSession(db_engine) as sub_session:
                                sub_engine = ExecutionEngine(sub_session, exec_id)
                                await sub_engine.run(graph, initial_payload=payload)

                        asyncio.create_task(
                            run_sub_execution(
                                sub_exec.id, item_payload, target_workflow.graph_json
                            )
                        )

                    logger.info(
                        f"[{self.execution_id}] Pomyślnie rozszczepiono {len(items)} podprocesów."
                    )

                    output_data = {
                        "status": "success",
                        "spawned_subworkflows": len(items),
                    }

                node_outputs[node_id] = output_data

                await self.state_manager.update_step_status(
                    step_id=step.id,
                    status=ExecutionStatus.COMPLETED,
                    output_data=output_data,
                )

            except Exception as e:
                logger.error(f"[{self.execution_id}] Błąd węzła {node_id}: {e}")

                MAX_RETRIES = 3
                BASE_DELAY = 5.0
                RETRY_MULTIPLIER = 2.0

                failed_attempts = sum(
                    1
                    for s in existing_steps
                    if s.node_id == node_id and s.status == ExecutionStatus.FAILED
                )

                current_attempt = failed_attempts + 1

                if current_attempt <= MAX_RETRIES:
                    delay_seconds = BASE_DELAY * (
                        RETRY_MULTIPLIER ** (current_attempt - 1)
                    )
                    resume_at_dt = datetime.now(timezone.utc) + timedelta(
                        seconds=delay_seconds
                    )

                    logger.warning(
                        f"[{self.execution_id}] Próba {current_attempt}/{MAX_RETRIES} dla węzła {node_id}. "
                        f"Usypiam. Ponowienie za {delay_seconds}s."
                    )

                    await self.state_manager.update_step_status(
                        step_id=step.id,
                        status=ExecutionStatus.FAILED,
                        error_message=str(e),
                    )

                    await self.db.execute(
                        update(WorkflowExecution)
                        .where(WorkflowExecution.id == self.execution_id)
                        .values(status=ExecutionStatus.PAUSED, resume_at=resume_at_dt)
                    )
                    await self.db.commit()

                    return

                logger.error(
                    f"[{self.execution_id}] Węzeł {node_id} uległ ostatecznej awarii po {MAX_RETRIES} próbach."
                )

                await self.state_manager.update_step_status(
                    step_id=step.id, status=ExecutionStatus.FAILED, error_message=str(e)
                )

                await self.state_manager.update_execution_status(
                    self.execution_id, ExecutionStatus.FAILED
                )

                return

        # Oznaczamy proces na jako zrobiony
        await self.state_manager.update_execution_status(
            self.execution_id, ExecutionStatus.COMPLETED
        )

        logger.info(f"[{self.execution_id}] Zakończono proces sukcesem!")
