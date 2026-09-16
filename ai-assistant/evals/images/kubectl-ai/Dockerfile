FROM node:22.23.1-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37 AS release
ADD --checksum=sha256:c2eb7fb99bf5217968a505ab38b0a230d86d1581957ccdda66167020b114d90d https://github.com/GoogleCloudPlatform/kubectl-ai/releases/download/v0.0.31/kubectl-ai_Linux_arm64.tar.gz /tmp/release.tar.gz
RUN mkdir /release && tar -xzf /tmp/release.tar.gz -C /release && printf '%s  %s\n' 47294528c31149d768d4c08ad231af466479aa2f156d53fb09e249feadbcf56f /release/kubectl-ai | sha256sum -c -

FROM scratch
COPY --from=release /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=release /release/kubectl-ai /kubectl-ai
ENV HOME=/tmp
ENV PATH=/unavailable
USER 65532:65532
ENTRYPOINT ["/kubectl-ai"]