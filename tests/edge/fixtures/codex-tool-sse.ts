export function codexSseBody(events: Record<string, unknown>[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

export function textOnlyStream(): Record<string, unknown>[] {
  return [
    { type: "response.created", response: { id: "resp_text", model: "gpt-5.5" } },
    { type: "response.output_text.delta", delta: "Hello" },
    { type: "response.output_text.delta", delta: ", world!" },
    { type: "response.completed", response: { id: "resp_text", status: "completed" } },
  ];
}

export function functionCallStream(): Record<string, unknown>[] {
  return [
    { type: "response.created", response: { id: "resp_fc", model: "gpt-5.5" } },
    {
      type: "response.output_item.added",
      item: {
        type: "function_call",
        id: "fc_item_1",
        call_id: "call_weather",
        name: "get_weather",
      },
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: "fc_item_1",
      delta: '{"city":',
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: "fc_item_1",
      delta: '"London"}',
    },
    { type: "response.completed", response: { id: "resp_fc", status: "completed" } },
  ];
}

export function reasoningStream(): Record<string, unknown>[] {
  return [
    { type: "response.created", response: { id: "resp_reasoning", model: "gpt-5.5" } },
    {
      type: "response.output_item.added",
      item: {
        type: "reasoning",
        id: "rs_1",
        summary: [],
        encrypted_content: "encrypted-reasoning-blob",
      },
    },
    { type: "response.reasoning.delta", delta: "thinking " },
    { type: "response.reasoning_summary_text.delta", delta: "summary" },
    { type: "response.output_text.delta", delta: "Done" },
    { type: "response.completed", response: { id: "resp_reasoning", status: "completed" } },
  ];
}

export function reasoningTextAndToolStream(): Record<string, unknown>[] {
  return [
    { type: "response.created", response: { id: "resp_reason_tool", model: "gpt-5.5" } },
    {
      type: "response.output_item.added",
      item: {
        type: "reasoning",
        id: "rs_tool",
        summary: [],
        encrypted_content: "encrypted-tool-reasoning",
      },
    },
    { type: "response.output_text.delta", delta: "I'll check." },
    ...functionCallStream().slice(1),
  ];
}

export function customToolCallStream(): Record<string, unknown>[] {
  return [
    { type: "response.created", response: { id: "resp_ct", model: "gpt-5.5" } },
    {
      type: "response.output_item.added",
      item: {
        type: "custom_tool_call",
        id: "ct_item_1",
        call_id: "call_patch",
        name: "ApplyPatch",
      },
    },
    {
      type: "response.custom_tool_call_input.delta",
      item_id: "ct_item_1",
      delta: "*** Begin Patch\n",
    },
    {
      type: "response.custom_tool_call_input.delta",
      item_id: "ct_item_1",
      delta: "*** End Patch",
    },
    { type: "response.completed", response: { id: "resp_ct", status: "completed" } },
  ];
}

export function functionCallDoneFallbackStream(): Record<string, unknown>[] {
  return [
    { type: "response.created", response: { id: "resp_done", model: "gpt-5.5" } },
    {
      type: "response.output_item.added",
      item: {
        type: "function_call",
        id: "fc_item_2",
        call_id: "call_search",
        name: "search",
      },
    },
    {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        id: "fc_item_2",
        call_id: "call_search",
        name: "search",
        arguments: '{"q":"test"}',
      },
    },
    { type: "response.completed", response: { id: "resp_done", status: "completed" } },
  ];
}

export function responsesPassthroughToolStream(): Record<string, unknown>[] {
  return [
    { type: "response.created", response: { id: "resp_pt", model: "gpt-5.5" } },
    {
      type: "response.output_item.added",
      item: {
        type: "function_call",
        id: "fc_pt_1",
        call_id: "call_pt",
        name: "read_file",
      },
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: "fc_pt_1",
      delta: '{"path":"a.ts"}',
    },
    { type: "response.completed", response: { id: "resp_pt", status: "completed" } },
  ];
}
