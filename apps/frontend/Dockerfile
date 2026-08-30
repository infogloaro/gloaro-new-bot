# Builds the admin panel to static files and serves them with nginx.
# On AWS these files go to S3 + CloudFront instead; this image is for
# docker-compose parity and for a single-EC2 deployment.

FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
