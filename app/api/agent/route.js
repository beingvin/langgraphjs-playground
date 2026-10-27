import { getAgentApp } from "@/lib/agent";
import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";

export async function POST(request) {
  try {
    const body = await request.json();
    const { message, resumeAction, threadId } = body;

    const currentThreadId = threadId || `session-${Date.now()}`;
    const config = {
      configurable: { thread_id: currentThreadId },
    };

    const agentApp = await getAgentApp();
    const encoder = new TextEncoder();

    // Create a ReadableStream for Server-Sent Events (SSE)
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          sendEvent({ type: "start", threadId: currentThreadId });

          // Determine input: either resuming an interrupt or starting a new message
          let graphInput;
          if (resumeAction) {
            // Human provided approval or rejection
            graphInput = new Command({ resume: resumeAction });
          } else if (message) {
            graphInput = { messages: [new HumanMessage(message)] };
          } else {
            sendEvent({ type: "error", error: "Either 'message' or 'resumeAction' is required." });
            controller.close();
            return;
          }

          // Stream graph lifecycle events using streamEvents v2
          const eventStream = agentApp.streamEvents(graphInput, {
            ...config,
            version: "v2",
          });

          for await (const event of eventStream) {
            const eventType = event.event;

            // 1. Node start lifecycle
            if (eventType === "on_chain_start") {
              if (event.name === "agent" || event.name === "tools") {
                sendEvent({
                  type: "node_start",
                  node: event.name,
                });
              }
            }

            // 2. Token streaming from LLM
            if (eventType === "on_chat_model_stream") {
              const chunk = event.data?.chunk;
              if (chunk?.content) {
                sendEvent({
                  type: "token",
                  content: chunk.content,
                });
              }
            }

            // 3. Tool execution started
            if (eventType === "on_tool_start") {
              sendEvent({
                type: "tool_start",
                name: event.name,
                input: event.data?.input,
              });
            }

            // 4. Tool execution finished
            if (eventType === "on_tool_end") {
              sendEvent({
                type: "tool_end",
                name: event.name,
                output: event.data?.output?.content || event.data?.output,
              });
            }
          }

          // Check if graph stopped because of an interrupt
          const snapshot = await agentApp.getState(config);
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
