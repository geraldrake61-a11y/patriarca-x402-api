# Patriarca AI Summarizer API (x402 Base USDC)

Ultra-fast AI text summarization powered by Groq Llama-3.3 70B with x402 Base USDC micropayments (**0.001 USDC** per request).

## Features
- **Instant Summarization**: Returns concise summary & bullet points in ~100ms.
- **x402 Native**: Standard HTTP 402 pay-per-call (0.001 USDC on Base).
- **MCP Server Ready**: Built-in Model Context Protocol (MCP) server for Claude Desktop, Cursor, LangChain, Smithery.ai, and Glama.ai.

## Endpoints

### `POST /api/v1/summarize`
- **URL**: `https://patriarca-x402-api-production.up.railway.app/api/v1/summarize`
- **Cost**: `0.001 USDC` (1,000 units, Base Mainnet)
- **PayTo**: `0xa9B855910dca7052BbBC88D90598073A7335c619`
- **USDC Asset**: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

### Request Body
```json
{
  "text": "The article or long text to summarize",
  "max_words": 100
}
```

### Response Body
```json
{
  "success": true,
  "provider": "Patriarca AI",
  "model": "llama-3.3-70b-versatile",
  "data": {
    "summary": "Executive summary text...",
    "bullet_points": ["Point 1", "Point 2"]
  }
}
```

## Model Context Protocol (MCP) Integration

### Claude Desktop / Cursor Config

```json
{
  "mcpServers": {
    "patriarca-summarize": {
      "command": "npx",
      "args": ["-y", "github:geraldrake61-a11y/patriarca-x402-api"]
    }
  }
}
```

Smithery.ai integration: Includes `smithery.yaml` for automatic indexing.

## License
MIT
