"use client";

import { useState, useRef, useEffect } from "react";

export default function Home() {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hello! I am your LangGraph.js Agent with Human-in-the-Loop & real-time streaming enabled.\n\n" +
        "• Safe Tools: `get_weather`, `calculator`, `lookup_time`\n" +
        "• Guarded Tool: `transfer_funds` (triggers an approval prompt before executing).\n\n" +
        "What would you like to explore?",
      steps: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState("");
  const [threadId, setThreadId] = useState(`thread-${Date.now().toString(36)}`);
  const [expandedSteps, setExpandedSteps] = useState({});
  const [pendingApproval, setPendingApproval] = useState(null); // { action, recipient, amount, warning }
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, currentStatus, pendingApproval]);

  const readStream = async (response, agentMessageId) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.replace("data: ", "").trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);

          if (event.type === "node_start") {
            setCurrentStatus(
              event.node === "agent" ? "Agent reasoning..." : "Executing tools..."
            );
          } else if (event.type === "tool_start") {
            setCurrentStatus(`Calling tool: ${event.name}...`);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === agentMessageId
                  ? {
                      ...m,
                      steps: [
                        ...m.steps,
                        {
                          type: "tool_call",
                          name: event.name,
                          input: event.input,
                        },
                      ],
                    }
                  : m
              )
            );
            setExpandedSteps((prev) => ({ ...prev, [agentMessageId]: true }));
          } else if (event.type === "tool_end") {
            setCurrentStatus(`Tool ${event.name} returned result`);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === agentMessageId
                  ? {
                      ...m,
                      steps: [
                        ...m.steps,
                        {
                          type: "tool_result",
                          name: event.name,
                          output: event.output,
                        },
                      ],
                    }
                  : m
              )
            );
          } else if (event.type === "token") {
            setCurrentStatus("Streaming response...");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === agentMessageId
                  ? { ...m, content: m.content + event.content }
                  : m
              )
            );
          } else if (event.type === "interrupt") {
            setCurrentStatus("⚠️ Paused: Awaiting human approval...");
            setPendingApproval({
              ...event.payload,
              agentMessageId,
            });
          } else if (event.type === "error") {
            throw new Error(event.error);
          } else if (event.type === "done") {
            setCurrentStatus("");
            setPendingApproval(null);
          }
        } catch (parseErr) {
          console.error("Error parsing SSE event:", parseErr);
        }
      }
    }
  };

  const handleSend = async (customPrompt) => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim() || loading) return;

    const userMessageId = `user-${Date.now()}`;
    const userMsg = {
      id: userMessageId,
      role: "user",
      content: textToSend,
    };

    const agentMessageId = `agent-${Date.now()}`;
    const initialAgentMsg = {
      id: agentMessageId,
      role: "assistant",
      content: "",
      steps: [],
    };

    setMessages((prev) => [...prev, userMsg, initialAgentMsg]);
    if (!customPrompt) setInput("");
    setLoading(true);
    setPendingApproval(null);
    setCurrentStatus("Initializing LangGraph...");

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          threadId: threadId,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error ${response.status}`);
      }

      await readStream(response, agentMessageId);
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMessageId
            ? {
                ...m,
                content: m.content
                  ? `${m.content}\n\n⚠️ Error: ${err.message}`
                  : `⚠️ Error: ${err.message}`,
                isError: true,
              }
            : m
        )
      );
    } finally {
      setLoading(false);
      setCurrentStatus("");
    }
  };

  // Human Operator clicks [Approve] or [Reject]
  const handleDecision = async (decision) => {
    if (!pendingApproval) return;
    const targetAgentMessageId = pendingApproval.agentMessageId;
    setPendingApproval(null);
    setLoading(true);
    setCurrentStatus(`Human operator ${decision}d action. Resuming graph...`);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeAction: decision,
          threadId: threadId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to resume execution: HTTP ${response.status}`);
      }

      await readStream(response, targetAgentMessageId);
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === targetAgentMessageId
            ? { ...m, content: `${m.content}\n\n⚠️ Error resuming: ${err.message}` }
            : m
        )
      );
    } finally {
      setLoading(false);
      setCurrentStatus("");
    }
  };

  const handleNewSession = () => {
    const newId = `thread-${Date.now().toString(36)}`;
    setThreadId(newId);
    setPendingApproval(null);
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
    "Please transfer $2,500 to Alice for project milestone.",
    "What is the weather in Tokyo and calculate 84 divided by 7?",
    "What time is it in Asia/Tokyo right now?",
    "My name is Priya. Please remember my favorite city is Paris.",
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
              Human-in-the-Loop &bull; Live Streaming &bull; ReAct Agent &bull; Checkpoint Memory
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
                                  <div style={styles.stepCode}>
                                    <code>
                                      {step.name}({JSON.stringify(step.input)})
                                    </code>
                                  </div>
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
                                    Result: {step.name}
                                  </span>
                                  <div style={styles.stepResultCode}>
                                    <code>{JSON.stringify(step.output)}</code>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={styles.messageContent}>
                    {m.content}
                    {loading && m.role === "assistant" && !m.content && !pendingApproval && (
                      <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
                        Waiting for response...
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Human-in-the-Loop Approval Banner */}
          {pendingApproval && (
            <div style={styles.approvalWrapper}>
              <div style={styles.approvalCard}>
                <div style={styles.approvalHeader}>
                  <span style={styles.warningIcon}>⚠️</span>
                  <div>
                    <h3 style={styles.approvalTitle}>Human Authorization Required</h3>
                    <p style={styles.approvalDesc}>{pendingApproval.warning}</p>
                  </div>
                </div>
                <div style={styles.approvalMeta}>
                  <div><strong>Action:</strong> <code>{pendingApproval.action}</code></div>
                  <div><strong>Recipient:</strong> <span style={{ color: "#60a5fa" }}>{pendingApproval.recipient}</span></div>
                  <div><strong>Amount:</strong> <span style={{ color: "#34d399", fontWeight: "bold" }}>${pendingApproval.amount?.toLocaleString()} USD</span></div>
                </div>
                <div style={styles.approvalActions}>
                  <button
                    onClick={() => handleDecision("approve")}
                    disabled={loading}
                    style={styles.approveBtn}
                  >
                    ✓ Approve Transfer
                  </button>
                  <button
                    onClick={() => handleDecision("reject")}
                    disabled={loading}
                    style={styles.rejectBtn}
                  >
                    ✕ Reject Transfer
                  </button>
                </div>
              </div>
            </div>
          )}

          {loading && currentStatus && (
            <div style={{ ...styles.messageRow, justifyContent: "flex-start" }}>
              <div style={styles.statusBubble}>
                <span style={styles.spinnerDot} />
                <span>{currentStatus}</span>
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
            placeholder="Ask agent anything or trigger transfer to test human approval..."
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
  approvalWrapper: {
    display: "flex",
    justifyContent: "center",
    margin: "8px 0",
    width: "100%",
  },
  approvalCard: {
    backgroundColor: "#181e2e",
    border: "1px solid #f59e0b",
    boxShadow: "0 0 20px rgba(245, 158, 11, 0.2)",
    borderRadius: "12px",
    padding: "18px 22px",
    maxWidth: "520px",
    width: "100%",
    animation: "fadeIn 0.2s ease-in-out",
  },
  approvalHeader: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "12px",
  },
  warningIcon: {
    fontSize: "24px",
  },
  approvalTitle: {
    fontSize: "15px",
    fontWeight: "700",
    color: "#f59e0b",
  },
  approvalDesc: {
    fontSize: "12px",
    color: "var(--text-secondary)",
    marginTop: "2px",
  },
  approvalMeta: {
    backgroundColor: "#0f1523",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "10px 14px",
    fontSize: "13px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    marginBottom: "16px",
  },
  approvalActions: {
    display: "flex",
    gap: "12px",
  },
  approveBtn: {
    flex: 1,
    backgroundColor: "#059669",
    border: "none",
    color: "#fff",
    padding: "10px 16px",
    borderRadius: "8px",
    fontWeight: "600",
    fontSize: "13px",
    cursor: "pointer",
    transition: "background-color 0.15s ease",
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: "#dc2626",
    border: "none",
    color: "#fff",
    padding: "10px 16px",
    borderRadius: "8px",
    fontWeight: "600",
    fontSize: "13px",
    cursor: "pointer",
    transition: "background-color 0.15s ease",
  },
  statusBubble: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    backgroundColor: "rgba(30, 58, 138, 0.4)",
    border: "1px solid rgba(59, 130, 246, 0.4)",
    color: "#93c5fd",
    fontSize: "12px",
    padding: "6px 12px",
    borderRadius: "999px",
  },
  spinnerDot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    backgroundColor: "#60a5fa",
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
