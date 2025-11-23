FROM nginx:1.27-alpine

LABEL org.opencontainers.image.source="https://github.com/github/project-overview"
LABEL org.opencontainers.image.description="Static web UI that analyzes GitHub repositories client-side."

WORKDIR /usr/share/nginx/html

# Copy custom server config (disables default config automatically)
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Copy static assets
COPY index.html ./
COPY styles.css ./
COPY src ./src

EXPOSE 80

# Use default nginx entrypoint/cmd

