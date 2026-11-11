FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build

FROM python:3.12-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 POSTUP_SERVE_WEB=1 PORT=10000
COPY server/requirements.txt ./server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY server/ ./server/
COPY --from=frontend /app/dist ./dist
RUN python server/manage.py collectstatic --noinput

CMD ["sh", "-c", "python server/manage.py migrate --noinput && cd server && exec waitress-serve --listen=0.0.0.0:${PORT} --url-scheme=https --max-request-body-size=65536 postup.wsgi:application"]
