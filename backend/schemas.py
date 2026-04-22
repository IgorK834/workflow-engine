from pydantic import BaseModel, Field, ConfigDict
from typing import Any
from enum import Enum
import uuid
from datetime import datetime


class WorkspaceRole(str, Enum):
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"


class WorkspaceBase(BaseModel):
    name: str = Field(..., max_length=255)
    slug: str = Field(..., max_length=255)


class WorkspaceCreate(WorkspaceBase):
    pass


class WorkspaceResponse(WorkspaceBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserBase(BaseModel):
    email: str = Field(..., max_length=255)
    full_name: str | None = Field(None, max_length=255)
    is_active: bool = True


class UserCreate(UserBase):
    pass


class UserResponse(UserBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WorkspaceMemberBase(BaseModel):
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    role: WorkspaceRole = WorkspaceRole.VIEWER


class WorkspaceMemberCreate(WorkspaceMemberBase):
    pass


class WorkspaceMemberResponse(WorkspaceMemberBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Typy węzłów
class NodeType(str, Enum):
    TRIGGER = "trigger"
    LOGIC = "logic"
    ACTION = "action"


# Dane zawarte wewnątrz konkretnego węzła
class NodeData(BaseModel):
    subtype: str = Field(
        ..., description="Konkretna akcja, np. 'webhook', 'slack_msg', if_else'"
    )
    label: str = Field(..., description="Nazwa wyświetlana w UI")
    description: str | None = Field(None, description="Opcjonalny opis węzła")
    config: dict[str, Any] = Field(
        default_factory=dict,
        description="Parametry konfiguracyjne, np. adres URL, warunek logiczny, tokeny",
    )


# Model pojedynczego węzła
class Node(BaseModel):
    id: str = Field(..., description="Unikalne ID węzłą z React Flow, np.'node-1'")
    type: NodeType
    position: dict[str, float] = Field(..., description="Pozycja X i Y na canvasie UI")
    data: NodeData


# Model krawędzi
class Edge(BaseModel):
    id: str = Field(..., description="Unikalne ID krawędzi, np. 'edge-1-2'")
    source: str = Field(..., description="ID węzła źródłowego")
    target: str = Field(..., description="ID węzłą docelowego")
    sourceHandle: str | None = Field(
        None,
        description="Opcjonalny uchwyt wyjściowy (np. 'true', 'false' dla bramki IF)",
    )
    targetHandle: str | None = Field(None, description="Opcjonalny uchwyt wejściowy")


# Cały Graf
class WorkflowGraph(BaseModel):
    nodes: list[Node]
    edges: list[Edge]


# Schemat tworzenia nowego Workflow
class WorkflowCreate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str | None = Field(None, max_length=255)
    graph_json: WorkflowGraph


# Schemat zwracany przez API
class WorkflowResponse(WorkflowCreate):
    id: uuid.UUID
    workspace_id: uuid.UUID
    is_active: bool
    created_at: datetime
    updated_at: datetime

    # Umozliwia czytanie prosto z modeli SQLAlchemy
    model_config = ConfigDict(from_attributes=True)


# Schemat zwracany przez API dla historii uruchomień
class WorkflowExecutiveResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    workflow_id: uuid.UUID
    status: str
    started_at: datetime
    finished_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


# Schemat zapisu nowych kluczy API
class SystemSettingCreate(BaseModel):
    key: str = Field(..., description="Klucz ustawienia, np. 'smtp_profile'")
    value: dict[str, Any] = Field(..., description="Wartość w formacjie JSON")


# Schemat zapisu konfiguracji klucza API
class SystemSettingResponse(SystemSettingCreate):
    id: uuid.UUID
    workspace_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
