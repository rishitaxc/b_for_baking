FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json *.js *.html *.css ./
COPY --chown=node:node assets ./assets
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DATA_DIR=/app/data
EXPOSE 8080
CMD ["node", "server.js"]
