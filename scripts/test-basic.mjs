import { StateGraph, Annotation, START, END } from "@langchain/langgraph";

// 1. Define State structure using Annotation
const StateAnnotation = Annotation.Root({
  userPrompt: Annotation(),
  processedBy: Annotation({
    reducer: (curr, update) => curr.concat(update),
    default: () => [],
  }),
  result: Annotation(),
});

// 2. Define Node A: Preprocessing / Transformation
function stepA(state) {
  console.log("-> Executing Step A");
  return {
    processedBy: ["Step A"],
    result: `[Step A formatted: "${state.userPrompt}"]`,
  };
}

// 3. Define Node B: Finalize output
function stepB(state) {
  console.log("-> Executing Step B");
  return {
    processedBy: ["Step B"],
    result: `${state.result} -> [Step B finalized]`,
  };
}

// 4. Build the Graph
const workflow = new StateGraph(StateAnnotation)
  .addNode("stepA", stepA)
  .addNode("stepB", stepB)
  .addEdge(START, "stepA")
  .addEdge("stepA", "stepB")
  .addEdge("stepB", END);

// 5. Compile the Graph into a Runnable
const app = workflow.compile();

// 6. Execute with an initial state
async function run() {
  console.log("=== Testing LangGraph.js Basic StateGraph ===");
  const initialInput = {
    userPrompt: "Hello LangGraph!",
  };

  const output = await app.invoke(initialInput);

  console.log("\n=== Execution Complete ===");
  console.log("Final State Output:", JSON.stringify(output, null, 2));
}

run().catch(console.error);
