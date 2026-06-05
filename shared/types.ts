/**
 * AI Companion - 共享类型定义
 *
 * ⚠️ 本文件零依赖，不含任何框架引用。
 * 可被 NestJS 后端、React 前端、小程序适配器等任何平台引用或复制。
 *
 * Date 字段统一为 ISO 8601 string（JSON 序列化格式），
 * 确保跨平台兼容（小程序/移动端不自动转换 Date）。
 */

// ═══════════════════════════════════════
//  LLM 对话消息
// ═══════════════════════════════════════

export type MessageRole = 'user' | 'assistant';

export type SystemMessageRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: SystemMessageRole;
  content: string;
}

export interface LlmOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ═══════════════════════════════════════
//  角色
// ═══════════════════════════════════════

export interface CharacterData {
  id: string;
  name: string;
  basePrompt: string;
  model: string;
  speechPatterns: Record<string, unknown>;
  createdAt: string;
}

export interface CreateCharacterPayload {
  id: string;
  name: string;
  base_prompt: string;
  model?: string;
}

export interface UpdateCharacterPayload {
  name?: string;
  base_prompt?: string;
  model?: string;
}

// ═══════════════════════════════════════
//  会话
// ═══════════════════════════════════════

export interface SessionData {
  id: string;
  characterId: string;
  title: string | null;
  summary: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionPayload {
  characterId: string;
  title?: string;
}

// ═══════════════════════════════════════
//  消息
// ═══════════════════════════════════════

export interface MessageData {
  id: number;
  sessionId: string;
  role: MessageRole;
  content: string;
  emotionSnapshot: Record<string, number> | null;
  createdAt: string;
}

// ═══════════════════════════════════════
//  聊天
// ═══════════════════════════════════════

export interface SendMessagePayload {
  content: string;
}

export interface SendMessageResponse {
  reply: string;
}

// ═══════════════════════════════════════
//  SSE 流式回调
// ═══════════════════════════════════════

export interface SSECallbacks {
  onChunk?: (chunk: string) => void;
  onDone?: (fullReply: string) => void;
  onError?: (err: Error) => void;
}

// ═══════════════════════════════════════
//  错误
// ═══════════════════════════════════════

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// ═══════════════════════════════════════
//  聊天记录导入
// ═══════════════════════════════════════

export interface ImportChatRecordsPayload {
  sessionId: string;
  text: string;
  userAliases?: string[];
  assistantAliases?: string[];
  unknownSpeakerRole?: MessageRole;
  triggerMemoryExtraction?: boolean;
  generateSummary?: boolean;
  extractProfile?: boolean;
  mode?: 'replace' | 'merge';
}

export interface ImportPreviewRecord {
  speaker: string;
  role: MessageRole;
  content: string;
}

export interface ImportChatRecordsResult {
  sessionId: string;
  parsed: number;
  inserted: number;
  memoryExtractionQueued: boolean;
  summaryQueued: boolean;
  profileExtractionQueued: boolean;
  preview: ImportPreviewRecord[];
}

// ═══════════════════════════════════════
//  聊天 UI 状态（前端专用）
// ═══════════════════════════════════════

export type StatusType = 'online' | 'streaming' | 'error';

export interface ChatMessageItem {
  role: MessageRole;
  content: string;
  isStreaming?: boolean;
}
