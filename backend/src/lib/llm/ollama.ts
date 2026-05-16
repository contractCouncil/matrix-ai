import type {
    StreamChatParams,
    StreamChatResult,
    NormalizedToolCall,
    OpenAIToolSchema,
    LlmMessage,
} from "./types";
import { toGeminiTools } from "./tools";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

type OllamaMessage = { role: "user" | "assistant" | "system"; content: string };

type OllamaToolCall = {
    type: "function";
    function: { name: string; arguments: Record<string, unknown> };
};

type OllamaResponse = {
    model: string;
    created_at: string;
    message?: { role: "assistant"; content: string; tool_calls?: OllamaToolCall[] };
    done: boolean;
};

export async function streamOllama(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const {
        model,
        systemPrompt,
        messages,
        tools = [],
        maxIterations = 10,
        callbacks = {},
        runTools,
    } = params;

    let fullText = "";
    const contents: OllamaMessage[] = [];

    if (systemPrompt) {
        contents.push({ role: "system", content: systemPrompt });
    }

    contents.push(
        ...messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
        })),
    );

    for (let iter = 0; iter < maxIterations; iter++) {
        const toolCalls: NormalizedToolCall[] = [];
        const textParts: string[] = [];
        let assistantMessage = "";

        try {
            const response = await fetch(`${OLLAMA_URL}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model,
                    messages: contents,
                    stream: true,
                    tools: tools.length > 0 ? tools : undefined,
                }),
            });

            if (!response.ok) {
                throw new Error(
                    `Ollama API error: ${response.status} ${response.statusText}`,
                );
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error("No response body from Ollama");

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines[lines.length - 1];

                for (const line of lines.slice(0, -1)) {
                    if (!line.trim()) continue;
                    const chunk: OllamaResponse = JSON.parse(line);

                    if (chunk.message?.content) {
                        assistantMessage += chunk.message.content;
                        textParts.push(chunk.message.content);
                        callbacks.onContentDelta?.(chunk.message.content);
                    }

                    if (chunk.message?.tool_calls) {
                        for (const tc of chunk.message.tool_calls) {
                            const call: NormalizedToolCall = {
                                id: `${tc.function.name}-${toolCalls.length}`,
                                name: tc.function.name,
                                input: tc.function.arguments ?? {},
                            };
                            callbacks.onToolCallStart?.(call);
                            toolCalls.push(call);
                        }
                    }
                }
            }

            fullText += textParts.join("");

            if (!toolCalls.length || !runTools) {
                break;
            }

            const results = await runTools(toolCalls);
            contents.push({ role: "assistant", content: assistantMessage });
            contents.push({
                role: "user",
                content: JSON.stringify(
                    results.map((r) => ({
                        type: "tool",
                        tool_use_id: r.tool_use_id,
                        content: r.content,
                    })),
                ),
            });
        } catch (err) {
            console.error("[ollama stream] error:", err);
            throw err;
        }
    }

    return { fullText };
}

export async function completeOllamaText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
}): Promise<string> {
    const messages: OllamaMessage[] = [];

    if (params.systemPrompt) {
        messages.push({ role: "system", content: params.systemPrompt });
    }

    messages.push({ role: "user", content: params.user });

    try {
        const response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: params.model, messages, stream: false }),
        });

        if (!response.ok) {
            throw new Error(
                `Ollama API error: ${response.status} ${response.statusText}`,
            );
        }

        const data: OllamaResponse = await response.json();
        return data.message?.content ?? "";
    } catch (err) {
        console.error("[ollama complete] error:", err);
        throw err;
    }
}
