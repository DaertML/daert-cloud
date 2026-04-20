# Use a lightweight Node.js 20 image from a public registry (Docker Hub)
FROM node:20-slim

# Set the working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
# We use --omit=dev to keep the image small
RUN npm install --omit=dev

# Copy the agent source code
COPY index.ts ./

# Run the agent
CMD [ "npx", "tsx", "index.ts" ]
