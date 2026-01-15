#!/bin/bash
# Navigate to the project root
cd "$(dirname "$0")/.."

# Load environment variables
if [ -f ./.env ]; then
  source ./.env
fi

# Run the Node.js cron script
/usr/bin/node worker/run_bot_cron.js
