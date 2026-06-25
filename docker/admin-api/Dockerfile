FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app /app/app

EXPOSE 8080

# Multi-worker (utilise all cores under GIL) + periodic worker recycling so a
# leaked/bloated worker is replaced instead of growing unbounded (the old single
# uvicorn process climbed to ~3.7 GB). Worker count overridable via WEB_CONCURRENCY.
ENV WEB_CONCURRENCY=4
CMD ["gunicorn", "app.main:app", \
     "-k", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8080", \
     "--max-requests", "800", \
     "--max-requests-jitter", "200", \
     "--timeout", "60", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-"]
