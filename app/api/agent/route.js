import { NextResponse } from "next/server";
import { agentApp } from "@/lib/agent";
import { HumanMessage } from "@langchain/core/messages";

export async function POST(request) {
  try {
    const { message, threadId } = await request.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const currentThreadId = threadId || `session-${Date.now()}`;
    const config = {
      configurable: { thread_id: currentThreadId },
    };

    // Invoke the state graph with thread memory
    const result = await agentApp.invoke(
      {
        messages: [new HumanMessage(message)],
      },
      config
    );

    // Extract execution trace and final output
    const steps = [];
    let finalAnswer = "";

    for (const msg of result.messages) {
      const type = msg.getType();
      if (type === "ai" && msg.tool_calls?.length > 0) {
        steps.push({
          type: "tool_call",
          tools: msg.tool_calls.map((tc) => ({
            name: tc.name,
            args: tc.args,
          })),
        });
      } else if (type === "tool") {
        steps.push({
          type: "tool_result",
          toolName: msg.name,
          output: msg.content,
        });
      } else if (type === "ai" && (!msg.tool_calls || msg.tool_calls.length === 0)) {
        finalAnswer = msg.content;
      }
    }

    return NextResponse.json({
      answer: finalAnswer,
      steps: steps,
      threadId: currentThreadId,
      totalMessagesInThread: result.messages.length,
    });
  } catch (error) {
    console.error("API /api/agent error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to execute agent." },
      { status: 500 }
    );
  }
}
