import { getAgentApp } from "@/lib/agent";
import { multiAgentApp } from "@/lib/multi-agent";
import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";

export async function POST(request) {
  try {
    const body = await request.json();
    const { message, resumeAction, threadId, mode } = body;

    const currentThreadId = threadId || `session-${Date.now()}`;
    const config = {
      configurable: { thread_id: currentThreadId },
      recursionLimit: 20,
    };

    const isMultiMode = mode === "multi";
    const activeApp = isMultiMode ? multiAgentApp : await getAgentApp();

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          sendEvent({ type: "start", threadId: currentThreadId, mode: mode || "single" });

          let graphInput;
          if (resumeAction) {
            graphInput = new Command({ resume: resumeAction });
          } else if (message) {
            graphInput = { messages: [new HumanMessage(message)] };
          } else {
            sendEvent({ type: "error", error: "Either 'message' or 'resumeAction' is required." });
            controller.close();
            return;
          }

          let activeNode = "";

          const eventStream = activeApp.streamEvents(graphInput, {
            ...config,
            version: "v2",
          });

          for await (const event of eventStream) {
            const eventType = event.event;

            // 1. Node transitions
            if (eventType === "on_chain_start") {
              const nodeNames = ["agent", "tools", "supervisor", "ResearchAgent", "FinanceAgent", "synthesizer"];
              if (nodeNames.includes(event.name)) {
                activeNode = event.name;
                sendEvent({
                  type: "node_start",
                  node: event.name,
                });
              }
            }

            // 2. Token streaming
            if (eventType === "on_chat_model_stream") {
              const chunk = event.data?.chunk;
              if (chunk?.content) {
                // In multi-agent mode, ONLY stream tokens from the synthesizer (final answer)
                // This keeps intermediate supervisor JSON routing out of the chat bubble!
                if (!isMultiMode || activeNode === "synthesizer") {
                  sendEvent({
                    type: "token",
                    content: chunk.content,
                    sourceNode: activeNode,
                  });
                }
              }
            }

            // 3. Tool execution started
            if (eventType === "on_tool_start") {
              sendEvent({
                type: "tool_start",
                name: event.name,
                input: event.data?.input,
                node: activeNode,
              });
            }

            // 4. Tool execution finished
            if (eventType === "on_tool_end") {
              sendEvent({
                type: "tool_end",
                name: event.name,
                output: event.data?.output?.content || event.data?.output,
                node: activeNode,
              });
            }
          }

          // Single agent HITL interrupt check
          if (!isMultiMode) {
            const snapshot = await activeApp.getState(config);
            if (snapshot.tasks?.length > 0 && snapshot.tasks[0]?.interrupts?.length > 0) {
              const interruptVal = snapshot.tasks[0].interrupts[0].value;
              sendEvent({
                type: "interrupt",
                payload: interruptVal,
                threadId: currentThreadId,
              });
            } else {
              sendEvent({ type: "done" });
            }
          } else {
            sendEvent({ type: "done" });
          }

          controller.close();
        } catch (streamError) {
          console.error("Stream execution error:", streamError);
          sendEvent({ type: "error", error: streamError.message });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("API /api/agent error:", error);
    return new Response(JSON.stringify({ error: error.message || "Failed to start stream." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
