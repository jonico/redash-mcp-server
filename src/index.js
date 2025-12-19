import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import http from 'http';
import { URL } from 'url';

// Extract the getData tool handler function
// In HTTP mode, redashApiKey, timeout config, and query ID are passed from headers
// In stdio mode, they come from environment variables
async function getDataHandler({ org, redashApiKey, timeoutSeconds, pollMs, maxAgeSeconds, queryId }) {
    const baseUrl = 'https://redash.postmanlabs.com';
    const apiKey = redashApiKey || process.env.REDASH_KEY;
    if (!apiKey) {
        throw new Error('REDASH_KEY env var or Authorization header is required');
    }

    // Use header values if provided, otherwise fall back to environment variables
    const timeoutMs = parseInt(timeoutSeconds || process.env.QUERY_TIMEOUT_SECONDS || '60') * 1000; // total time budget
    const pollDelayMs = parseInt(pollMs || process.env.QUERY_POLL_MS || '2000'); // interval between polls
    const maxAge = maxAgeSeconds
        ? parseInt(maxAgeSeconds)
        : (process.env.QUERY_MAX_AGE_SECONDS ? parseInt(process.env.QUERY_MAX_AGE_SECONDS) : undefined); // omit to accept any cached age

    const started = Date.now();

    // Helper: sleep
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Helper: poll job until done or timeout. Returns query_result_id
    const pollJobUntilDone = async (jobId) => {
        while (Date.now() - started < timeoutMs) {
                const jobRes = await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}`, {
                    method: 'GET',
                    headers: { Authorization: 'Key ' + apiKey }
                });

            if (!jobRes.ok) {
                const t = await jobRes.text();
                throw new Error(`Failed to poll job ${jobId}: ${jobRes.status} ${jobRes.statusText} - ${t}`);
            }

            const jobJson = await jobRes.json();
            const status = jobJson?.job?.status; // 1 queued, 2 processing, 3 done, 4 failed

            if (status === 3) {
                const qrid = jobJson?.job?.result?.query_result_id || jobJson?.job?.query_result_id;
                if (!qrid) {
                    throw new Error(`Job ${jobId} completed but no query_result_id in response`);
                }
                return qrid;
            }

            if (status === 4) {
                const err = jobJson?.job?.error || 'Unknown Redash job failure';
                throw new Error(`Redash job ${jobId} failed: ${err}`);
            }

            await sleep(pollDelayMs);
        }

        throw new Error(`Timed out waiting for Redash job ${jobId} after ${Math.round(timeoutMs / 1000)}s`);
    };

    // Step 1: POST results request (always; supports params and cache)
    const postBody = {
        parameters: { org },
        ...(typeof maxAge === 'number' ? { max_age: maxAge } : {})
    };

    // Use queryId from parameter, or fall back to environment variable, or default to 35173
    const queryIdToUse = queryId || process.env.REDASH_QUERY_ID || '35173';
    
    const res = await fetch(`${baseUrl}/api/queries/${queryIdToUse}/results`, {
        method: 'POST',
        headers: {
            Authorization: 'Key ' + apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(postBody)
    });

    if (!res.ok) {
        const t = await res.text();
        throw new Error(`Failed to request Redash results: ${res.status} ${res.statusText} - ${t}`);
    }

    const json = await res.json();

    // If cached or fresh results are returned immediately, use them (even if empty rows)
    if (json?.query_result) {
        return { content: [{ type: 'text', text: JSON.stringify(json) }] };
    }

    // Otherwise, a job was likely returned. Poll until done, then fetch the query_result by id
    const jobId = json?.job?.id || json?.job?.job_id || json?.id; // be defensive
    if (!jobId) {
        // Surface original payload for debugging
        throw new Error(`Unexpected Redash response (no query_result or job): ${JSON.stringify(json)}`);
    }

    const queryResultId = await pollJobUntilDone(jobId);

        // Fetch the completed query result
        const qRes = await fetch(`${baseUrl}/api/query_results/${encodeURIComponent(queryResultId)}.json`, {
            method: 'GET',
            headers: { Authorization: 'Key ' + apiKey }
        });

    if (!qRes.ok) {
        const t = await qRes.text();
        throw new Error(`Failed to fetch query_results/${queryResultId}: ${qRes.status} ${qRes.statusText} - ${t}`);
    }

    const qJson = await qRes.json();
    return { content: [{ type: 'text', text: JSON.stringify(qJson) }] };
}

// Determine mode from command line arguments
const args = process.argv.slice(2);
const httpMode = args.includes('--http') || args.includes('--server');
const stdioMode = args.includes('--stdio');
// Default to stdio mode if neither flag is specified (for MCP compatibility)
const useHttpMode = httpMode && !stdioMode;

if (useHttpMode) {
    // HTTP Server Mode using MCP SDK SSEServerTransport
    // Following the pattern from https://github.com/jonico/octocat-harry-potter-mcp-server/blob/master/mcpServer.js
    // Create a new server instance for each session to ensure proper isolation
    const port = process.env.PORT || 3000;

    // Store servers, transports, API keys, timeout config, and query ID per session
    const sessionServers = new Map();
    const sessionTransports = new Map();
    const sessionApiKeys = new Map();
    const sessionTimeouts = new Map(); // Store timeout config per session: { timeoutSeconds, pollMs, maxAgeSeconds }
    const sessionQueryIds = new Map(); // Store query ID per session

    // Helper function to create a server instance for a session
    function createServerForSession(sessionId) {
        const server = new McpServer({
            name: 'demo-server',
            version: '1.0.0'
        });

        // Register the getData tool with access to the session's API key
        server.registerTool(
            'getData',
            {
                title: 'Fetch query data',
                description: 'Fetches customer postman usage data for the requested organization domain.',
                inputSchema: { org: z.string() }
            },
            async (args) => {
                const { org } = args;
                // Use the API key stored for this session
                const apiKey = sessionApiKeys.get(sessionId) || process.env.REDASH_KEY;
                const result = await getDataHandler({ org, redashApiKey: apiKey });
                return result;
            }
        );

        return server;
    }

    // Create HTTP server to handle all incoming requests
    const httpServer = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        
        // Handle health check endpoint
        if (req.method === 'GET' && url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', service: 'mcp-server' }));
            return;
        }

        // Handle SSE endpoint - create new session
        if (req.method === 'GET' && url.pathname === '/sse') {
            // Extract Redash API key from Authorization header only
            const authHeader = req.headers.authorization || req.headers.Authorization;
            let redashApiKey = null;
            
            if (authHeader) {
                // Parse Authorization header (supports "Key <key>" format or direct key)
                const parts = authHeader.split(' ');
                if (parts.length === 2) {
                    redashApiKey = parts[1];
                } else if (authHeader.startsWith('Key ')) {
                    redashApiKey = authHeader.substring(4);
                } else {
                    redashApiKey = authHeader;
                }
            }

            if (!redashApiKey) {
                redashApiKey = process.env.REDASH_KEY;
            }

            // Extract timeout configuration from HTTP headers
            // Headers: X-Query-Timeout-Seconds, X-Query-Poll-Ms, X-Query-Max-Age-Seconds
            const timeoutConfig = {
                timeoutSeconds: req.headers['x-query-timeout-seconds'] || req.headers['x-timeout-seconds'],
                pollMs: req.headers['x-query-poll-ms'] || req.headers['x-poll-ms'],
                maxAgeSeconds: req.headers['x-query-max-age-seconds'] || req.headers['x-max-age-seconds']
            };

            // Extract query ID from HTTP header
            const queryId = req.headers['x-query-id'] || req.headers['x-redash-query-id'];

            // Create a new Server instance for this session
            const server = new McpServer({
                name: 'demo-server',
                version: '1.0.0'
            });

            // Create SSE transport for this session
            const transport = new SSEServerTransport('/messages', res);
            const sessionId = transport.sessionId;

            // Store API key, timeout config, and query ID for this session
            if (redashApiKey) {
                sessionApiKeys.set(sessionId, redashApiKey);
            }
            if (timeoutConfig.timeoutSeconds || timeoutConfig.pollMs || timeoutConfig.maxAgeSeconds) {
                sessionTimeouts.set(sessionId, timeoutConfig);
            }
            if (queryId) {
                sessionQueryIds.set(sessionId, queryId);
            }

            // Register the getData tool
            server.registerTool(
                'getData',
                {
                    title: 'Fetch query data',
                    description: 'Fetches customer postman usage data for the requested organization domain.',
                    inputSchema: { org: z.string() }
                },
                async (args) => {
                    const { org } = args;
                    const apiKey = sessionApiKeys.get(sessionId) || process.env.REDASH_KEY;
                    const timeoutConfig = sessionTimeouts.get(sessionId) || {};
                    const queryId = sessionQueryIds.get(sessionId);
                    const result = await getDataHandler({ 
                        org, 
                        redashApiKey: apiKey,
                        timeoutSeconds: timeoutConfig.timeoutSeconds,
                        pollMs: timeoutConfig.pollMs,
                        maxAgeSeconds: timeoutConfig.maxAgeSeconds,
                        queryId: queryId
                    });
                    return result;
                }
            );

            // Store server and transport
            sessionServers.set(sessionId, server);
            sessionTransports.set(sessionId, transport);

            // Handle connection close
            res.on('close', async () => {
                const serverToClose = sessionServers.get(sessionId);
                if (serverToClose) {
                    await serverToClose.close();
                }
                sessionApiKeys.delete(sessionId);
                sessionTimeouts.delete(sessionId);
                sessionQueryIds.delete(sessionId);
                sessionServers.delete(sessionId);
                sessionTransports.delete(sessionId);
            });

            // Connect server to transport
            await server.connect(transport);
            return;
        }

        // Handle POST messages endpoint
        if (req.method === 'POST' && url.pathname === '/messages') {
            const sessionId = url.searchParams.get('sessionId');
            const transport = sessionTransports.get(sessionId);
            const server = sessionServers.get(sessionId);

            if (transport && server) {
                // Check if Authorization header is present in POST request (for updating API key)
                const authHeader = req.headers.authorization || req.headers.Authorization;
                
                if (authHeader) {
                    let redashApiKey = null;
                    // Parse Authorization header
                    const parts = authHeader.split(' ');
                    if (parts.length === 2) {
                        redashApiKey = parts[1];
                    } else if (authHeader.startsWith('Key ')) {
                        redashApiKey = authHeader.substring(4);
                    } else {
                        redashApiKey = authHeader;
                    }
                    
                    if (redashApiKey) {
                        sessionApiKeys.set(sessionId, redashApiKey);
                    }
                }
                
                // Update timeout config from headers if provided in POST request
                const timeoutConfig = {
                    timeoutSeconds: req.headers['x-query-timeout-seconds'] || req.headers['x-timeout-seconds'],
                    pollMs: req.headers['x-query-poll-ms'] || req.headers['x-poll-ms'],
                    maxAgeSeconds: req.headers['x-query-max-age-seconds'] || req.headers['x-max-age-seconds']
                };
                
                if (timeoutConfig.timeoutSeconds || timeoutConfig.pollMs || timeoutConfig.maxAgeSeconds) {
                    sessionTimeouts.set(sessionId, timeoutConfig);
                }

                // Update query ID from headers if provided in POST request
                const queryId = req.headers['x-query-id'] || req.headers['x-redash-query-id'];
                if (queryId) {
                    sessionQueryIds.set(sessionId, queryId);
                }

                await transport.handlePostMessage(req, res);
            } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'No transport/server found for sessionId' }));
            }
            return;
        }

        // Unknown endpoint
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    });

    httpServer.listen(port, '0.0.0.0', () => {
        console.log(`MCP Server running in HTTP/SSE mode on port ${port}`);
        console.log(`Health check: http://localhost:${port}/health`);
        console.log(`SSE endpoint: http://localhost:${port}/sse`);
        console.log(`Messages endpoint: http://localhost:${port}/messages?sessionId=<session-id>`);
        console.log(`Use Authorization header: "Authorization: <your-redash-api-key>"`);
        console.log(`Timeout headers: X-Query-Timeout-Seconds, X-Query-Poll-Ms, X-Query-Max-Age-Seconds`);
        console.log(`Query ID header: X-Query-Id or X-Redash-Query-Id (defaults to 35173 or REDASH_QUERY_ID env var)`);
    });
} else {
    // MCP Stdio Mode (default)
    const server = new McpServer({
        name: 'demo-server',
        version: '1.0.0'
    });

    server.registerTool(
        'getData',
        {
            title: 'Fetch query data',
            description: 'Fetches customer postman usage data for the requested organization domain.',
            inputSchema: { org: z.string() }
        },
        getDataHandler
    );

    // Start receiving messages on stdin and sending messages on stdout
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
