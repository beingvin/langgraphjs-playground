import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// 1. Initialize our Custom MCP Server instance
const server = new Server(
  {
    name: "finance-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// 2. Define Tools available on this MCP Server
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_crypto_price",
        description: "Get real-time mock price and 24h change for a cryptocurrency.",
        inputSchema: {
          type: "object",
          properties: {
            symbol: {
              type: "string",
              description: "Ticker symbol (e.g. BTC, ETH, SOL)",
            },
          },
          required: ["symbol"],
        },
      },
      {
        name: "convert_currency",
        description: "Convert an amount from one fiat currency to another.",
        inputSchema: {
          type: "object",
          properties: {
            amount: { type: "number", description: "Amount of money" },
            from: { type: "string", description: "Source currency (e.g. USD, EUR, INR)" },
            to: { type: "string", description: "Target currency (e.g. USD, EUR, INR)" },
          },
          required: ["amount", "from", "to"],
        },
      },
      {
        name: "calculate_compound_interest",
        description: "Calculate future investment value with compound interest.",
        inputSchema: {
          type: "object",
          properties: {
            principal: { type: "number", description: "Initial investment amount" },
            ratePercent: { type: "number", description: "Annual interest rate (e.g. 7.5)" },
            years: { type: "number", description: "Number of years invested" },
          },
          required: ["principal", "ratePercent", "years"],
        },
      },
    ],
  };
});

// 3. Handle Tool Execution Calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_crypto_price") {
    const prices = {
      BTC: { price: "$67,420 USD", change24h: "+3.4%" },
      ETH: { price: "$3,480 USD", change24h: "+1.8%" },
      SOL: { price: "$182 USD", change24h: "+6.2%" },
    };
    const key = (args.symbol || "").toUpperCase();
    const data = prices[key] || { price: "$12.50 USD", change24h: "0.0%" };
    return {
      content: [
        {
          type: "text",
          text: `Crypto: ${key} | Price: ${data.price} | 24h Change: ${data.change24h}`,
        },
      ],
    };
  }

  if (name === "convert_currency") {
    const { amount, from, to } = args;
    const rates = {
      "USD-INR": 83.5,
      "INR-USD": 0.012,
      "USD-EUR": 0.92,
      "EUR-USD": 1.09,
    };
    const pair = `${from.toUpperCase()}-${to.toUpperCase()}`;
    const rate = rates[pair] || 1.0;
    const converted = (amount * rate).toFixed(2);
    return {
      content: [
        {
          type: "text",
          text: `${amount} ${from.toUpperCase()} = ${converted} ${to.toUpperCase()} (Rate: ${rate})`,
        },
      ],
    };
  }

  if (name === "calculate_compound_interest") {
    const { principal, ratePercent, years } = args;
    const rate = ratePercent / 100;
    const finalAmount = (principal * Math.pow(1 + rate, years)).toFixed(2);
    const totalInterest = (finalAmount - principal).toFixed(2);
    return {
      content: [
        {
          type: "text",
          text: `After ${years} years at ${ratePercent}% annual return: Total Value = $${Number(finalAmount).toLocaleString()}, Interest Earned = $${Number(totalInterest).toLocaleString()}`,
        },
      ],
    };
  }

  throw new Error(`Tool not found: ${name}`);
});

// 4. Expose Resources (MCP Data files)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "market://daily-briefing",
        name: "Daily Market Briefing",
        mimeType: "text/plain",
        description: "Official market morning note and economic index snapshot.",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === "market://daily-briefing") {
    return {
      contents: [
        {
          uri: "market://daily-briefing",
          mimeType: "text/plain",
          text: "MARKET BRIEFING: Markets opened higher with tech leading gains. Fed signaled steady rates. Crypto volatility remains elevated.",
        },
      ],
    };
  }
  throw new Error(`Resource not found: ${request.params.uri}`);
});

// 5. Connect via Standard I/O (Stdio) Transport
const transport = new StdioServerTransport();
await server.connect(transport);
