import "dotenv/config";
import OpenAI from "openai";
import { HARNESS_PROMPT } from "./config.js";


export interface ITool {
  name: string;
  description: string;
  docs?: string;
  executer: (input: string) => Promise<string>;
}
export interface IMessage {
  role: "developer" | "user" | "assistant";
  content: string;
}

const APIKEY = process.env.OPENAI_API_KEY;
if (!APIKEY) {
  throw new Error("OPENAI_API_KEY is not set in the environment variables.");
}

export class AgentBuilder {
  public instructions: string | undefined;
  public toollist: ITool[];
  constructor() {
    this.toollist = [];
  }
  setInstructions(instructions: string) {
    this.instructions = instructions;
    return this;
  }

  public settools(tool: ITool) {
    this.toollist.push(tool);
    return this;
  }

  public printSystemPrompt() {
    console.log(`${this.instructions} \n\n`);
  }

  public build() {
    return new Agent(this);
  }
}

export class Agent {
  private instructions: string;
  private MessageHistory: IMessage[];
  private tools: Map<string, ITool>;
  private MAX_LOOPS = 30;
  private openai: OpenAI;

  constructor(builder: AgentBuilder) {
    this.tools = new Map();
    this.instructions = `
    ${HARNESS_PROMPT} \n\n
    \n
    SYSTEM_PROMPT :

    ${builder["instructions"] ?? ""}
    
    Available tools :
    ${builder.toollist.map((t) =>
      JSON.stringify({
        functionName: t.name,
        functionDescription: t.description,
        functionDocs: t.docs,
      }),
    )}
    `;
    this.MessageHistory = [];

    this.openai = new OpenAI({
      apiKey: APIKEY,
      baseURL: "https://openrouter.ai/api/v1", // openrouter base url
    });
    return this;
  }

  static builder() {
    return new AgentBuilder();
  }

  public async run(Query: string) {
    // Append Query to message history
    this.MessageHistory.push({ role: "user", content: Query });
    for (let i = 0; i < this.MAX_LOOPS; i++) {
      // call and LLM (system prompt + message history)
      const LLMresponse = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: this.instructions },
          ...this.MessageHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        ],
      });
      // append LLMresponse to message history
      const Rawllmresponse = LLMresponse.choices[0]?.message.content;

      this.MessageHistory.push({
        role: "assistant",
        content: Rawllmresponse ?? "",
      });

      const parsedResponse = JSON.parse(Rawllmresponse ?? "{}");
      // if llmresponse.step = "OUTPUT" break stop condition
      if (parsedResponse.step.toLowerCase() === "output") {
        return this.MessageHistory;
      }
      // is LLMresponse.step = "TOOL_REQUEST"
      if (parsedResponse.step.toLowerCase() === "tool_request") {
        const { functionName, input } = parsedResponse;
        const tool = this.tools.get(functionName);
        // tool = ToolMap . find ( LLM response . toolname )
        if (!tool) {
          this.MessageHistory.push({
            role: "developer",
            content: `Tool ${functionName} not found.`,
          });
          continue;
        }

        const toolresult = await tool.executer(input);
        // append the tool result to the messageHistory
        this.MessageHistory.push({
          role: "developer",
          content: JSON.stringify({ functionName, input, toolresult }),
        });
      }

      // continue
    }
  }
}

// primpt compilation: instructions + user query + message history + system prompt
// system prompt: instructions +
