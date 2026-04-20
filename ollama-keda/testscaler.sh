#!/bin/bash

# Configuration
HOST_HEADER="gemma.local"
INTERCEPTOR_URL="http://localhost:8080/api/generate"
MODEL="gemma3:4b"
NAMESPACE="default"

echo "🚀 Starting KEDA Serverless Test..."

# Function to check current pod count
count_pods() {
    kubectl get pods -n $NAMESPACE -l app=gemma-ollama --no-headers 2>/dev/null | wc -l
}

echo "--- STAGE 1: Scaling Up (High Load) ---"
echo "Sending 15 concurrent requests to trigger Max Replicas (5)..."

for i in {1..15}; do
    curl -s -H "Host: $HOST_HEADER" $INTERCEPTOR_URL -d "{
      \"model\": \"$MODEL\",
      \"prompt\": \"Count to 100\",
      \"stream\": false
    }" > /dev/null &
done

# Monitor for 60 seconds during scale up
for i in {1..12}; do
    echo "Current Gemma Pods: $(count_pods)"
    sleep 5
done

echo "--- STAGE 2: Cool Down (No Load) ---"
echo "All requests finished. Waiting for KEDA cooldown period (usually 5 mins)..."
echo "Note: KEDA will wait for the 'idle' period before scaling to 0."

# Monitor for scale down
# We check every 30 seconds for up to 7 minutes
for i in {1..14}; do
    PODS=$(count_pods)
    echo "Current Gemma Pods: $PODS"
    if [ "$PODS" -eq "0" ]; then
        echo "✅ Successfully scaled back to zero!"
        exit 0
    fi
    sleep 30
done

echo "Test complete."
