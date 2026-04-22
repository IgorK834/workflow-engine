import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from ..database import get_db
from ..models import Collection, CollectionRecord

router = APIRouter(prefix="/collections", tags=["collections"])
TEST_WORKSPACE_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")


async def get_current_workspace_id() -> uuid.UUID:
    # Placeholder do czasu wdrożenia JWT / auth middleware.
    return TEST_WORKSPACE_ID


class CollectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class CollectionResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    created_at: Any
    updated_at: Any

    class Config:
        from_attributes = True


class CollectionRecordCreate(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


class CollectionRecordUpdate(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


class CollectionRecordResponse(BaseModel):
    id: uuid.UUID
    collection_id: uuid.UUID
    data: dict[str, Any]
    created_at: Any
    updated_at: Any

    class Config:
        from_attributes = True


@router.get("/", response_model=list[CollectionResponse])
async def list_collections(
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    result = await db.execute(
        select(Collection)
        .where(Collection.workspace_id == workspace_id)
        .order_by(Collection.created_at.desc())
    )
    return result.scalars().all()


@router.post("/", response_model=CollectionResponse)
async def create_collection(
    payload: CollectionCreate,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    existing = await db.execute(
        select(Collection).where(
            Collection.workspace_id == workspace_id,
            Collection.name == payload.name.strip(),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Kolekcja o tej nazwie już istnieje.")

    collection = Collection(workspace_id=workspace_id, name=payload.name.strip())
    db.add(collection)
    await db.commit()
    await db.refresh(collection)
    return collection


@router.get("/{collection_id}", response_model=CollectionResponse)
async def get_collection(
    collection_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    result = await db.execute(
        select(Collection).where(
            Collection.id == collection_id,
            Collection.workspace_id == workspace_id,
        )
    )
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404, detail="Nie znaleziono kolekcji.")
    return collection


@router.get("/{collection_id}/records", response_model=list[CollectionRecordResponse])
async def list_collection_records(
    collection_id: uuid.UUID,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    safe_limit = max(1, min(int(limit), 500))
    collection_result = await db.execute(
        select(Collection).where(
            Collection.id == collection_id,
            Collection.workspace_id == workspace_id,
        )
    )
    collection = collection_result.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404, detail="Nie znaleziono kolekcji.")

    records_result = await db.execute(
        select(CollectionRecord)
        .where(CollectionRecord.collection_id == collection_id)
        .order_by(CollectionRecord.created_at.desc())
        .limit(safe_limit)
    )
    return records_result.scalars().all()


@router.post("/{collection_id}/records", response_model=CollectionRecordResponse)
async def create_collection_record(
    collection_id: uuid.UUID,
    payload: CollectionRecordCreate,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    collection_result = await db.execute(
        select(Collection).where(
            Collection.id == collection_id,
            Collection.workspace_id == workspace_id,
        )
    )
    collection = collection_result.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404, detail="Nie znaleziono kolekcji.")

    record = CollectionRecord(collection_id=collection_id, data=payload.data)
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


@router.patch("/{collection_id}/records/{record_id}", response_model=CollectionRecordResponse)
async def update_collection_record(
    collection_id: uuid.UUID,
    record_id: uuid.UUID,
    payload: CollectionRecordUpdate,
    db: AsyncSession = Depends(get_db),
    workspace_id: uuid.UUID = Depends(get_current_workspace_id),
):
    collection_result = await db.execute(
        select(Collection).where(
            Collection.id == collection_id,
            Collection.workspace_id == workspace_id,
        )
    )
    collection = collection_result.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404, detail="Nie znaleziono kolekcji.")

    record_result = await db.execute(
        select(CollectionRecord).where(
            CollectionRecord.id == record_id,
            CollectionRecord.collection_id == collection_id,
        )
    )
    record = record_result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Nie znaleziono rekordu.")

    record.data = payload.data
    await db.commit()
    await db.refresh(record)
    return record
