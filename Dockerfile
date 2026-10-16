FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY web ./web
ENV HOST=0.0.0.0 PORT=8788 AULA_DATA=/data
RUN mkdir /data && chown node /data
VOLUME /data
USER node
EXPOSE 8788
# also used by CapRover and compose to know when the app is up
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--no-warnings", "server.js"]
