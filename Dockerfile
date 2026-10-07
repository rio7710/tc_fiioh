FROM python:3.13-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ffmpeg fonts-nanum fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 appuser \
    && useradd -u 10001 -g appuser -m -s /bin/bash appuser \
    && mkdir -p /data /app \
    && chown -R appuser:appuser /data /app

WORKDIR /app

COPY 01_app /app/01_app
COPY config /app/config
COPY migrations /app/migrations
COPY contracts /app/contracts
COPY prompts /app/prompts
COPY tools/unified_content_prompt_harness.py /app/tools/unified_content_prompt_harness.py
COPY tools/validate_unified_content.py /app/tools/validate_unified_content.py
COPY tools/validate_json_schema.py /app/tools/validate_json_schema.py
COPY tools/backfill_final_exports.py /app/tools/backfill_final_exports.py
COPY 02_media/video/P1_merged.mp4 /app/02_media/video/P1_merged.mp4
COPY 02_media/images/scenes/scene_*.webp /app/02_media/images/scenes/
COPY 02_media/music /app/02_media/music
COPY 02_media/narration /app/02_media/narration

RUN chown -R appuser:appuser /data /app

ENV PYTHONPATH=/app:/app/01_app
ENV PORT=10000
ENV P1_NO_BROWSER=1
ENV RENDER_PRESET=ultrafast
ENV FFMPEG_THREADS=1
ENV DATA_DIR=/data
ENV SQLITE_PATH=/data/tc.sqlite
ENV EXPORTS_DIR=/data/exports
ENV DEMO_DATA_PATH=/data/demo_data.json
ENV CAPTION_REGISTRY_PATH=/data/caption_artifacts.json
ENV KLING_ARTIFACT_DIR=/data/generated/kling

USER appuser

EXPOSE 10000

CMD ["python", "01_app/render_server.py"]
