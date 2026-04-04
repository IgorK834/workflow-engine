import uuid
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from ..models import WorkflowExecution, ExecutionStep, ExecutionStatus


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class StateManager:
    """
    Asynchroniczny menadzer stanu.
    Odpowiada za zapisywanie historii wykonań i śledzenie na bieząco w jakim stanie znajduje się dany proces.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def initialize_execution(self, workflow_id: uuid.UUID) -> WorkflowExecution:
        """Tworzymy nową instancję wykonania procesu i ustawia status na RUNNING."""
        execution = WorkflowExecution(
            workflow_id=workflow_id,
            status=ExecutionStatus.RUNNING,
            start_at=utc_now(),
        )
        self.db.add(execution)
        await self.db.commit()
        await self.db.refresh(execution)
        return execution

    async def update_execution_status(
        self, execution_id: uuid.UUID, status: ExecutionStatus
    ) -> WorkflowExecution:
        """Aktualizacje status całego wykonania."""
        result = await self.db.execute(
            select(WorkflowExecution).where(WorkflowExecution.id == execution_id)
        )
        execution = result.scalar_one_or_none()

        if not execution:
            raise ValueError(f"Nie znaleziono wykonania o ID: {execution_id}")

        execution.status = status

        if status in [
            ExecutionStatus.COMPLETED,
            ExecutionStatus.FAILED,
            ExecutionStatus.CANCELLED,
        ]:
            execution.finished_at = utc_now()

        await self.db.commit()
        await self.db.refresh(execution)
        return execution

    async def create_step(
        self, execution_id: uuid.UUID, node_id: str, input_data: dict = None
    ) -> ExecutionStep:
        """Rejestruje rozpoczęcie pojedynczego kroku w bazie."""
        step = ExecutionStep(
            execution_id=execution_id,
            node_id=node_id,
            status=ExecutionStatus.RUNNING,
            input_data=input_data,
            start_time=utc_now(),
        )
        self.db.add(step)
        await self.db.commit()
        await self.db.refresh(step)
        return step

    async def update_step_status(
        self,
        step_id: uuid.UUID,
        status: ExecutionStatus,
        output_data: dict = None,
        error_message: str = None,
    ) -> ExecutionStep:
        """Aktualizuje status pojedynczego kroku w bazie."""
        result = await self.db.execute(
            select(ExecutionStep).where(ExecutionStep.id == step_id)
        )
        step = result.scalar_one_or_none()

        if not step:
            raise ValueError(f"Nie znaleziono kroku o ID: {step_id}")

        step.status = status

        if output_data is not None:
            step.output_data = output_data
        if error_message is not None:
            step.error_message = error_message

        if status in [
            ExecutionStatus.COMPLETED,
            ExecutionStatus.FAILED,
            ExecutionStatus.CANCELLED,
        ]:
            step.finished_at = utc_now()

        await self.db.commit()
        await self.db.refresh(step)
        return step
