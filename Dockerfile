FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=3000 MODE=hybrid
EXPOSE 3000
VOLUME /app/data
CMD ["node", "--no-warnings=ExperimentalWarning", "src/server.js"]
