FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Vite inlines VITE_* vars at build time, so this must be a build ARG, not a
# runtime environment variable on the final image.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM node:20-slim
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist
EXPOSE 8080
# Cloud Run injects $PORT (8080); shell form so it actually expands. Local
# docker-compose maps 4173:8080 so it keeps using the familiar Vite port on
# the host side.
CMD serve -s dist -l ${PORT:-8080}
