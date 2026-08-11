// Cloudflare Worker for Patriarca x402 API
const PATRIARCA_WALLET = '0xa9B855910dca7052BbBC88D90598073A7335c619';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const x402Spec = {
  x402Version: 2,
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:8453',
      asset: USDC_BASE,
      amount: '10000',
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-402-Payment, Payment-Required'
        }
      });
    }

    // Root info
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'Patriarca Fast AI Summarizer & Extractor API (x402 Enabled)',
        wallet: PATRIARCA_WALLET,
        endpoints: [
          { path: '/api/v1/summarize', method: 'POST', price_usdc: '0.01' },
          { path: '/api/v1/extract', method: 'POST', price_usdc: '0.01' }
        ],
        x402Spec
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // OpenAPI Spec
    if (url.pathname === '/openapi.json') {
      return new Response(JSON.stringify({
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
              responses: {
                '200': { description: 'Successful summary' },
                '402': { description: 'Payment Required via x402 protocol' }
              }
            }
          }
        }
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Endpoint POST /api/v1/summarize
    if (url.pathname === '/api/v1/summarize' && request.method === 'POST') {
      const paymentHeader = request.headers.get('Authorization') || request.headers.get('x-402-payment') || request.headers.get('payment-required');

      // Return 402 if unpaid
      if (!paymentHeader) {
        return new Response(JSON.stringify({
          error: 'Payment Required',
          message: 'This endpoint costs 0.01 USDC on Base. Attach x402 payment header to proceed.',
          x402: x402Spec
        }), {
          status: 402,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'WWW-Authenticate': `x402 token="USDC", receiver="${PATRIARCA_WALLET}", amount="0.01", network="eip155:8453"`,
            'X-Payment-Required': JSON.stringify(x402Spec)
          }
        });
      }

      // Execute Groq call if payment attached
      try {
        const groqApiKey = env.GROQ_API_KEY;
        if (!groqApiKey) {
          return new Response(JSON.stringify({ error: 'Configuration Error', message: 'GROQ_API_KEY environment variable is missing.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        const body = await request.json();
        const { text, max_words = 100 } = body;
        if (!text) {
          return new Response(JSON.stringify({ error: 'Missing required field: text' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${groqApiKey}`
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

        const data = await groqResp.json();
        const result = JSON.parse(data.choices[0].message.content);

        return new Response(JSON.stringify({
          success: true,
          provider: 'Patriarca AI',
          model: 'llama-3.3-70b-versatile',
          data: result
        }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Execution error', message: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
};
