# ---- build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
# Use npm without package-lock (first build) — install and cache
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime stage ----
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
