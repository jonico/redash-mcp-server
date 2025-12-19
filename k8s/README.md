# Kubernetes Deployment

This directory contains Kubernetes manifests for deploying the MCP server.

## Files

- `deployment.yaml` - Deployment configuration for the MCP server pods
- `service.yaml` - Service to expose the MCP server within the cluster
- `configmap.yaml` - Non-sensitive configuration values
- `secret.yaml` - Sensitive configuration (API keys, etc.)

## Prerequisites

1. A Kubernetes cluster
2. `kubectl` configured to access your cluster
3. Access to GitHub Container Registry (ghcr.io) - the image is public, but you may need to configure image pull secrets if your cluster requires authentication

## Deployment Steps

1. **Use the pre-built Docker image from GitHub Container Registry:**
   The image is automatically built and pushed to `ghcr.io/jonico/redash-mcp-server:latest` via GitHub Actions on every push to main/master branch.
   
   The `deployment.yaml` is already configured to use this image. If you need a specific version:
   ```yaml
   image: ghcr.io/jonico/redash-mcp-server:v1.0.0
   ```

   **Note**: If the image is private, you may need to configure image pull secrets:
   ```bash
   kubectl create secret docker-registry ghcr-secret \
     --docker-server=ghcr.io \
     --docker-username=jonico \
     --docker-password=<GITHUB_TOKEN> \
     --docker-email=<your-email>
   ```
   Then add to `deployment.yaml`:
   ```yaml
   spec:
     imagePullSecrets:
     - name: ghcr-secret
   ```

   **To build and push manually (if needed):**
   ```bash
   docker build -t ghcr.io/jonico/redash-mcp-server:latest .
   docker push ghcr.io/jonico/redash-mcp-server:latest
   ```

3. **Create the secret with your Redash API key:**
   ```bash
   kubectl create secret generic mcp-server-secrets \
     --from-literal=redash-key='YOUR_ACTUAL_REDASH_API_KEY' \
     --dry-run=client -o yaml | kubectl apply -f -
   ```
   
   Or edit `secret.yaml` and apply it (not recommended for production):
   ```bash
   kubectl apply -f secret.yaml
   ```

   **Note**: Replace `YOUR_ACTUAL_REDASH_API_KEY` with your actual Redash API key.

4. **Apply the ConfigMap:**
   ```bash
   kubectl apply -f configmap.yaml
   ```

5. **Deploy the application:**
   ```bash
   kubectl apply -f deployment.yaml
   kubectl apply -f service.yaml
   ```

6. **Verify the deployment:**
   ```bash
   kubectl get pods -l app=mcp-server
   kubectl get svc mcp-server
   kubectl logs -l app=mcp-server
   ```

## Accessing the Service

The service is exposed as `ClusterIP` by default. To access it:

1. **Port forward (for testing):**
   ```bash
   kubectl port-forward svc/mcp-server 8080:80
   curl http://localhost:8080/health
   ```
   
   **With authentication:**
   ```bash
   curl -H "Authorization: Key <your-redash-api-key>" \
        http://localhost:8080/sse
   ```
   
   **Note**: The server uses Server-Sent Events (SSE) for MCP communication:
   - `GET /sse` - Establishes SSE connection (requires Authorization header)
   - `POST /messages?sessionId=<id>` - Sends MCP messages
   - `GET /health` - Health check endpoint

2. **Create an Ingress** (for external access):
   ```yaml
   apiVersion: networking.k8s.io/v1
   kind: Ingress
   metadata:
     name: mcp-server-ingress
   spec:
     rules:
     - host: mcp-server.example.com
       http:
         paths:
         - path: /
           pathType: Prefix
           backend:
             service:
               name: mcp-server
               port:
                 number: 80
   ```

   **Note on HTTPS/TLS**: The application runs HTTP internally. TLS/HTTPS termination is typically handled at the Ingress level using:
   - Ingress TLS configuration with certificates
   - Cert-Manager for automatic certificate management
   - Service mesh (Istio, Linkerd) for mTLS between services
   
   An experienced Kubernetes operator will configure TLS at the Ingress or service mesh layer based on their cluster's setup.

## Configuration

- **Replicas**: Default is 2. Adjust in `deployment.yaml` under `spec.replicas`
- **Resources**: Adjust CPU/memory requests and limits in `deployment.yaml`
- **Environment variables**: Modify in `configmap.yaml` and `secret.yaml`
- **Port**: The server runs on port 3000 (exposed via Service on port 80)

### Environment Variables

- `REDASH_KEY` - Redash API key (required, from secret)
- `PORT` - Server port (default: 3000)
- `QUERY_TIMEOUT_SECONDS` - Query timeout in seconds (default: 60)
- `QUERY_POLL_MS` - Polling interval in milliseconds (default: 2000)
- `QUERY_MAX_AGE_SECONDS` - Maximum cache age in seconds (optional)
- `REDASH_QUERY_ID` - Default Redash query ID (default: 35173)

### HTTP Headers

The server accepts the following headers:
- `Authorization: Key <api-key>` - Required for authentication (only Authorization header supported)
- `X-Query-Timeout-Seconds` - Override query timeout
- `X-Query-Poll-Ms` - Override polling interval
- `X-Query-Max-Age-Seconds` - Override cache max age
- `X-Query-Id` or `X-Redash-Query-Id` - Override query ID

## Health Checks

The deployment includes:
- **Liveness probe**: Checks `/health` endpoint every 30s
- **Readiness probe**: Checks `/health` endpoint every 10s

## Troubleshooting

```bash
# Check pod status
kubectl get pods -l app=mcp-server

# View logs
kubectl logs -l app=mcp-server

# Describe pod for events
kubectl describe pod -l app=mcp-server

# Check service endpoints
kubectl get endpoints mcp-server

# Check if image can be pulled
kubectl describe pod -l app=mcp-server | grep -i image

# Test health endpoint
kubectl port-forward svc/mcp-server 8080:80
curl http://localhost:8080/health
```

## Image Registry

The Docker image is published to GitHub Container Registry:
- **Image**: `ghcr.io/jonico/redash-mcp-server:latest`
- **Registry**: GitHub Container Registry (ghcr.io)
- **Owner**: jonico (personal organization)
- **Automated builds**: Images are automatically built and pushed via GitHub Actions on every push to main/master branch

To view available image tags, visit: https://github.com/users/jonico/packages/container/redash-mcp-server/versions

