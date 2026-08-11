import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PATRIARCA_WALLET = '0xa9B855910dca7052BbBC88D90598073A7335c619';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Payment requirement spec according to x402 v2 standard
const x402Spec = {
  x402Version: 2,
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:8453', // Base Mainnet
      asset: USDC_BASE,
      amount: '10000', // 0.01 USDC (6 decimals)
      payTo: PATRIARCA_WALLET,
      extra: {
        name: 'USD Coin',
        version: '2'
      }
    }
  ],
  metadata: {
    provider: {
      name: 'Patriarca AI Services',
      description: 'Ultra-fast AI text summarization and extraction powered by Groq Llama-3.3 70B',
      category: 'WEB_SEARCH_RESEARCH',
      website: 'https://agent402.app'
    }
  }
};

// Healthcheck & Info
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Patriarca Fast AI Summarizer & Extractor API (x402 Enabled)',
    wallet: PATRIARCA_WALLET,
    endpoints: [
      { path: '/api/v1/summarize', method: 'POST', price_usdc: '0.01' },
      { path: '/api/v1/extract', method: 'POST', price_usdc: '0.01' }
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
  const paymentHeader = req.headers['authorization'] || req.headers['x-402-payment'] || req.headers['payment-required'];

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

  // 2. Process request using Groq LLM
  try {
    if (!GROQ_API_KEY) {
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
        'Authorization': `Bearer ${GROQ_API_KEY}`
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
      data: result,
      execution_time_ms: data.usage?.total_time ? Math.round(data.usage.total_time * 1000) : 150
    });
  } catch (err) {
    return res.status(500).json({ error: 'Service error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Patriarca x402 API server running on port ${PORT}`);
});
