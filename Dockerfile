FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY web ./web
ENV HOST=0.0.0.0 PORT=8788 AULA_DATA=/data
RUN mkdir /data && chown node /data
VOLUME /data
USER node
EXPOSE 8788
CMD ["node", "--no-warnings", "server.js"]
