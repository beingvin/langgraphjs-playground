import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { StateGraph, MessagesAnnotation, START, END, MemorySaver } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { tool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

// 1. Define a tool: user profile memory saver
const getUserProfile = tool(
  async ({ query }) => {
    console.log(`[Tool Execution] Looking up memory for: "${query}"`);
    return "User's favorite color is Emerald Green and prefers metric units.";
  },
  {
    name: "get_user_profile",
    description: "Look up stored user preferences and profile notes.",
    schema: z.object({
      query: z.string().describe("Topic to look up about user preferences"),
    }),
  }
);

const tools = [getUserProfile];

// 2. Initialize Model
const baseModel = new ChatVertexAI({
  model: "gemini-2.5-flash",
  temperature: 0.2,
  location: process.env.GOOGLE_CLOUD_REGION || "us-central1",
});

const modelWithTools = baseModel.bindTools(tools);

async function agentNode(state) {
  const response = await modelWithTools.invoke(state.messages);
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

// 4. Attach Checkpointer (MemorySaver)
const checkpointer = new MemorySaver();
const app = workflow.compile({ checkpointer });

// 5. Test Multi-turn Conversation with thread_id
async function run() {
  console.log("=== Testing LangGraph.js Memory & Checkpointing ===\n");

  // Config with thread_id separates user sessions
  const threadConfig = {
    configurable: { thread_id: "user-session-001" },
  };

  // Turn 1: Introduce information
  console.log("--- Turn 1: User introduces name and asks a question ---");
  const turn1Input = {
    messages: [new HumanMessage("Hi! My name is Alex. Can you check my profile for my favorite color?")],
  };

  const response1 = await app.invoke(turn1Input, threadConfig);
  const lastMsg1 = response1.messages[response1.messages.length - 1];
  console.log(`[Assistant]: ${lastMsg1.content}\n`);

  // Turn 2: Follow-up question without repeating identity
  console.log("--- Turn 2: Follow-up (testing memory persistence) ---");
  const turn2Input = {
    messages: [new HumanMessage("What was my name again and what color did you say I like?")],
  };

  const response2 = await app.invoke(turn2Input, threadConfig);
  const lastMsg2 = response2.messages[response2.messages.length - 1];
  console.log(`[Assistant]: ${lastMsg2.content}\n`);

  // Inspect the saved checkpoint state
  console.log("--- Inspecting Saved Checkpoint State ---");
  const stateSnapshot = await app.getState(threadConfig);
  console.log("Thread ID:", stateSnapshot.config.configurable.thread_id);
  console.log("Total messages persisted in thread:", stateSnapshot.values.messages.length);
  console.log("Next executable step:", stateSnapshot.next);
}

run().catch(console.error);
