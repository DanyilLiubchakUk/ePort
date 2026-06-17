export const responsesToolHistoryBody = {
  model: "gpt-5.5",
  stream: true,
  tools: [
    {
      type: "function",
      name: "get_weather",
      description: "Get weather for a city",
      parameters: { type: "object", properties: { city: { type: "string" } } },
    },
  ],
  tool_choice: "auto",
  input: [
    { role: "user", content: "weather in London?" },
    {
      type: "function_call",
      call_id: "call_weather",
      name: "get_weather",
      arguments: '{"city":"London"}',
    },
    {
      type: "function_call_output",
      call_id: "call_weather",
      output: '{"temp_c":18}',
    },
    {
      type: "reasoning",
      id: "rs_1",
      summary: [],
      encrypted_content: "encrypted-reasoning-blob",
    },
  ],
} as const;

export const chatToolFollowUpBody = {
  model: "gpt-5.5",
  stream: true,
  tools: [
    {
      type: "function",
      name: "get_weather",
      description: "Get weather for a city",
      parameters: { type: "object", properties: { city: { type: "string" } } },
    },
  ],
  tool_choice: "auto",
  messages: [
    { role: "user", content: "weather in London?" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_weather",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"London"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_weather", content: '{"temp_c":18}' },
  ],
} as const;

export const expectedSanitizedToolInput = [
  { role: "user", content: "weather in London?" },
  {
    type: "function_call",
    call_id: "call_weather",
    name: "get_weather",
    arguments: '{"city":"London"}',
  },
  {
    type: "function_call_output",
    call_id: "call_weather",
    output: '{"temp_c":18}',
  },
] as const;
