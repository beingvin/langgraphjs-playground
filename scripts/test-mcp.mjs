import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { StateGraph, MessagesAnnotation, START } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import path from "path";

async function run() {
  console.log("=== Testing LangGraph.js with Model Context Protocol (MCP) ===\n");

  const playgroundPath = path.resolve(".");
  console.log(`Connecting to Official MCP Server (Filesystem) scoped to: ${playgroundPath}...`);

  // 1. Initialize MCP Client connecting to the official, free @modelcontextprotocol/server-filesystem
  const mcpClient = new MultiServerMCPClient({
    servers: {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", playgroundPath],
      },
    },
  });

  // 2. Discover MCP Tools automatically from the server
  console.log("-> Querying MCP Server for exposed tools...");
  const mcpTools = await mcpClient.getTools();

  console.log(`\n✅ Connected! Discovered ${mcpTools.length} MCP Tools from the server:`);
  mcpTools.forEach((t) => {
    console.log(`   • ${t.name}: ${t.description?.slice(0, 75)}...`);
  });

  // 3. Initialize Model and bind dynamic MCP tools
  const model = new ChatVertexAI({
    model: "gemini-2.5-flash",
    temperature: 0.1,
    location: process.env.GOOGLE_CLOUD_REGION || "us-central1",
  }).bindTools(mcpTools);

  const SYSTEM_PROMPT = new SystemMessage(
    "You are an AI developer assistant equipped with standard Model Context Protocol (MCP) tools. " +
    "Use your MCP tools (like list_directory, read_file) to inspect and report on project files when requested. " +
    "Always provide concise, helpful answers."
  );

  async function agentNode(state) {
    const conversation = [SYSTEM_PROMPT, ...state.messages];
    const response = await model.invoke(conversation);
    return { messages: [response] };
  }

  const toolNode = new ToolNode(mcpTools);

  // 4. Build standard LangGraph ReAct Graph with MCP tools
  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", toolsCondition)
    .addEdge("tools", "agent");

  const app = workflow.compile();

  // 5. Test Invocation: Prompt the agent to inspect files via MCP
  const prompt = "Please inspect my current directory using your MCP tools and tell me what the project name is in package.json.";
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
      console.log(`[AI invoked MCP Tool]:`, msg.tool_calls.map(tc => `${tc.name}(${JSON.stringify(tc.args)})`).join(", "));
    } else if (role === "tool") {
      const preview = typeof msg.content === "string" ? msg.content.slice(0, 120) : JSON.stringify(msg.content).slice(0, 120);
      console.log(`[MCP Tool Response (${msg.name})]: ${preview}...`);
    } else if (role === "ai") {
      console.log(`\n[Agent Final Answer]:\n${msg.content}`);
    }
  }

  // 6. Graceful cleanup of MCP process connections
  await mcpClient.close();
  console.log("\n✅ MCP Client disconnected cleanly.");
}

run().catch(console.error);
