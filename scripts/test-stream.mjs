import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { StateGraph, MessagesAnnotation, START } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

// 1. Define sample tool
const calculateStockValue = tool(
  async ({ shares, pricePerShare }) => {
    console.log(`\n⚙️  [Tool Execution] Calculating: ${shares} shares @ $${pricePerShare}`);
    const total = shares * pricePerShare;
    return `Total value: $${total.toLocaleString()}`;
  },
  {
    name: "calculate_stock_value",
    description: "Calculate total stock portfolio value given shares and price.",
    schema: z.object({
      shares: z.number().describe("Number of shares"),
      pricePerShare: z.number().describe("Price per share in USD"),
    }),
  }
);

const tools = [calculateStockValue];

// 2. Initialize Model with streaming enabled
const model = new ChatVertexAI({
  model: "gemini-2.5-flash",
  temperature: 0.2,
  location: process.env.GOOGLE_CLOUD_REGION || "us-central1",
  streaming: true,
}).bindTools(tools);

async function agentNode(state) {
  const response = await model.invoke(state.messages);
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

const app = workflow.compile();

// 4. Test streamEvents API
async function run() {
  console.log("=== Testing LangGraph.js Real-Time Event Streaming ===");

  const prompt = "I hold 150 shares of Company X at $42.5 per share. Calculate the total value and explain in 1 sentence.";
  console.log(`Prompt: "${prompt}"\n`);
  console.log("--- Starting Stream ---");

  const eventStream = app.streamEvents(
    { messages: [new HumanMessage(prompt)] },
    { version: "v2" }
  );

  for await (const event of eventStream) {
    const eventType = event.event;

    // Detect node lifecycle transitions
    if (eventType === "on_chain_start" && event.name === "agent") {
      process.stdout.write("\n[Node: agent started]");
    } else if (eventType === "on_chain_start" && event.name === "tools") {
      process.stdout.write("\n[Node: tools started]");
    }

    // Stream LLM tokens in real-time as they are generated
    if (eventType === "on_chat_model_stream") {
      const chunk = event.data?.chunk;
      if (chunk?.content) {
        process.stdout.write(chunk.content);
      }
    }

    // Capture tool execution results
    if (eventType === "on_tool_end") {
      console.log(`\n[Tool Finished]: ${event.name} -> Output: ${event.data?.output?.content}`);
    }
  }

  console.log("\n\n--- Stream Completed ---");
}

run().catch(console.error);
