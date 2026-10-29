FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py schema.sql set_password.py ./
COPY static ./static
ENV BABYLOG_DB=/data/babylog.db PYTHONUNBUFFERED=1
RUN useradd -r -u 1000 babylog && mkdir -p /data && chown babylog /data
USER babylog
EXPOSE 8000
VOLUME /data
CMD ["gunicorn", "-w", "1", "--threads", "4", "-b", "0.0.0.0:8000", "app:app"]
