import { StateGraph, MessagesAnnotation, START, MemorySaver } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// 1. Define tools
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

const tools = [getWeatherTool, calculatorTool, lookupTimeTool];

// 2. Initialize Model
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
const modelWithTools = baseModel.bindTools(tools);

// System prompt explicitly allowing both general conversation/knowledge and tool use
const SYSTEM_PROMPT = new SystemMessage(
  "You are a helpful, knowledgeable, and capable AI assistant. " +
  "You can answer general knowledge questions, write essays, explain concepts, brainstorm, write code, and have open-ended conversations using your full knowledge base. " +
  "You also have access to specialized tools (such as get_weather, calculator, and lookup_time). " +
  "Use your tools when the user requests specific weather data, exact math calculations, or timezone lookups. " +
  "For all other questions, requests, and conversations, answer directly and thoroughly without restricting yourself."
);

async function agentNode(state) {
  const conversation = [SYSTEM_PROMPT, ...state.messages];
  const response = await modelWithTools.invoke(conversation);
  return { messages: [response] };
}

const toolNode = new ToolNode(tools);

// 3. Build Graph
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", toolsCondition)
  .addEdge("tools", "agent");

// Singleton Checkpointer across requests in Node server runtime
const globalForAgent = globalThis;
if (!globalForAgent.langGraphCheckpointer) {
  globalForAgent.langGraphCheckpointer = new MemorySaver();
}

export const agentApp = workflow.compile({
  checkpointer: globalForAgent.langGraphCheckpointer,
});
