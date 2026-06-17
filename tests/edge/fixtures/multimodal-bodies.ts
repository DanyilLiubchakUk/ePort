import type { AnthropicContentBlock } from "../../../src/claude/normalize.ts";

const IMAGE_URL = "https://example.com/screenshot.png";
const BASE64_IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

export const multimodalImageChatBody = {
  model: "gpt-5.5",
  stream: true,
  messages: [
    {
      role: "user",
      content: [
        { type: "input_text", text: "Describe this screenshot." },
        { type: "image_url", image_url: { url: IMAGE_URL } },
        {
          type: "input_image",
          media_type: "image/png",
          data: BASE64_IMAGE,
        },
      ],
    },
  ],
} as const;

export const expectedCodexMultimodalContent = [
  { type: "input_text", text: "Describe this screenshot." },
  { type: "input_image", image_url: IMAGE_URL },
  { type: "input_image", image_url: `data:image/png;base64,${BASE64_IMAGE}` },
];

export const expectedClaudeMultimodalContent: AnthropicContentBlock[] = [
  { type: "text", text: "Describe this screenshot." },
  { type: "image", source: { type: "url", url: IMAGE_URL } },
  {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: BASE64_IMAGE },
  },
];

