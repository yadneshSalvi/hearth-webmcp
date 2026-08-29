export interface AssistantTextMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantFunctionCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

export interface AssistantFunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export type AssistantMessage = AssistantTextMessage | AssistantFunctionCall | AssistantFunctionCallOutput;

export interface AssistantToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

