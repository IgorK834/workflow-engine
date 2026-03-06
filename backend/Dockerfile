FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITECODE 1
ENV PYTHONUNBUFFERED 1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt