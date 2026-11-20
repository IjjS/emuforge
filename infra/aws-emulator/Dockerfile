# AWS Emulator, per https://docs.aws.amazon.com/emulator/latest/userguide/getting-started-docker.html
# AWS publishes no prebuilt image, so this installs the Linux package.
# TARGETARCH (amd64/arm64) picks the x86_64 or aarch64 RPM.
FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      arm64) ARCH=aarch64 ;; \
      amd64) ARCH=x86_64 ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/aws-emulator.rpm \
       "https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/latest/aws-emulator-${ARCH}.rpm" \
    && rpm -i /tmp/aws-emulator.rpm && rm /tmp/aws-emulator.rpm \
    && mkdir -p /home/emulator && chown 1000 /home/emulator
# The folder a Docker volume is mounted on in the product form (root docker-compose.yml): an empty volume takes
# its owner, so the emulator can write it as 1000:0 without starting as root.
RUN mkdir -p /home/emulator/.aws/emulator && chown -R 1000:0 /home/emulator/.aws
# No USER: the container starts as root only to pick the emulator's user, the owner of the mounted
# ~/.aws/emulator, and the entrypoint never runs the emulator as root (entrypoint.sh).
COPY --chmod=755 entrypoint.sh /usr/local/bin/emulator-entrypoint
COPY --chmod=755 compose-db-range.sh /usr/local/bin/compose-db-range
ENV HOME=/home/emulator
EXPOSE 9297
ENTRYPOINT ["/usr/local/bin/emulator-entrypoint", "-b", "0.0.0.0"]
