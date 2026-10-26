import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { StateGraph, MessagesAnnotation, START, END, MemorySaver, interrupt, Command } from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { tool } from "@langchain/core/tools";
import { HumanMessage, ToolMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

// 1. Safe tool (no human approval needed)
const checkBalanceTool = tool(
  async ({ accountId }) => {
    console.log(`\n  [Tool Execution: check_balance] Checking balance for ${accountId}`);
    return "Account balance: $50,000 USD";
  },
  {
    name: "check_balance",
    description: "Check the account balance.",
    schema: z.object({
      accountId: z.string().describe("The account identifier"),
    }),
  }
);

// 2. SENSITIVE tool with interrupt() (Requires Human Approval!)
const transferFundsTool = tool(
  async ({ recipient, amount }) => {
    console.log(`\n⚠️  [HITL Gate] Requesting human approval to transfer $${amount} to ${recipient}...`);

    // interrupt() pauses graph execution and saves state to the checkpointer!
    const humanApproval = interrupt({
      action: "transfer_funds",
      recipient,
      amount,
      warning: `Transferring $${amount} to ${recipient} is irreversible.`,
    });

    console.log(`\n👉 [HITL Gate Resumed] Received human decision: "${humanApproval}"`);

    if (humanApproval === "approve") {
      return `SUCCESS: Transferred $${amount} to ${recipient}. Reference ID: TXN-${Date.now()}`;
    } else {
      return `CANCELLED: Transfer of $${amount} to ${recipient} was rejected by human operator.`;
    }
  },
  {
    name: "transfer_funds",
    description: "Transfer money to a recipient. REQUIRES HUMAN CONFIRMATION.",
    schema: z.object({
      recipient: z.string().describe("Recipient name or wallet address"),
      amount: z.number().describe("Amount in USD to transfer"),
    }),
  }
);

const tools = [checkBalanceTool, transferFundsTool];

// 3. Initialize Model
const model = new ChatVertexAI({
  model: "gemini-2.5-flash",
  temperature: 0.1,
  location: process.env.GOOGLE_CLOUD_REGION || "us-central1",
}).bindTools(tools);

const SYSTEM_PROMPT = new SystemMessage(
  "You are a secure banking AI assistant. " +
  "You can check balances and transfer funds using your tools. " +
  "When the user requests a transfer, invoke transfer_funds. " +
  "Always confirm the final status with the user."
);

async function agentNode(state) {
  const conversation = [SYSTEM_PROMPT, ...state.messages];
  const response = await model.invoke(conversation);
  return { messages: [response] };
}

const toolNode = new ToolNode(tools);

// 4. Build Graph
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", toolsCondition)
  .addEdge("tools", "agent");

// A Checkpointer is MANDATORY for interrupt() so LangGraph can persist the paused graph
const checkpointer = new MemorySaver();
const app = workflow.compile({ checkpointer });

// 5. Test Human-in-the-Loop Execution
async function run() {
  console.log("=== Testing LangGraph.js Human-in-the-Loop (interrupt) ===\n");

  const threadConfig = {
    configurable: { thread_id: "bank-session-001" },
  };

  // Turn 1: User issues sensitive transfer command
  console.log("--- Turn 1: User requests transfer ---");
  const prompt = "Please check my balance on ACC-99, and if I have enough, transfer $1,500 to Bob.";
  console.log(`User: "${prompt}"\n`);

  // Invoke graph - this will run check_balance, then pause when transferFundsTool hits interrupt()
  const result1 = await app.invoke(
    { messages: [new HumanMessage(prompt)] },
    threadConfig
  );

  // Check state snapshot after the interrupt
  const stateSnapshot = await app.getState(threadConfig);
  console.log("\n--- Graph Execution Paused by interrupt() ---");
  console.log("Next executable step in graph:", stateSnapshot.next);
  console.log("Interrupt payload from tool:", JSON.stringify(stateSnapshot.tasks[0]?.interrupts[0]?.value, null, 2));

  // Turn 2: Simulate Human Operator Approving the Action
  console.log("\n--- Turn 2: Human Operator clicks [APPROVE] ---");
  // We resume execution by passing Command({ resume: "approve" }) to the same threadConfig!
  const result2 = await app.invoke(
    new Command({ resume: "approve" }),
    threadConfig
  );

  console.log("\n=== Final Response after Approval ===");
  const finalMsg = result2.messages[result2.messages.length - 1];
  console.log(finalMsg.content);
}

run().catch(console.error);
