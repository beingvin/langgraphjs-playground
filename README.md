# 🚀 LangGraph.js & MCP Playground

A full-stack, enterprise-grade exploration and testing environment for **LangGraph.js**, **Google Cloud Vertex AI (Gemini 2.5 Flash)**, **Model Context Protocol (MCP)**, and **Next.js App Router**.

This project provides both isolated CLI test suites for individual agentic primitives and a real-time streaming web playground with Human-in-the-Loop approval gates.

---

## 🌟 Key Architecture & Capabilities

```
                     ┌────────────────────────────────────────┐
                     │     Next.js Web Playground (React 19)  │
                     │  (SSE Streaming, Tool UI, HITL Modal)  │
                     └───────────────────┬────────────────────┘
                                         │ POST /api/agent (SSE)
                                         ▼
                     ┌────────────────────────────────────────┐
                     │          LangGraph.js Engine           │
                     │  StateGraph • MemorySaver Checkpointer │
                     └───────┬────────────────────────┬───────┘
                             │                        │
               ┌─────────────┴────────┐     ┌─────────┴─────────────┐
               ▼                      ▼     ▼                       ▼
      Native Toolbelt        HITL Security  Official MCP Server    Custom MCP Server
     • get_weather           • interrupt()  (@modelcontextprotocol/ (finance-mcp-server)
     • calculator            • Command()       server-filesystem)   • get_crypto_price
     • lookup_time             (resume)                             • convert_currency
     • check_balance                                                • compound_interest
```

1. **StateGraph & Custom Channels**: Typed state management via `MessagesAnnotation` and `Annotation.Root`.
2. **Cyclical ReAct Loops**: Autonomous decision-making using `toolsCondition` and `ToolNode`.
3. **Session Checkpointing & Memory**: Multi-turn conversational persistence isolated by `thread_id` using `MemorySaver`.
4. **Real-time Event & Token Streaming**: Fine-grained SSE streaming via `streamEvents(..., { version: "v2" })` capturing node lifecycles, tool inputs/outputs, and word-by-word token delivery.
5. **Human-in-the-Loop (HITL) Guardrails**: Programmatic breakpoint halts via `interrupt()` that freeze execution state into checkpoints and resume on user approval via `new Command({ resume })`.
6. **Model Context Protocol (MCP)**:
   - **Client**: Dynamic tool discovery from official MCP servers (e.g. `@modelcontextprotocol/server-filesystem`).
   - **Server**: Standalone custom MCP server (`servers/finance-mcp-server.mjs`) communicating over `StdioServerTransport`.

---

## 📁 Repository Structure

```
langgraphjs-playground/
├── app/
│   ├── api/agent/route.js     # Next.js SSE route handler supporting streaming & HITL resume
│   ├── globals.css            # Dark-theme aesthetic design system
│   ├── layout.js              # Root Next.js layout
│   └── page.js                # Interactive chat UI with live tool inspector & approval cards
├── lib/
│   └── agent.js               # Compiled LangGraph workflow with native & MCP tools
├── scripts/                   # Standalone test suites for each LangGraph primitive
│   ├── test-basic.mjs         # Test 1: Pure StateGraph mechanics (no LLM)
│   ├── test-llm.mjs           # Test 2: Vertex AI Gemini node integration
│   ├── test-tools.mjs         # Test 3: Cyclical ReAct tool-calling loop
│   ├── test-memory.mjs        # Test 4: Checkpointer memory across multi-turn sessions
│   ├── test-stream.mjs        # Test 5: Real-time token & graph event streaming
│   ├── test-human-in-the-loop.mjs # Test 6: HITL interrupt() & Command() resume
│   ├── test-mcp.mjs           # Test 7: Official Filesystem MCP server client
│   └── test-custom-mcp.mjs    # Test 8: Custom finance MCP server client
├── servers/
│   └── finance-mcp-server.mjs # Standalone Custom MCP Server (Crypto, Forex, Interest)
├── .env.local                 # Local GCP & API configuration (git-ignored)
└── package.json               # NPM scripts and dependencies
```

---

## 🛠️ CLI Test Suites

You can test every LangGraph and MCP concept independently in terminal:

| Command | Script | Concept Verified |
| :--- | :--- | :--- |
| `npm run test:basic` | `scripts/test-basic.mjs` | Nodes, edges, reducers, and state passing |
| `npm run test:llm` | `scripts/test-llm.mjs` | Google Cloud Vertex AI (Gemini 2.5 Flash) integration |
| `npm run test:tools` | `scripts/test-tools.mjs` | ReAct cyclic tool-calling loop with `zod` validation |
| `npm run test:memory` | `scripts/test-memory.mjs` | `MemorySaver` thread isolation (`thread_id`) and state recall |
| `npm run test:stream` | `scripts/test-stream.mjs` | `streamEvents` v2 token and node lifecycle streaming |
| `npm run test:hitl` | `scripts/test-human-in-the-loop.mjs` | `interrupt()` security gates & `Command({ resume })` |
| `npm run test:mcp` | `scripts/test-mcp.mjs` | Official Filesystem MCP Server tool discovery & execution |
| `npm run test:mcp:custom`| `scripts/test-custom-mcp.mjs`| Custom Finance MCP Server (JSON-RPC over Stdio) |

---

## 💻 Interactive Web Playground

The web application runs on Next.js App Router with real-time UI updates:

1. **Start the development server**:
   ```bash
   npm run dev
   ```
2. **Open in browser**: [http://localhost:3000](http://localhost:3000)

### Web Features:
- **Real-time SSE Streaming**: Tokens appear word-by-word with zero blocking.
- **Node & Tool Observability**: Expandable badge displaying active node execution, input parameters, and outputs.
- **Live Human-in-the-Loop Card**:
  - Asking to transfer funds triggers an `interrupt()` gate.
  - The UI presents an approval card: **[✓ Approve Transfer]** or **[✕ Reject Transfer]**.
  - Clicking either button resumes the graph stream seamlessly.
- **Session Reset**: `+ New Thread` button initializes a clean thread ID with isolated state.

---

## ⚙️ Environment Configuration (`.env.local`)

Ensure your `.env.local` contains valid credentials:

```env
# Google Cloud Vertex AI (Recommended)
GOOGLE_APPLICATION_CREDENTIALS=e:/AI/Projects/langgraphjs-playground/gcp-key.json
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_REGION=us-central1

# Or Google AI Studio (API Key)
GEMINI_API_KEY=your_gemini_api_key_here
```

*(Note: Sensitive keys are strictly ignored by `.gitignore`)*

---

## 📋 Next Milestones
- [x] Pure StateGraph mechanics
- [x] Vertex AI Gemini LLM Node
- [x] ReAct Tool Loop
- [x] Thread Checkpointing & Memory
- [x] Token & Event Streaming (SSE)
- [x] Human-in-the-Loop (`interrupt` / `Command`)
- [x] Model Context Protocol (MCP Client & Custom Server)
- [x] Next.js Web UI Playground
- [ ] Multi-Agent Collaboration (Supervisor / Router Pattern)
- [ ] State Time-Travel & Rewind (`getStateHistory` / `updateState`)
