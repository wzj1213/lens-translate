import type { ChatMessage } from "./prompt";

const EMAIL = /[\w.!#$%&'*+/=?^{}|~-]+@[\w.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w])(?:\+?\d{1,3}[-. ]?)?(?:\(\d{2,4}\)|\d{2,4})[-. ]?\d{3,4}[-. ]?\d{4}(?![\w])/g;

export function protectMessages(messages: ChatMessage[], enabled: boolean) {
  const values = new Map<string, string>();
  const prefix = "__LENS_" + crypto.randomUUID().replace(/-/g, "") + "_";
  const tokenFor = (value: string) => {
    let token = values.get(value);
    if (!token) {
      token = prefix + values.size + "__";
      values.set(value, token);
    }
    return token;
  };
  const protectedMessages = enabled ? messages.map(message => ({
    ...message, content: message.content.replace(EMAIL, tokenFor).replace(PHONE, tokenFor),
  })) : messages;
  if (values.size && protectedMessages[0]?.role === "system") {
    protectedMessages[0].content += "\nCopy all __LENS_…__ placeholders exactly.";
  }
  return {
    messages: protectedMessages,
    masked: values.size > 0,
    restore(text: string): string {
      for (const [value, token] of values) text = text.split(token).join(value);
      return text;
    },
  };
}
