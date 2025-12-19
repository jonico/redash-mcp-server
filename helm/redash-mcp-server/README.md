# Redash MCP Server Helm Chart

A simple Helm chart for deploying the Redash MCP Server to Kubernetes.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.0+
- Access to ECR (Elastic Container Registry) or GHCR (GitHub Container Registry)

## Installation

### Using ECR:

```bash
helm install redash-mcp-server ./helm/redash-mcp-server \
  --set image.registry=<account-id>.dkr.ecr.<region>.amazonaws.com \
  --set image.repository=redash-mcp-server \
  --set image.tag=0.1
```

### Using GHCR:

```bash
helm install redash-mcp-server ./helm/redash-mcp-server \
  --set image.registry=ghcr.io \
  --set image.repository=jonico/redash-mcp-server \
  --set image.tag=0.1
```

### Verify Installation

```bash
# Check deployment status
kubectl get pods -l app.kubernetes.io/name=redash-mcp-server

# Check service
kubectl get svc -l app.kubernetes.io/name=redash-mcp-server

# View logs
kubectl logs -l app.kubernetes.io/name=redash-mcp-server
```

## Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.registry` | Container registry URL | `""` (must be set) |
| `image.repository` | Image repository name | `redash-mcp-server` |
| `image.tag` | Image tag | `0.1` |
| `image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `imagePullSecrets` | Image pull secrets | `[]` |
| `replicaCount` | Number of replicas | `2` |
| `service.type` | Service type | `ClusterIP` |
| `service.port` | Service port | `80` |
| `resources.requests.memory` | Memory request | `128Mi` |
| `resources.requests.cpu` | CPU request | `100m` |
| `resources.limits.memory` | Memory limit | `512Mi` |
| `resources.limits.cpu` | CPU limit | `500m` |
| `ingress.enabled` | Enable ingress | `false` |

## Examples

### Deploy with Custom Replicas

```bash
helm install redash-mcp-server ./helm/redash-mcp-server \
  --set image.registry=123456789012.dkr.ecr.us-east-1.amazonaws.com \
  --set replicaCount=3
```

### Deploy with Ingress

```bash
helm install redash-mcp-server ./helm/redash-mcp-server \
  --set image.registry=ghcr.io \
  --set image.repository=jonico/redash-mcp-server \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=redash-mcp.example.com
```

### Upgrade Deployment

```bash
helm upgrade redash-mcp-server ./helm/redash-mcp-server \
  --set image.tag=0.2
```

## Uninstallation

```bash
helm uninstall redash-mcp-server
```
