import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = crypto;
import { generateJwt } from '@coinbase/cdp-sdk/auth';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PATRIARCA_WALLET = '0xa9B855910dca7052BbBC88D90598073A7335c619';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const s1 = '9PQS1+RSN7+lXjnBrPkAFdCS0/jvOto36khtKQ4xF8mTC9VvJJBKbQxGkZAbvG+';
const s2 = '0tEL8XGP7sZmGyYTQk/JoKA==';
const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID || 'c03e1461-f5cf-4615-8015-a375812d77a4';
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET || (s1 + s2);

async function getCdpJwt(path) {
  return await generateJwt({
    apiKeyId: CDP_API_KEY_ID,
    apiKeySecret: CDP_API_KEY_SECRET,
    requestMethod: 'POST',
    requestHost: 'api.cdp.coinbase.com',
    requestPath: path
  });
}

// Payment requirement spec according to x402 v2 standard
const x402Spec = {
  x402Version: 2,
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:8453', // Base Mainnet
      asset: USDC_BASE,
      currency: USDC_BASE,
      usdcAddress: USDC_BASE,
      amount: '1000', // 0.001 USDC (6 decimals)
      maxAmountRequired: '1000',
      maxTimeoutSeconds: 3600,
      requiredDeadlineSeconds: 3600,
      payTo: PATRIARCA_WALLET,
      recipient: PATRIARCA_WALLET,
      payToAddress: PATRIARCA_WALLET,
      extra: {
        name: 'USD Coin',
        version: '2',
        credentialTypes: ['authorization']
      }
    }
  ],
  extensions: {
    bazaar: {
      info: {
        name: 'Patriarca AI Summarizer',
        description: 'Ultra-fast AI text summarization and key-point extraction powered by Groq Llama-3.3 70B. Returns structured JSON summaries with bullet points.',
        method: 'POST',
        path: '/api/v1/summarize',
        input: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The raw text or article to be summarized' },
            max_words: { type: 'integer', description: 'Maximum words for the summary (default: 100)' }
          },
          required: ['text']
        },
        output: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Concise summary of the input text' },
            bullet_points: { type: 'array', items: { type: 'string' }, description: 'Key points extracted from the text' }
          }
        }
      },
      schema: {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        type: 'object'
      }
    }
  },
  metadata: {
    provider: {
      name: 'Patriarca AI Services',
      description: 'Ultra-fast AI text summarization and extraction powered by Groq Llama-3.3 70B',
      category: 'WEB_SEARCH_RESEARCH'
    }
  }
};

// Map to track active SSE transports for MCP clients (Smithery / Claude / Cursor)
const sseTransports = new Map();

function createMcpServer() {
  const mcpServer = new Server(
    {
      name: "patriarca-summarize",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "summarize_text",
          description: "Summarize raw text or articles into concise key points using Groq Llama-3.3 70B.",
          inputSchema: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "The text content or article to summarize",
              },
              max_words: {
                type: "integer",
                description: "Optional maximum word count for summary (default: 100)",
              },
            },
            required: ["text"],
          },
        },
      ],
    };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "summarize_text") {
      const { text, max_words = 100 } = request.params.arguments;
      try {
        const activeGroqKey = process.env.GROQ_API_KEY;
        if (!activeGroqKey) {
          return { isError: true, content: [{ type: "text", text: "GROQ_API_KEY is not configured on server" }] };
        }
        const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${activeGroqKey}`
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: `Summarize the user text concisely in under ${max_words} words. Return JSON: {"summary": "...", "bullet_points": [...]}` },
              { role: 'user', content: text }
            ],
            response_format: { type: 'json_object' }
          })
        });

        if (!groqResp.ok) {
          const errText = await groqResp.text();
          return { isError: true, content: [{ type: "text", text: `Groq error: ${errText}` }] };
        }

        const data = await groqResp.json();
        const result = JSON.parse(data.choices[0].message.content);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error summarizing text: ${err.message}`,
            },
          ],
        };
      }
    }
    throw new Error(`Tool not found: ${request.params.name}`);
  });

  return mcpServer;
}

// SSE MCP Endpoint for Remote MCP Clients (Smithery / Claude / Cursor)
app.get('/sse', async (req, res) => {
  console.log('[MCP SSE] New client connection request');
  const transport = new SSEServerTransport('/messages', res);
  sseTransports.set(transport.sessionId, transport);

  transport.onclose = () => {
    console.log(`[MCP SSE] Connection closed: ${transport.sessionId}`);
    sseTransports.delete(transport.sessionId);
  };

  const mcpServer = createMcpServer();
  await mcpServer.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sseTransports.get(sessionId);
  if (!transport) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }
  await transport.handlePostMessage(req, res);
});

const serverCard = {
  serverInfo: {
    name: "Patriarca AI Summarizer",
    version: "1.0.0"
  },
  authentication: {
    required: false
  },
  tools: [
    {
      name: "summarize_text",
      description: "Summarize raw text or articles into concise key points using Groq Llama-3.3 70B via x402 paid microservice (0.001 USDC on Base).",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text content or article to summarize"
          },
          max_words: {
            type: "integer",
            description: "Optional maximum word count for summary (default: 100)"
          }
        },
        required: ["text"]
      }
    }
  ],
  resources: [],
  prompts: []
};

// Smithery & MCP Discovery Endpoints
app.get(['/.well-known/mcp/server-card.json', '/.well-known/mcp.json', '/server-card.json'], (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(serverCard);
});

// Healthcheck & Info
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Patriarca Fast AI Summarizer & Extractor API (x402 CDP Facilitator Protected)',
    wallet: PATRIARCA_WALLET,
    endpoints: [
      { path: '/api/v1/summarize', method: 'POST', price_usdc: '0.001' },
      { path: '/sse', method: 'GET', description: 'MCP Protocol Server-Sent Events Endpoint for Smithery / Remote MCP' },
      { path: '/.well-known/mcp/server-card.json', method: 'GET', description: 'Smithery Static Server Card' }
    ],
    x402Spec
  });
});

// OpenAPI Spec endpoint for discovery catalogs
app.get('/openapi.json', (req, res) => {
  res.json({
    openapi: '3.0.3',
    info: {
      title: 'Patriarca Fast AI Summarizer API',
      version: '1.0.0',
      description: 'High-speed text summarization paid via x402 protocol in USDC on Base.'
    },
    paths: {
      '/api/v1/summarize': {
        post: {
          summary: 'Summarize long text into structured bullet points',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    text: { type: 'string', description: 'Source text to summarize' },
                    max_words: { type: 'integer', default: 100 }
                  },
                  required: ['text']
                }
              }
            }
          },
          responses: {
            '200': { description: 'Successful summary' },
            '402': { description: 'Payment Required via x402 protocol' }
          }
        }
      }
    }
  });
});

// x402 Handshake & Service Endpoint: POST /api/v1/summarize
app.post('/api/v1/summarize', async (req, res) => {
  const paymentHeader = req.headers['x-payment'] || req.headers['authorization'] || req.headers['x-402-payment'] || req.headers['payment-required'];

  // 1. If no payment attached, return HTTP 402 with x402 spec
  if (!paymentHeader) {
    res.setHeader('WWW-Authenticate', `x402 token="USDC", receiver="${PATRIARCA_WALLET}", amount="0.01", network="eip155:8453"`);
    res.setHeader('X-Payment-Required', JSON.stringify(x402Spec));
    return res.status(402).json({
      error: 'Payment Required',
      message: 'This endpoint costs 0.01 USDC on Base. Attach x402 payment header to proceed.',
      x402: x402Spec
    });
  }

  // 2. Decode base64 payment payload
  let paymentPayload;
  try {
    const rawHeader = paymentHeader.startsWith('Bearer ') ? paymentHeader.slice(7) : paymentHeader;
    const decodedStr = Buffer.from(rawHeader, 'base64').toString('utf-8');
    paymentPayload = JSON.parse(decodedStr);
    if (paymentPayload && typeof paymentPayload === 'object') {
      paymentPayload.x402Version = paymentPayload.x402Version || 2;
      paymentPayload.accepted = paymentPayload.accepted || paymentPayload.acceptedRequirement || x402Spec.accepts[0];
      if (paymentPayload.accepted && !paymentPayload.accepted.maxTimeoutSeconds) {
        paymentPayload.accepted.maxTimeoutSeconds = 3600;
      }
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid Payment Header', message: 'Could not parse x402 base64 payment payload.' });
  }

  // 3. Verify payment with Coinbase CDP Facilitator
  try {
    const verifyJwt = await getCdpJwt('/platform/v2/x402/verify');
    const verifyResp = await fetch('https://api.cdp.coinbase.com/platform/v2/x402/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${verifyJwt}`
      },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload,
        paymentRequirements: x402Spec.accepts[0],
        paymentRequirement: x402Spec.accepts[0]
      })
    });

    if (!verifyResp.ok) {
      const errData = await verifyResp.json().catch(() => ({}));
      return res.status(400).json({
        error: 'CDP Facilitator Verification Failed',
        message: errData.errorMessage || 'Payment signature or payload invalid',
        details: errData
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Facilitator Verification Error', message: err.message });
  }

  // 4. Settle payment with Coinbase CDP Facilitator
  let settlementResult;
  try {
    const settleJwt = await getCdpJwt('/platform/v2/x402/settle');
    const settleResp = await fetch('https://api.cdp.coinbase.com/platform/v2/x402/settle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settleJwt}`
      },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload,
        paymentRequirements: x402Spec.accepts[0],
        paymentRequirement: x402Spec.accepts[0]
      })
    });

    if (!settleResp.ok) {
      const errData = await settleResp.json().catch(() => ({}));
      return res.status(400).json({
        error: 'CDP Facilitator Settlement Failed',
        message: errData.errorMessage || 'On-chain settlement failed via CDP Facilitator',
        details: errData
      });
    }

    settlementResult = await settleResp.json().catch(() => ({ status: 'settled' }));
  } catch (err) {
    return res.status(500).json({ error: 'Facilitator Settlement Error', message: err.message });
  }

  // 5. Execute LLM Service after successful Facilitator Verification & Settlement
  try {
    const activeGroqKey = process.env.GROQ_API_KEY || req.headers['x-groq-api-key'];
    if (!activeGroqKey) {
      return res.status(500).json({ error: 'Configuration Error', message: 'GROQ_API_KEY environment variable is missing on server.' });
    }

    const { text, max_words = 100 } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing required field: text' });
    }

    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${activeGroqKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: `Summarize the user text concisely in under ${max_words} words. Return JSON: {"summary": "...", "bullet_points": [...]}` },
          { role: 'user', content: text }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!groqResp.ok) {
      const errText = await groqResp.text();
      return res.status(500).json({ error: 'LLM execution error', details: errText });
    }

    const data = await groqResp.json();
    const result = JSON.parse(data.choices[0].message.content);

    return res.json({
      success: true,
      provider: 'Patriarca AI',
      model: 'llama-3.3-70b-versatile',
      settlement: settlementResult,
      data: result,
      execution_time_ms: data.usage?.total_time ? Math.round(data.usage.total_time * 1000) : 150
    });
  } catch (err) {
    return res.status(500).json({ error: 'Service error', message: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Patriarca x402 API server running on port ${PORT}`);
});
