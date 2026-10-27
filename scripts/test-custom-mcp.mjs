import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { StateGraph, MessagesAnnotation, START } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import path from "path";

async function run() {
  console.log("=== Testing Custom Finance MCP Server with LangGraph.js ===\n");

  const serverScriptPath = path.resolve("./servers/finance-mcp-server.mjs");
  console.log(`Connecting to custom MCP Server: ${serverScriptPath}...`);

  // 1. Initialize MCP Client connecting to our custom MCP server via Node stdio
  const mcpClient = new MultiServerMCPClient({
    servers: {
      finance: {
        command: "node",
        args: [serverScriptPath],
      },
    },
  });

  // 2. Discover MCP Tools from our custom server
  console.log("-> Querying custom MCP Server for tools...");
  const mcpTools = await mcpClient.getTools();

  console.log(`\n✅ Connected! Discovered ${mcpTools.length} Custom MCP Tools:`);
  mcpTools.forEach((t) => {
    console.log(`   • ${t.name}: ${t.description}`);
  });

  // 3. Initialize Model and bind the discovered tools
  const model = new ChatVertexAI({
    model: "gemini-2.5-flash",
    temperature: 0.1,
    location: process.env.GOOGLE_CLOUD_REGION || "us-central1",
  }).bindTools(mcpTools);

  const SYSTEM_PROMPT = new SystemMessage(
    "You are a financial advisor AI connected to a custom Model Context Protocol (MCP) server. " +
    "Use your MCP tools (`get_crypto_price`, `convert_currency`, `calculate_compound_interest`) to fulfill user requests accurately."
  );

  async function agentNode(state) {
    const conversation = [SYSTEM_PROMPT, ...state.messages];
    const response = await model.invoke(conversation);
    return { messages: [response] };
  }

  const toolNode = new ToolNode(mcpTools);

  // 4. Build standard LangGraph ReAct Graph
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", toolsCondition)
    .addEdge("tools", "agent");

  const app = workflow.compile();

  // 5. Test Invocation: Prompt the agent with a multi-tool financial question
  const prompt = "What is the price of Solana (SOL), and how much is 500 USD in INR?";
  console.log(`\n--- Running Graph with User Prompt: "${prompt}" ---\n`);

  const result = await app.invoke({
    messages: [new HumanMessage(prompt)],
  });

  console.log("\n=== Complete Execution History ===");
  for (const msg of result.messages) {
    const role = msg.getType();
    if (role === "human") {
      console.log(`[User]: ${msg.content}`);
    } else if (role === "ai" && msg.tool_calls?.length) {
      console.log(`[AI invoked Custom MCP Tool]:`, msg.tool_calls.map(tc => `${tc.name}(${JSON.stringify(tc.args)})`).join(", "));
    } else if (role === "tool") {
      console.log(`[MCP Server Result]: ${msg.content}`);
    } else if (role === "ai") {
      console.log(`\n[Agent Final Answer]:\n${msg.content}`);
    }
  }

  // 6. Clean disconnection
  await mcpClient.close();
  console.log("\n✅ Custom MCP Client disconnected cleanly.");
}

run().catch(console.error);
