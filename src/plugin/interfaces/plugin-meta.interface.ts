export interface PluginMeta {
  pluginId: string;
  name: string;
  version: string;
  gameType: string;
  category: 'board' | 'card' | 'mahjong';
  minPlayers: number;
  maxPlayers: number;
  entryClass: string;
  supportedModes: string[];
  memoryLimitMB?: number;
  allowedDomains?: string[];
  neuralNetwork?: {
    enabled: boolean;
    modelPath?: string;
    modelHash?: string;
  };
  errorDefinitions?: Record<string, { en: string; zh: string }>;
}
