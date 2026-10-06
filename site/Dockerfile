# Build from the repository root: docker build -f site/Dockerfile .
FROM alpine:3.20 AS gallery
WORKDIR /work
COPY apps ./apps
COPY site/build-gallery.sh ./
RUN sh build-gallery.sh ./apps ./index.html

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY site/config.js site/gallery.css /usr/share/nginx/html/
COPY --from=gallery /work/index.html /usr/share/nginx/html/index.html
# Every apps/<name>/ is served at /<name>/; build files stay out of the image.
COPY apps /usr/share/nginx/html/
USER 101
EXPOSE 8080
