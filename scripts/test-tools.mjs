import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

// 1. Define custom tools with Zod schema validation
const getWeatherTool = tool(
  async ({ city }) => {
    console.log(`[Tool Execution] Fetching weather for: "${city}"`);
    const mockWeather = {
      london: "14°C, Rainy",
      paris: "18°C, Partly Cloudy",
      tokyo: "22°C, Sunny",
      "new york": "20°C, Clear",
    };
    const key = city.toLowerCase();
    return mockWeather[key] || `25°C, Pleasant in ${city}`;
  },
  {
    name: "get_weather",
    description: "Get the current weather for a specified city.",
    schema: z.object({
      city: z.string().describe("The name of the city to get weather for"),
    }),
  }
);

const calculatorTool = tool(
  async ({ operation, a, b }) => {
    console.log(`[Tool Execution] Calculating: ${a} ${operation} ${b}`);
    switch (operation) {
      case "multiply": return `${a * b}`;
      case "add": return `${a + b}`;
      case "subtract": return `${a - b}`;
      case "divide": return `${a / b}`;
      default: return "Unsupported operation";
    }
  },
  {
    name: "calculator",
    description: "Perform basic mathematical calculations.",
    schema: z.object({
      operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("Operation to perform"),
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    }),
  }
);

const tools = [getWeatherTool, calculatorTool];

// 2. Initialize Model with tools bound
const baseModel = new ChatVertexAI({
  model: "gemini-2.5-flash",
  temperature: 0,
  location: process.env.GOOGLE_CLOUD_REGION || "us-central1",
});

const modelWithTools = baseModel.bindTools(tools);

// 3. Define LLM Node
async function agentNode(state) {
  console.log("-> Agent Node called with message count:", state.messages.length);
  const response = await modelWithTools.invoke(state.messages);
  return { messages: [response] };
}

// 4. Create Prebuilt ToolNode
const toolNode = new ToolNode(tools);

// 5. Build ReAct Cyclical Graph
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  // Conditional Edge: If agent called a tool -> go to "tools", else -> END
  .addConditionalEdges("agent", toolsCondition)
  // Tool Node loop back: After tool execution -> return to "agent"
  .addEdge("tools", "agent");

const app = workflow.compile();

// 6. Test Multi-step ReAct Flow
async function run() {
  console.log("=== Testing LangGraph.js ReAct Agent Loop ===");

  const prompt = "What is the weather in Tokyo right now, and what is 47 multiplied by 19?";
  console.log(`\nUser Prompt: "${prompt}"\n`);

  const result = await app.invoke({
    messages: [new HumanMessage(prompt)],
  });

  console.log("\n=== Complete Execution History ===");
  for (const msg of result.messages) {
    const role = msg.getType();
    if (role === "human") {
      console.log(`[User]: ${msg.content}`);
    } else if (role === "ai" && msg.tool_calls?.length) {
      console.log(`[AI Tool Calls]:`, msg.tool_calls.map(tc => `${tc.name}(${JSON.stringify(tc.args)})`).join(", "));
    } else if (role === "tool") {
      console.log(`[Tool Output (${msg.name})]: ${msg.content}`);
    } else if (role === "ai") {
      console.log(`[AI Final Response]:\n${msg.content}`);
    }
  }
}

run().catch(console.error);
