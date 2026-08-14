// index-mcp.js - MCP Server for Patriarca AI Summarizer
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API_URL = "https://patriarca-x402-api-production.up.railway.app/api/v1/summarize";

const server = new Server(
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

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "summarize_text",
        description: "Summarize raw text or articles into concise key points using Groq Llama-3.3 70B via x402 paid microservice (0.001 USDC on Base).",
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "summarize_text") {
    const { text, max_words } = request.params.arguments;
    try {
      const initResp = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, max_words }),
      });

      if (initResp.status === 402) {
        const payload = await initResp.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "PAYMENT_REQUIRED",
                message: "This endpoint costs 0.001 USDC on Base. Attach x402 payment header to proceed.",
                endpoint: API_URL,
                x402: payload.x402,
              }, null, 2),
            },
          ],
        };
      }

      const result = await initResp.json();
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
            text: `Error calling Patriarca Summarizer API: ${err.message}`,
          },
        ],
      };
    }
  }

  throw new Error(`Tool not found: ${request.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP Server Error:", err);
  process.exit(1);
});
