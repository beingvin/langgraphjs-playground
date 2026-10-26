"use client";

import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hello! I am your LangGraph.js Agent powered by Vertex AI Gemini. I have access to tools (`get_weather`, `calculator`, `lookup_time`) and maintain conversation memory across messages in this thread. What would you like to explore?",
      steps: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState(`thread-${Date.now().toString(36)}`);
  const [expandedSteps, setExpandedSteps] = useState({});
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSend = async (customPrompt) => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim() || loading) return;

    const userMessageId = `user-${Date.now()}`;
    const userMsg = {
      id: userMessageId,
      role: "user",
      content: textToSend,
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customPrompt) setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          threadId: threadId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Agent execution failed");
      }

      const agentMessageId = `agent-${Date.now()}`;
      const agentMsg = {
        id: agentMessageId,
        role: "assistant",
        content: data.answer || "Workflow finished with no final message.",
        steps: data.steps || [],
        threadId: data.threadId,
      };

      setMessages((prev) => [...prev, agentMsg]);
      // Auto-expand step badge if tools were executed
      if (data.steps?.length > 0) {
        setExpandedSteps((prev) => ({ ...prev, [agentMessageId]: true }));
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: `⚠️ Error: ${err.message}`,
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleNewSession = () => {
    const newId = `thread-${Date.now().toString(36)}`;
    setThreadId(newId);
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: "assistant",
        content: `New thread initialized (${newId}). Memory is reset for this session!`,
        steps: [],
      },
    ]);
  };

  const toggleSteps = (id) => {
    setExpandedSteps((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const quickPrompts = [
    "What is the weather in Tokyo and calculate 84 divided by 7?",
    "What time is it in Asia/Tokyo right now?",
    "My name is Priya. Please remember my favorite city is Paris.",
    "What is my name and what is the weather in my favorite city?",
  ];

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logoBadge}>LG</div>
          <div>
            <h1 style={styles.title}>LangGraph.js Playground</h1>
            <p style={styles.subtitle}>
              StateGraph &bull; ReAct Agent &bull; Vertex AI Gemini &bull; Tool Calling &bull; Checkpoint Memory
            </p>
          </div>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.threadBadge}>
            <span style={styles.threadDot} />
            Thread: <code>{threadId}</code>
          </div>
          <button onClick={handleNewSession} style={styles.newSessionBtn}>
            + New Thread
          </button>
        </div>
      </header>

      {/* Main Chat Workspace */}
      <div style={styles.chatWrapper}>
        <div style={styles.messagesContainer}>
          {messages.map((m) => {
            const isUser = m.role === "user";
            return (
              <div
                key={m.id}
                style={{
                  ...styles.messageRow,
                  justifyContent: isUser ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    ...styles.messageBubble,
                    backgroundColor: isUser ? "#1e3a8a" : "#111726",
                    borderColor: isUser ? "#3b82f6" : "#233152",
                  }}
                >
                  <div style={styles.roleTag}>
                    {isUser ? "You" : "LangGraph Agent"}
                  </div>

                  {/* Observability: Steps Accordion */}
                  {m.steps && m.steps.length > 0 && (
                    <div style={styles.stepsBox}>
                      <button
                        onClick={() => toggleSteps(m.id)}
                        style={styles.stepsToggleBtn}
                      >
                        <span>
                          ⚙️ Executed {m.steps.length} Tool/Graph Step
                          {m.steps.length > 1 ? "s" : ""}
                        </span>
                        <span style={styles.chevron}>
                          {expandedSteps[m.id] ? "▲" : "▼"}
                        </span>
                      </button>

                      {expandedSteps[m.id] && (
                        <div style={styles.stepsDetails}>
                          {m.steps.map((step, idx) => (
                            <div key={idx} style={styles.stepItem}>
                              {step.type === "tool_call" && (
                                <div>
                                  <span style={styles.stepTypeTag}>Call</span>
                                  {step.tools.map((t, tIdx) => (
                                    <div key={tIdx} style={styles.stepCode}>
                                      <code>
                                        {t.name}(
                                        {JSON.stringify(t.args, null, 1)})
                                      </code>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {step.type === "tool_result" && (
                                <div>
                                  <span
                                    style={{
                                      ...styles.stepTypeTag,
                                      backgroundColor: "rgba(16, 185, 129, 0.2)",
                                      color: "#34d399",
                                      borderColor: "rgba(16, 185, 129, 0.4)",
                                    }}
                                  >
                                    Result: {step.toolName}
                                  </span>
                                  <div style={styles.stepResultCode}>
                                    <code>{step.output}</code>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={styles.messageContent}>{m.content}</div>
                </div>
              </div>
            );
          })}

          {loading && (
            <div style={{ ...styles.messageRow, justifyContent: "flex-start" }}>
              <div
                style={{
                  ...styles.messageBubble,
                  backgroundColor: "#111726",
                  borderColor: "#3b82f6",
                }}
              >
                <div style={styles.roleTag}>LangGraph Agent</div>
                <div style={styles.loadingPulse}>
                  <span style={styles.spinnerDot} /> Graph executing nodes & tools...
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Prompts */}
        <div style={styles.quickPromptsBar}>
          <span style={styles.quickLabel}>Try:</span>
          {quickPrompts.map((p, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(p)}
              disabled={loading}
              style={styles.quickChip}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          style={styles.inputForm}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask agent anything or test tools (e.g., weather, calculations, memory)..."
            style={styles.inputField}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{
              ...styles.sendBtn,
              opacity: loading || !input.trim() ? 0.5 : 1,
            }}
          >
            {loading ? "Running..." : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: "1050px",
    margin: "0 auto",
    padding: "24px 16px",
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    width: "100%",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: "18px",
    borderBottom: "1px solid var(--border)",
    marginBottom: "16px",
    flexWrap: "wrap",
    gap: "12px",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
  },
  logoBadge: {
    width: "42px",
    height: "42px",
    background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
    borderRadius: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
    color: "#fff",
    fontSize: "18px",
    boxShadow: "0 0 15px rgba(59, 130, 246, 0.4)",
  },
  title: {
    fontSize: "20px",
    fontWeight: "700",
    color: "#fff",
  },
  subtitle: {
    fontSize: "12px",
    color: "var(--text-secondary)",
    marginTop: "2px",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  threadBadge: {
    fontSize: "12px",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    padding: "6px 12px",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: "var(--text-secondary)",
  },
  threadDot: {
    width: "8px",
    height: "8px",
    backgroundColor: "#10b981",
    borderRadius: "50%",
    boxShadow: "0 0 8px #10b981",
  },
  newSessionBtn: {
    backgroundColor: "transparent",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
    padding: "6px 14px",
    borderRadius: "8px",
    fontSize: "12px",
    cursor: "pointer",
    fontWeight: "500",
    transition: "all 0.2s ease",
  },
  chatWrapper: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflow: "hidden",
    backgroundColor: "var(--bg-secondary)",
    borderRadius: "16px",
    border: "1px solid var(--border)",
  },
  messagesContainer: {
    flex: 1,
    overflowY: "auto",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  messageRow: {
    display: "flex",
    width: "100%",
  },
  messageBubble: {
    maxWidth: "80%",
    borderRadius: "12px",
    padding: "14px 18px",
    border: "1px solid",
    lineHeight: "1.55",
    fontSize: "14px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
  },
  roleTag: {
    fontSize: "11px",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: "var(--text-muted)",
    marginBottom: "8px",
  },
  messageContent: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  stepsBox: {
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    marginBottom: "10px",
    overflow: "hidden",
  },
  stepsToggleBtn: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "transparent",
    border: "none",
    color: "#60a5fa",
    padding: "8px 12px",
    fontSize: "12px",
    fontWeight: "600",
    cursor: "pointer",
  },
  chevron: {
    fontSize: "10px",
    marginLeft: "6px",
  },
  stepsDetails: {
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    fontSize: "12px",
  },
  stepItem: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  stepTypeTag: {
    display: "inline-block",
    fontSize: "10px",
    fontWeight: "700",
    textTransform: "uppercase",
    backgroundColor: "rgba(59, 130, 246, 0.2)",
    color: "#93c5fd",
    border: "1px solid rgba(59, 130, 246, 0.4)",
    padding: "2px 6px",
    borderRadius: "4px",
    marginBottom: "4px",
  },
  stepCode: {
    backgroundColor: "#0d1117",
    padding: "6px 8px",
    borderRadius: "6px",
    color: "#f3f4f6",
    fontSize: "11px",
    border: "1px solid #30363d",
    overflowX: "auto",
  },
  stepResultCode: {
    backgroundColor: "#0d1117",
    padding: "6px 8px",
    borderRadius: "6px",
    color: "#a7f3d0",
    fontSize: "11px",
    border: "1px solid #164e63",
    overflowX: "auto",
  },
  loadingPulse: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: "#93c5fd",
    fontSize: "13px",
  },
  spinnerDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: "#3b82f6",
    animation: "pulse 1s infinite alternate",
  },
  quickPromptsBar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 16px",
    overflowX: "auto",
    borderTop: "1px solid var(--border)",
    backgroundColor: "rgba(0, 0, 0, 0.15)",
  },
  quickLabel: {
    fontSize: "11px",
    color: "var(--text-muted)",
    fontWeight: "600",
  },
  quickChip: {
    backgroundColor: "var(--bg-tertiary)",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
    fontSize: "12px",
    padding: "5px 12px",
    borderRadius: "999px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "all 0.15s ease",
  },
  inputForm: {
    display: "flex",
    padding: "14px 16px",
    gap: "10px",
    borderTop: "1px solid var(--border)",
    backgroundColor: "var(--bg-secondary)",
  },
  inputField: {
    flex: 1,
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
    padding: "12px 16px",
    color: "#fff",
    fontSize: "14px",
    outline: "none",
  },
  sendBtn: {
    backgroundColor: "#2563eb",
    border: "none",
    color: "#fff",
    padding: "12px 22px",
    borderRadius: "10px",
    fontWeight: "600",
    fontSize: "14px",
    cursor: "pointer",
    transition: "background-color 0.2s ease",
  },
};
