import { StateGraph, MessagesAnnotation, Annotation, START, END, MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { tool } from "@langchain/core/tools";
import { SystemMessage, AIMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

// 1. Specialized Tools
const getWeatherTool = tool(
  async ({ city }) => {
    const mock = { tokyo: "21°C, Sunny", london: "15°C, Rainy", paris: "19°C, Pleasant" };
    return mock[city.toLowerCase()] || `24°C in ${city}`;
  },
  {
    name: "get_weather",
    description: "Get weather for a city.",
    schema: z.object({ city: z.string() }),
  }
);

const lookupTimeTool = tool(
  async ({ timezone }) =>
    `Current time in ${timezone}: ${new Date().toLocaleTimeString("en-US", { timeZone: timezone || "UTC" })}`,
  {
    name: "lookup_time",
    description: "Get current time in a time zone.",
    schema: z.object({ timezone: z.string() }),
  }
);

const getCryptoPriceTool = tool(
  async ({ symbol }) => {
    const prices = { BTC: "$68,200 USD", ETH: "$3,520 USD", SOL: "$185 USD" };
    return prices[symbol.toUpperCase()] || "$10.00 USD";
  },
  {
    name: "get_crypto_price",
    description: "Get current price of a cryptocurrency.",
    schema: z.object({ symbol: z.string() }),
  }
);

const convertCurrencyTool = tool(
  async ({ amount, from, to }) => {
    const rates = { "USD-INR": 83.5, "USD-EUR": 0.92, "EUR-USD": 1.09 };
    const rate = rates[`${from.toUpperCase()}-${to.toUpperCase()}`] || 1.0;
    return `${amount} ${from} = ${(amount * rate).toFixed(2)} ${to}`;
  },
  {
    name: "convert_currency",
    description: "Convert fiat currencies.",
    schema: z.object({ amount: z.number(), from: z.string(), to: z.string() }),
  }
);

// 2. Initialize Model
function getModel() {
  if (process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new ChatVertexAI({
      model: "gemini-2.5-flash",
      temperature: 0.1,
      location: process.env.GOOGLE_CLOUD_REGION || "us-central1",
    });
  } else if (process.env.GEMINI_API_KEY) {
    return new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      apiKey: process.env.GEMINI_API_KEY,
      temperature: 0.1,
    });
  }
  throw new Error("No Gemini credentials found.");
}

const baseModel = getModel();
const researchTools = [getWeatherTool, lookupTimeTool];
const financeTools = [getCryptoPriceTool, convertCurrencyTool];

const researchModel = baseModel.bindTools(researchTools);
const financeModel = baseModel.bindTools(financeTools);

// Helper: Ensure SystemMessage is ONLY placed at index 0 (Gemini requirement)
function cleanMessagesWithSystem(systemPromptText, messages) {
  const filtered = messages.filter((m) => m.getType() !== "system");
  return [new SystemMessage(systemPromptText), ...filtered];
}

// 3. Worker Nodes
async function researchWorkerNode(state) {
  const prompt = cleanMessagesWithSystem(
    "You are the Research Specialist. Answer ONLY weather and timezone questions using your tools. " +
    "Be concise and do not answer crypto or currency questions.",
    state.messages
  );

  const response = await researchModel.invoke(prompt);
  let finalContent = response.content;

  if (response.tool_calls?.length > 0) {
    const toolNode = new ToolNode(researchTools);
    const toolResult = await toolNode.invoke({ messages: [response] });
    const postSynthesis = await baseModel.invoke(
      cleanMessagesWithSystem(
        "You are the Research Specialist. State your tool findings concisely.",
        [...state.messages, response, ...toolResult.messages]
      )
    );
    finalContent = postSynthesis.content;
  }

  return {
    messages: [
      new AIMessage({
        content: finalContent || "Completed research check.",
        name: "ResearchAgent",
      }),
    ],
  };
}

async function financeWorkerNode(state) {
  const prompt = cleanMessagesWithSystem(
    "You are the Financial Specialist. Answer ONLY cryptocurrency prices and currency conversions using your tools. " +
    "Be concise and do not answer weather or general questions.",
    state.messages
  );

  const response = await financeModel.invoke(prompt);
  let finalContent = response.content;

  if (response.tool_calls?.length > 0) {
    const toolNode = new ToolNode(financeTools);
    const toolResult = await toolNode.invoke({ messages: [response] });
    const postSynthesis = await baseModel.invoke(
      cleanMessagesWithSystem(
        "You are the Financial Specialist. State your financial tool findings concisely.",
        [...state.messages, response, ...toolResult.messages]
      )
    );
    finalContent = postSynthesis.content;
  }

  return {
    messages: [
      new AIMessage({
        content: finalContent || "Completed financial check.",
        name: "FinanceAgent",
      }),
    ],
  };
}

// 4. Supervisor Router Node
const routeSchema = z.object({
  nextWorker: z
    .enum(["ResearchAgent", "FinanceAgent", "FINISH"])
    .describe("Next worker to call or 'FINISH' if user request is satisfied."),
  reasoning: z.string().describe("Justification"),
});

const supervisorModel = baseModel.withStructuredOutput(routeSchema);

async function supervisorNode(state) {
  const responders = new Set(
    state.messages.filter((m) => m.name).map((m) => m.name)
  );

  const prompt = cleanMessagesWithSystem(
    "You are the Team Supervisor managing 'ResearchAgent' (weather, time) and 'FinanceAgent' (crypto, currency).\n" +
    `Already answered by: [${Array.from(responders).join(", ")}].\n` +
    "Rules:\n" +
    "1. Do NOT call an agent that has already answered.\n" +
    "2. If all required questions are answered, select 'FINISH'.",
    state.messages
  );

  const decision = await supervisorModel.invoke(prompt);
  let selected = decision.nextWorker;
  if (responders.has(selected)) {
    selected = "FINISH";
  }

  return { nextWorker: selected };
}

// 5. Synthesizer Node (Produces final user answer)
async function synthesizerNode(state) {
  const findings = state.messages
    .filter((m) => m.name)
    .map((m) => `${m.name}: ${m.content}`)
    .join("\n\n");

  const origQuestion = state.messages.find((m) => m.getType() === "human")?.content || "";

  const prompt = [
    new SystemMessage(
      "You are the Lead Assistant. Combine the specialist findings into a polite, complete, and formatted final answer for the user."
    ),
    new HumanMessage(
      `User Question: "${origQuestion}"\n\nSpecialist Findings:\n${findings}\n\nPlease write a cohesive final response addressing all parts of the user question.`
    ),
  ];

  const response = await baseModel.invoke(prompt);
  return {
    messages: [
      new AIMessage({
        content: response.content,
      }),
    ],
  };
}

// 6. Build Multi-Agent StateGraph
const MultiAgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  nextWorker: Annotation({
    reducer: (curr, update) => update ?? curr,
    default: () => "supervisor",
  }),
});

const workflow = new StateGraph(MultiAgentState)
  .addNode("supervisor", supervisorNode)
  .addNode("ResearchAgent", researchWorkerNode)
  .addNode("FinanceAgent", financeWorkerNode)
  .addNode("synthesizer", synthesizerNode)
  .addEdge(START, "supervisor")
  .addConditionalEdges("supervisor", (state) => {
    if (state.nextWorker === "ResearchAgent") return "ResearchAgent";
    if (state.nextWorker === "FinanceAgent") return "FinanceAgent";
    return "synthesizer";
  })
  .addEdge("ResearchAgent", "supervisor")
  .addEdge("FinanceAgent", "supervisor")
  .addEdge("synthesizer", END);

const globalForMulti = globalThis;
if (!globalForMulti.multiAgentCheckpointer) {
  globalForMulti.multiAgentCheckpointer = new MemorySaver();
}

export const multiAgentApp = workflow.compile({
  checkpointer: globalForMulti.multiAgentCheckpointer,
});
