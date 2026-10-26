import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";

let model;

// Check if Vertex AI or Google AI Studio is configured
if (process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.log("Using Google Cloud Vertex AI...");
  model = new ChatVertexAI({
    model: "gemini-2.5-flash",
    temperature: 0.7,
    location: process.env.GOOGLE_CLOUD_REGION || "us-central1",
  });
} else if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "YOUR_GEMINI_API_KEY_HERE") {
  console.log("Using Google AI Studio (API Key)...");
  model = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.7,
  });
} else {
  console.error(
    "\nError: Please configure either Vertex AI or Google AI Studio in .env.local:\n" +
    "- For Vertex AI: Set GOOGLE_CLOUD_PROJECT and (optional) GOOGLE_APPLICATION_CREDENTIALS path.\n" +
    "- For AI Studio: Set GEMINI_API_KEY.\n"
  );
  process.exit(1);
}

// 1. Define LLM Node
async function callModel(state) {
  console.log("-> LLM Node received", state.messages.length, "message(s)");
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

// 2. Build Graph using MessagesAnnotation
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addEdge(START, "agent")
  .addEdge("agent", END);

// 3. Compile Graph
const app = workflow.compile();

// 4. Test Invocation
async function run() {
  console.log("=== Testing LangGraph.js LLM Node ===");
  const inputMessage = new HumanMessage("Explain what LangGraph is in 2 concise sentences.");
  // const inputMessage = new HumanMessage("Explain what gravity is in 2 concise sentences.");


  const output = await app.invoke({
    messages: [inputMessage],
  });

  console.log("\n=== Response from Agent ===");
  const lastMessage = output.messages[output.messages.length - 1];
  console.log(lastMessage.content);
}

run().catch(console.error);
