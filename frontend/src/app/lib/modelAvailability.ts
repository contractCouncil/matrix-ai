import { MODELS, type ModelOption } from "../components/assistant/ModelToggle";

export type ModelProvider = "claude" | "gemini";

export function getModelProvider(modelId: string): ModelProvider | null {
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) return null;
    return model.group === "Anthropic" ? "claude" : "gemini";
}

export function isModelAvailable(
    modelId: string,
    _apiKeys: { claudeApiKey: string | null; geminiApiKey: string | null },
): boolean {
    return getModelProvider(modelId) !== null;
}

export function isProviderAvailable(
    _provider: ModelProvider,
    _apiKeys: { claudeApiKey: string | null; geminiApiKey: string | null },
): boolean {
    return true;
}

export function providerLabel(provider: ModelProvider): string {
    return provider === "claude" ? "Anthropic (Claude)" : "Google (Gemini)";
}

export function modelGroupToProvider(
    group: ModelOption["group"],
): ModelProvider {
    return group === "Anthropic" ? "claude" : "gemini";
}
