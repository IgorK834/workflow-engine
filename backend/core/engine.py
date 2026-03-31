import uuid
import logging
from sqlalchemy.ext.asyncio import AsyncSession

from .parser import DAGParser, GraphParseError
from .state_manager import StateManager
from .runners import run_node_task
from ..models import ExecutionStatus
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

        # Iteracja po węzłach zgodnie z schematem
        for node_id in execution_order:
            node = next((n for n in graph.nodes if n.id == node_id), None)
            if not node:
                continue

            # Budowanie input_data
            incoming_edges = [e for e in graph.edges if e.target == node_id]

            input_data = {}

            if not incoming_edges:
                input_data = initial_payload
            else:
                for edge in incoming_edges:
                    source_output = node_outputs.get(edge.source, {})
                    input_data.update(source_output)

            # Rejestracja startu kroku w bazie danych
            step = await self.state_manager.create_step(
                execution_id=self.execution_id,
                node_id=node_id,
                input_data=input_data
            )

            # Wykonanie zadania przez odpowiedniego runnera
            try:
                logger.info(f"[{self.execution_id}] Start węzła: {node_id} ({node.data.subtype})")

                output_data = await run_node_task(
                    subtype=node.data.subtype,
                    config=node.data.config,
                    input_data=input_data
                )

                node_outputs[node_id] = output_data

                await self.state_manager.update_step_status(
                    step_id=step.id,
                    status=ExecutionStatus.COMPLETED,
                    output_data=output_data
                )
            
            except Exception as e:
                logger.error(f"[{self.execution_id}] Błąd węzła {node_id}: {e}")

                await self.state_manager.update_step_status(
                    step_id=step.id,
                    status=ExecutionStatus.FAILED,
                    error_message=str(e)
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