# daert-cloud
Infra to build things in cloud and k8s

# Introduction
The main idea of this repo is to provide IaC to build infrastructure that runs AI at scale; the main focus by now will be k8s, but have some plans for deploying infra at cloud providers.

# How to setup k3d cluster with NVIDIA GPU access

$ git clone https://github.com/88plug/k3d-gpu

$ cd k3d-gpu

$ bash build.sh

$ k3d cluster create gpu-cluster   --image cryptoandcoffee/k3d-gpu   --servers 1 --agents 1   --gpus all   --port 6443:6443@loadbalancer

$ kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.17.1/deployments/static/nvidia-device-plugin.yml


Test successful installation:
docker exec -it k3d-gpu-cluster-server-0 nvidia-smi

# How to setup minikube cluster with NVIDIA GPU
$ minikube start --driver docker --container-runtime docker --gpus all

Check it works

$ kubectl run gpu-test --rm -it --restart=Never --image=nvidia/cuda:12.0.0-base-ubuntu22.04 -- nvidia-smi

Mount models folder

$ minikube mount /home/pc/.cache/huggingface:/home/pc/.cache/huggingface

Load vLLM docker image

$ minikube image pull vllm/vllm-openai:latest

Add HF token

$ kubectl create secret generic huggingface-secret --from-literal=tok=your_token_here

Create Storage and Deployment

$ kubectl apply -f vllm-pv.yaml

$ kubectl apply -f vllm-pvc.yaml

$ kubectl apply -f vllm-deploy.yaml

$ kubectl apply -f vllm-svc.yaml

Launch curl client for testing the model inference

$ kubectl run -i --tty --rm debug-client --image=curlimages/curl --restart=Never -- /bin/sh

$ curl http://vllm-service/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "TinyLlama/TinyLlama-1.1B-Chat-v0.1",
    "prompt": "<|system|>\nYou are a helpful assistant.</s>\n<|user|>\nHello! Who are you?</s>\n<|assistant|>\n",
    "max_tokens": 50
  }'
