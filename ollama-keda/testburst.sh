#!/bin/bash
# test-burst.sh

echo "🔥 Sending 50 background requests to force Max Replicas..."

for i in {1..50}; do
  # We use a long prompt to keep the connection busy
  curl -s -H "Host: gemma.local" http://localhost:8080/api/generate \
    -d "{\"model\": \"gemma3:4b\", \"prompt\": \"Write a 500 word essay on the history of AI.\", \"stream\": false}" > /dev/null &
done

echo "Requests sent. Monitoring pods..."
watch -n 1 "kubectl get pods -l app=gemma-ollama"
