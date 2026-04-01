from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import SystemSetting
from ..schemas import SystemSettignCreate, SystemSettignResponse

router = APIRouter(prefix="/settigns", tags=["Settings"])


@router.get("/{key}", response_model=SystemSettignResponse)
async def get_setting(key: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    setting = result.scalar_one_or_none()

    if not setting:
        raise HTTPException(status_code=404, detail="Ustawienia nie znalezione!")

    return setting


@router.post("/", response_model=SystemSettignResponse)
async def upsert_setting(
    payload: SystemSettignCreate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == payload.key)
    )
    setting = result.scalar_one_or_none

    if setting:
        setting.value = payload.value
    else:
        setting = SystemSetting(key=payload.key, value=payload.value)
        db.add(setting)

    await db.commit()
    await db.refresh()
    return setting
