helm install http-add-on kedacore/keda-add-ons-http
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm install keda kedacore/keda --namespace keda --create-namespace
kubectl apply -f https://raw.githubusercontent.com/kedacore/http-add-on/main/config/crd/bases/http.keda.sh_httpscaledobjects.yaml

# 1. Annotate the CRD so Helm knows it's the owner
kubectl annotate crd httpscaledobjects.http.keda.sh meta.helm.sh/release-name=http-add-on --overwrite
kubectl annotate crd httpscaledobjects.http.keda.sh meta.helm.sh/release-namespace=keda --overwrite

# 2. Label the CRD to match Helm's requirements
kubectl label crd httpscaledobjects.http.keda.sh app.kubernetes.io/managed-by=Helm --overwrite

# 1. Manually 'gift' the CRD to Helm
kubectl label crd httpscaledobjects.http.keda.sh app.kubernetes.io/managed-by=Helm --overwrite
kubectl annotate crd httpscaledobjects.http.keda.sh meta.helm.sh/release-name=http-add-on --overwrite
kubectl annotate crd httpscaledobjects.http.keda.sh meta.helm.sh/release-namespace=keda --overwrite

# 2. Run the install again
helm install http-add-on kedacore/keda-add-ons-http \
  --namespace keda \
  --set installCRDs=true

 kubectl port-forward svc/keda-add-ons-http-interceptor-proxy 8080:8080 -n keda

