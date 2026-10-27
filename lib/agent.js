import { StateGraph, MessagesAnnotation, START, MemorySaver, interrupt } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { z } from "zod";
import path from "path";

// 1. Core Built-in Tools
const getWeatherTool = tool(
  async ({ city }) => {
    const mockWeather = {
      london: "14°C, Rainy (Wind 12 km/h)",
      paris: "18°C, Partly Cloudy",
      tokyo: "22°C, Sunny and Pleasant",
      "new york": "20°C, Clear Sky",
      mumbai: "31°C, Humid & Warm",
      berlin: "16°C, Light Showers",
    };
    const key = city.toLowerCase();
    return mockWeather[key] || `24°C, Mild conditions in ${city}`;
  },
  {
    name: "get_weather",
    description: "Get real-time weather information for any given city.",
    schema: z.object({
      city: z.string().describe("The name of the city"),
    }),
  }
);

const calculatorTool = tool(
  async ({ operation, a, b }) => {
    switch (operation) {
      case "multiply": return `${a * b}`;
      case "add": return `${a + b}`;
      case "subtract": return `${a - b}`;
      case "divide": return b !== 0 ? `${a / b}` : "Error: Division by zero";
      default: return "Unsupported operation";
    }
  },
  {
    name: "calculator",
    description: "Perform arithmetic calculations (add, subtract, multiply, divide).",
    schema: z.object({
      operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("Operation"),
      a: z.number().describe("First operand"),
      b: z.number().describe("Second operand"),
    }),
  }
);

const lookupTimeTool = tool(
  async ({ timezone }) => {
    try {
      const now = new Date();
      return `Current time in ${timezone || "UTC"}: ${now.toLocaleTimeString("en-US", { timeZone: timezone || "UTC" })}`;
    } catch {
      return `Current UTC Time: ${new Date().toUTCString()}`;
    }
  },
  {
    name: "lookup_time",
    description: "Lookup the current time for a given time zone (e.g. 'Asia/Tokyo', 'America/New_York', 'Europe/London').",
    schema: z.object({
      timezone: z.string().describe("IANA time zone identifier"),
    }),
  }
);

const checkBalanceTool = tool(
  async ({ accountId }) => {
    const mockBalances = {
      "acc-99": "$45,250.00 USD (Checking)",
      "acc-main": "$128,500.00 USD (Treasury)",
      default: "$50,000.00 USD (Standard Checking)",
    };
    const key = (accountId || "default").toLowerCase();
    const balance = mockBalances[key] || `$35,000.00 USD for account ${accountId}`;
    return `Account: ${accountId || "Primary"} | Available Balance: ${balance}`;
  },
  {
    name: "check_balance",
    description: "Check the current available fund balance for an account.",
    schema: z.object({
      accountId: z.string().optional().describe("Optional account identifier (e.g. 'ACC-99', 'main')"),
    }),
  }
);

const transferFundsTool = tool(
  async ({ recipient, amount }) => {
    const decision = interrupt({
      action: "transfer_funds",
      recipient,
      amount,
      warning: `Transfer of $${amount.toLocaleString()} to ${recipient} is irreversible.`,
    });

    if (decision === "approve") {
      return `SUCCESS: Transferred $${amount.toLocaleString()} to ${recipient}. Reference ID: TXN-${Date.now()}`;
    } else {
      return `CANCELLED: Transfer of $${amount.toLocaleString()} to ${recipient} was rejected by user.`;
    }
  },
  {
    name: "transfer_funds",
    description: "Transfer money to a recipient or account. REQUIRES HUMAN APPROVAL via interrupt.",
    schema: z.object({
      recipient: z.string().describe("Recipient name or account identifier"),
      amount: z.number().describe("Amount in USD to transfer"),
    }),
  }
);

// 2. Load MCP Tools (Connect to our Custom Finance MCP Server)
const globalForAgent = globalThis;

async function getOrInitAgent() {
  if (globalForAgent.langGraphAgentApp) {
    return globalForAgent.langGraphAgentApp;
  }

  const serverScriptPath = path.resolve("./servers/finance-mcp-server.mjs");
  const mcpClient = new MultiServerMCPClient({
    servers: {
      finance: {
        command: "node",
        args: [serverScriptPath],
      },
    },
  });

  let mcpTools = [];
  try {
    mcpTools = await mcpClient.getTools();
  } catch (err) {
    console.error("Failed to load MCP tools:", err);
  }

  const allTools = [
    getWeatherTool,
    calculatorTool,
    lookupTimeTool,
    checkBalanceTool,
    transferFundsTool,
    ...mcpTools,
  ];

  function getModel() {
    if (process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      return new ChatVertexAI({
        model: "gemini-2.5-flash",
        temperature: 0.2,
        location: process.env.GOOGLE_CLOUD_REGION || "us-central1",
      });
    } else if (process.env.GEMINI_API_KEY) {
      return new ChatGoogleGenerativeAI({
        model: "gemini-2.5-flash",
        apiKey: process.env.GEMINI_API_KEY,
        temperature: 0.2,
      });
    }
    throw new Error("No Gemini API Key or Google Cloud credentials found.");
  }

  const baseModel = getModel();
  const modelWithTools = baseModel.bindTools(allTools);

  const SYSTEM_PROMPT = new SystemMessage(
    "You are a helpful, knowledgeable, and capable AI assistant equipped with both standard tools and Model Context Protocol (MCP) servers. " +
    "You can answer general questions, write essays, and have open-ended conversations. " +
    "You have access to: `get_weather`, `calculator`, `lookup_time`, `check_balance`, `transfer_funds`, and custom MCP tools (`finance_get_crypto_price`, `finance_convert_currency`, `finance_calculate_compound_interest`). " +
    "When a user asks for crypto prices (e.g. BTC, ETH, SOL), currency conversion (e.g. USD to INR), or compound interest, invoke the respective MCP tools. " +
    "When a user asks to transfer funds, call `transfer_funds` directly (it has a programmatic interrupt gate)."
  );

  async function agentNode(state) {
    const conversation = [SYSTEM_PROMPT, ...state.messages];
    const response = await modelWithTools.invoke(conversation);
    return { messages: [response] };
  }

  const toolNode = new ToolNode(allTools);

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", toolsCondition)
    .addEdge("tools", "agent");

  if (!globalForAgent.langGraphCheckpointer) {
    globalForAgent.langGraphCheckpointer = new MemorySaver();
  }

  const app = workflow.compile({
    checkpointer: globalForAgent.langGraphCheckpointer,
  });

  globalForAgent.langGraphAgentApp = app;
  return app;
}

export async function getAgentApp() {
  return await getOrInitAgent();
}
