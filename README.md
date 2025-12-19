# Redash MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that provides access to Redash queries, enabling AI assistants and applications to fetch and interact with data from Redash dashboards.

## Features

- 🔌 **MCP Protocol Support**: Full compatibility with the Model Context Protocol
- 🌐 **HTTP/SSE Mode**: Expose MCP functionality over HTTP using Server-Sent Events (SSE)
- 📊 **Redash Integration**: Execute queries and fetch results from Redash
- ⚡ **Multi-Session Support**: Handle multiple concurrent client sessions
- 🔒 **Secure Authentication**: API key authentication via HTTP headers
- ⏱️ **Configurable Timeouts**: Customizable query timeouts, polling intervals, and cache settings
- 🐳 **Docker Ready**: Pre-built Docker images available
- ☸️ **Kubernetes Ready**: Complete Kubernetes manifests included

## Installation

### Prerequisites

- Node.js 20 or higher
- npm or yarn
- Redash API key

### Local Installation

```bash
# Clone the repository
git clone https://github.com/jonico/redash-mcp-server.git
cd redash-mcp-server

# Install dependencies
npm install

# Set your Redash API key
export REDASH_KEY="your-redash-api-key"
```

## Usage

The server can run in two modes:

### 1. Stdio Mode (Default)

For direct MCP client connections via standard input/output:

```bash
npm start
# or
npm run start:mcp
# or
node src/index.js --stdio
```

### 2. HTTP/SSE Mode

For HTTP-based access using Server-Sent Events:

```bash
npm run start:http
# or
node src/index.js --http
```

The server will start on port 3000 (configurable via `PORT` environment variable).

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `REDASH_KEY` | Redash API key (required) | - |
| `PORT` | HTTP server port (HTTP mode only) | `3000` |
| `QUERY_TIMEOUT_SECONDS` | Maximum time to wait for query completion | `60` |
| `QUERY_POLL_MS` | Polling interval in milliseconds | `2000` |
| `QUERY_MAX_AGE_SECONDS` | Maximum age of cached results (optional) | - |
| `REDASH_QUERY_ID` | Default Redash query ID | `35173` |

### HTTP Headers (HTTP/SSE Mode)

When using HTTP mode, you can configure the server per-request via HTTP headers:

| Header | Description |
|--------|-------------|
| `Authorization` | Redash API key (required). Format: `Authorization: Key <api-key>` or `Authorization: <api-key>` |
| `X-Query-Timeout-Seconds` | Override query timeout |
| `X-Query-Poll-Ms` | Override polling interval |
| `X-Query-Max-Age-Seconds` | Override cache max age |
| `X-Query-Id` or `X-Redash-Query-Id` | Override query ID |

## API Endpoints (HTTP/SSE Mode)

### Health Check

```bash
GET /health
```

Returns server status:

```json
{
  "status": "ok",
  "service": "redash-mcp-server"
}
```

### SSE Connection

```bash
GET /sse
Headers:
  Authorization: Key <your-redash-api-key>
  X-Query-Timeout-Seconds: 120 (optional)
  X-Query-Poll-Ms: 3000 (optional)
  X-Query-Id: 12345 (optional)
```

Establishes a Server-Sent Events connection for MCP communication.

### Messages Endpoint

```bash
POST /messages?sessionId=<session-id>
Headers:
  Authorization: Key <your-redash-api-key> (optional, for updating API key)
```

Sends MCP messages to the server.

## MCP Tools

### `getData`

Fetches customer postman usage data for the requested organization domain.

**Input Schema:**
```json
{
  "org": "string"
}
```

**Example:**
```json
{
  "org": "example.com"
}
```

## Docker Deployment

### Using Pre-built Image

```bash
docker pull ghcr.io/jonico/redash-mcp-server:latest
docker run -d \
  -p 3000:3000 \
  -e REDASH_KEY="your-api-key" \
  ghcr.io/jonico/redash-mcp-server:latest
```

### Building Locally

```bash
docker build -t redash-mcp-server .
docker run -d \
  -p 3000:3000 \
  -e REDASH_KEY="your-api-key" \
  redash-mcp-server
```

## Kubernetes Deployment

Complete Kubernetes manifests are available in the `k8s/` directory. See [k8s/README.md](k8s/README.md) for detailed deployment instructions.

Quick start:

```bash
# Create secret
kubectl create secret generic redash-mcp-server-secrets \
  --from-literal=redash-key='YOUR_API_KEY'

# Apply manifests
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

## Development

### Project Structure

```
.
├── src/
│   └── index.js          # Main server implementation
├── k8s/                  # Kubernetes manifests
├── .github/
│   └── workflows/       # CI/CD workflows
├── Dockerfile           # Docker image definition
└── package.json         # Node.js dependencies
```

### Running Tests

```bash
# Start the server in HTTP mode
npm run start:http

# In another terminal, test the health endpoint
curl http://localhost:3000/health
```

### Building Docker Image

```bash
docker build -t ghcr.io/jonico/redash-mcp-server:latest .
```

## Architecture

The server implements the Model Context Protocol and supports:

- **Session Management**: Each HTTP/SSE connection creates an isolated session with its own MCP server instance
- **Query Execution**: Asynchronous query execution with polling for job completion
- **Result Caching**: Support for using cached query results when available
- **Error Handling**: Comprehensive error handling and reporting

## License

This project is private and proprietary.

## Contributing

This is a private repository. For issues or questions, please contact the repository owner.

## Support

For deployment issues, see the [Kubernetes deployment guide](k8s/README.md).

For MCP protocol questions, refer to the [Model Context Protocol documentation](https://modelcontextprotocol.io).

