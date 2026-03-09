import asyncio
import functools
from typing import Callable, Any
from concurrent.futures import ThreadPoolExecutor

# Inicjalizacja globalnej puli wątków dla synchronicznych akcji
# Ograniczenie liczby 'workerów' aby nagły atak starych skryptów nie zabił procesora

executor = ThreadPoolExecutor(max_workers=20)


async def run_async_wrapper(func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    loop = asyncio.get_running_loop()

    if kwargs:
        func = functools.partial(func, **kwargs)

    result = await loop.run_in_executor(executor, func, *args)
    return result
