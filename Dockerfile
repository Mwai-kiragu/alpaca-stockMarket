FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache \
    python3 \
    make \
    g++

COPY package*.json ./

RUN npm ci --only=production && npm cache clean --force

COPY . .

RUN mkdir -p logs && \
    chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "start"]