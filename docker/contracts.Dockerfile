# Hardhat image shared by two services: `chain` (the local node) and `deployer` (one-shot contract deploy).
FROM node:22-bookworm-slim
WORKDIR /app/contracts
COPY contracts/package.json contracts/package-lock.json ./
RUN npm ci
COPY contracts/ ./
COPY docker/deploy.mjs ./docker-deploy.mjs
# Compile now so the solc download and the build happen once, at image build time.
RUN npx hardhat build
