FROM node:24-slim

# Drop privileges for runtime work. node:24-slim ships a `node` user (uid 1000).
# Persist waap-cli session at /home/node/.waap-cli — matches the volume mount in
# docker-compose.yml.
WORKDIR /app
RUN chown -R node:node /app
USER node

COPY --chown=node:node package*.json ./
RUN npm install --omit=dev
COPY --chown=node:node . .

CMD ["npm", "start"]
