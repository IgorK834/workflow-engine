from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone

from ..database import get_db
from ..models import SystemSetting
from ..schemas import SystemSettingCreate, SystemSettingResponse
from ..core.security import encrypt_value

router = APIRouter(prefix="/settings", tags=["Settings"])


def secure_payload(payload: dict) -> dict:
    secured = {}
    sensitive_keywords = ["password", "token", "secret", "api_key"]

    for k, v in payload.items():
        if any(keyword in k.lower() for keyword in sensitive_keywords) and isinstance(
            v, str
        ):
            secured[k] = encrypt_value(v)
        else:
            secured[k] = v
    return secured


@router.get("/{key}", response_model=SystemSettingResponse)
async def get_setting(key: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    setting = result.scalar_one_or_none()

    if not setting:
        raise HTTPException(status_code=404, detail="Ustawienia nie znalezione!")

    return setting


@router.post("/", response_model=SystemSettingResponse)
async def upsert_setting(
    setting_in: SystemSettingCreate, db: AsyncSession = Depends(get_db)
):
    secured_value = secure_payload(setting_in.value)

    result = await db.execute(
        select(SystemSetting).where(SystemSetting.key == setting_in.key)
    )
    existing_setting = result.scalar_one_or_none()

    if existing_setting:
        existing_setting.value = secured_value
        existing_setting.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(existing_setting)
        return existing_setting
    else:
        new_setting = SystemSetting(key=setting_in.key, value=secured_value)
        db.add(new_setting)
        await db.commit()
        await db.refresh(new_setting)
        return new_setting
