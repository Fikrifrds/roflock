# Compiler-only container image. It intentionally does not expose the local
# daemon: loopback authentication and repository authority belong to the host.
FROM node:24-bookworm-slim AS build

WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --dir apps/cli build && cd apps/cli && npm pack

FROM node:24-bookworm-slim

COPY --from=build /src/apps/cli/roflock-*.tgz /tmp/
RUN npm install --global /tmp/roflock-*.tgz && rm /tmp/roflock-*.tgz
USER node
WORKDIR /workspace
ENTRYPOINT ["roflock"]
CMD ["--help"]
