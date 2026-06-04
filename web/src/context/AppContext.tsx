/**
 * AI Companion - 全局状态管理
 *
 * Context + useReducer 管理聊天应用的全部状态。
 * 组件通过 useAppContext() hook 读取状态和调用操作。
 */

import React, { createContext, useContext, useReducer, useRef, useCallback } from 'react';
import type { CharacterData, SessionData, StatusType, ChatMessageItem, MessageRole } from '@shared/types';
import * as API from '../api/index';

// ═══════════════════════════════════════
//  State
// ═══════════════════════════════════════

export interface AppState {
  // 数据
  characters: CharacterData[];
  sessions: SessionData[];
  messages: ChatMessageItem[];

  // 选中
  currentCharacterId: string | null;
  currentSessionId: string | null;

  // 流式状态
  isStreaming: boolean;

  // 状态指示
  statusType: StatusType;
  statusMessage: string;
}

const initialState: AppState = {
  characters: [],
  sessions: [],
  messages: [],
  currentCharacterId: null,
  currentSessionId: null,
  isStreaming: false,
  statusType: 'online',
  statusMessage: '在线',
};

// ═══════════════════════════════════════
//  Actions
// ═══════════════════════════════════════

type Action =
  | { type: 'SET_CHARACTERS'; payload: CharacterData[] }
  | { type: 'SET_SESSIONS'; payload: SessionData[] }
  | { type: 'SELECT_CHARACTER'; payload: string }
  | { type: 'SELECT_SESSION'; payload: string }
  | { type: 'SET_MESSAGES'; payload: ChatMessageItem[] }
  | { type: 'ADD_MESSAGE'; payload: { role: MessageRole; content: string; isStreaming?: boolean } }
  | { type: 'APPEND_CHUNK'; payload: string }
  | { type: 'FINISH_STREAM' }
  | { type: 'STREAM_ERROR'; payload: string }
  | { type: 'SET_STATUS'; payload: { type: StatusType; message?: string } }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'REMOVE_SESSION'; payload: string };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_CHARACTERS':
      return { ...state, characters: action.payload };

    case 'SET_SESSIONS':
      return { ...state, sessions: action.payload };

    case 'SELECT_CHARACTER': {
      const id = action.payload;
      const filtered = state.sessions.filter((s) => s.characterId === id);
      const firstSession = filtered.length > 0 ? filtered[0].id : null;
      return {
        ...state,
        currentCharacterId: id,
        currentSessionId: firstSession,
        messages: [],
      };
    }

    case 'SELECT_SESSION':
      return {
        ...state,
        currentSessionId: action.payload,
        messages: [], // 清空旧的，新的通过 loadMessages 异步加载
      };

    case 'SET_MESSAGES':
      return { ...state, messages: action.payload };

    case 'ADD_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.payload],
      };

    case 'APPEND_CHUNK': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = {
          ...last,
          content: last.content + action.payload,
        };
      }
      return { ...state, messages: msgs };
    }

    case 'FINISH_STREAM': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, isStreaming: false };
      }
      return {
        ...state,
        messages: msgs,
        isStreaming: false,
        statusType: 'online',
        statusMessage: '在线',
      };
    }

    case 'STREAM_ERROR': {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = {
          ...last,
          content: `[错误] ${action.payload}`,
          isStreaming: false,
        };
      }
      return {
        ...state,
        messages: msgs,
        isStreaming: false,
        statusType: 'error',
        statusMessage: action.payload,
      };
    }

    case 'SET_STATUS':
      return {
        ...state,
        statusType: action.payload.type,
        statusMessage: action.payload.message ?? '',
      };

    case 'CLEAR_MESSAGES':
      return { ...state, messages: [] };

    case 'REMOVE_SESSION': {
      const id = action.payload;
      const sessions = state.sessions.filter((s) => s.id !== id);
      const newCurrent =
        state.currentSessionId === id ? null : state.currentSessionId;
      return {
        ...state,
        sessions,
        currentSessionId: newCurrent,
        messages: newCurrent ? state.messages : [],
      };
    }

    default:
      return state;
  }
}

// ═══════════════════════════════════════
//  Context
// ═══════════════════════════════════════

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  // 封装好的操作函数
  loadCharacters: () => Promise<void>;
  loadSessions: () => Promise<void>;
  loadMessages: (sessionId: string) => Promise<void>;
  selectCharacter: (id: string) => void;
  selectSession: (id: string) => void;
  createCharacter: (id: string, name: string, basePrompt: string) => Promise<void>;
  updateCharacter: (id: string, name: string, basePrompt: string) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  createSession: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const abortRef = useRef<AbortController | null>(null);

  // ═══════════════════════════════════════
  //  数据加载
  // ═══════════════════════════════════════

  const loadCharacters = useCallback(async () => {
    try {
      const chars = await API.getCharacters();
      dispatch({ type: 'SET_CHARACTERS', payload: chars });
    } catch (err) {
      console.error('加载角色失败:', err);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const sessions = await API.getSessions();
      dispatch({ type: 'SET_SESSIONS', payload: sessions });
    } catch (err) {
      console.error('加载会话失败:', err);
    }
  }, []);

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const messages = await API.getMessages(sessionId, 50);
      dispatch({
        type: 'SET_MESSAGES',
        payload: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
    } catch (err) {
      console.error('加载消息失败:', err);
    }
  }, []);

  // ═══════════════════════════════════════
  //  选择
  // ═══════════════════════════════════════

  const selectCharacter = useCallback(
    (id: string) => {
      dispatch({ type: 'SELECT_CHARACTER', payload: id });
    },
    [],
  );

  const selectSession = useCallback((id: string) => {
    dispatch({ type: 'SELECT_SESSION', payload: id });
    // 异步加载历史消息，不阻塞 UI
    loadMessages(id);
  }, [loadMessages]);

  // ═══════════════════════════════════════
  //  角色 CRUD
  // ═══════════════════════════════════════

  const createCharacterFn = useCallback(
    async (id: string, name: string, basePrompt: string) => {
      await API.createCharacter({ id, name, base_prompt: basePrompt });
      await loadCharacters();
    },
    [loadCharacters],
  );

  const updateCharacterFn = useCallback(
    async (id: string, name: string, basePrompt: string) => {
      await API.updateCharacter(id, { name, base_prompt: basePrompt });
      await loadCharacters();
    },
    [loadCharacters],
  );

  const deleteCharacter = useCallback(
    async (id: string) => {
      await API.deleteCharacter(id);
      await loadCharacters();
    },
    [loadCharacters],
  );

  // ═══════════════════════════════════════
  //  会话 CRUD
  // ═══════════════════════════════════════

  const createSessionFn = useCallback(async () => {
    if (!state.currentCharacterId) return;
    const session = await API.createSession({
      characterId: state.currentCharacterId,
    });
    await loadSessions();
    selectSession(session.id);
  }, [state.currentCharacterId, loadSessions, selectSession]);

  const deleteSessionFn = useCallback(
    async (id: string) => {
      await API.deleteSession(id);
      await loadSessions();
      if (state.currentSessionId === id) {
        dispatch({ type: 'REMOVE_SESSION', payload: id });
      }
    },
    [state.currentSessionId, loadSessions],
  );

  // ═══════════════════════════════════════
  //  发送消息（含 SSE 流式）
  // ═══════════════════════════════════════

  const sendMessageFn = useCallback(
    async (content: string) => {
      if (!state.currentSessionId || state.isStreaming) return;

      // 添加用户消息
      dispatch({
        type: 'ADD_MESSAGE',
        payload: { role: 'user', content },
      });

      // 添加空的 AI 消息气泡（流式填充）
      dispatch({
        type: 'ADD_MESSAGE',
        payload: { role: 'assistant', content: '', isStreaming: true },
      });

      dispatch({
        type: 'SET_STATUS',
        payload: { type: 'streaming' },
      });

      abortRef.current = API.sendMessageStream(
        state.currentSessionId,
        { content },
        {
          onChunk(chunk: string) {
            dispatch({ type: 'APPEND_CHUNK', payload: chunk });
          },
          onDone() {
            dispatch({ type: 'FINISH_STREAM' });
            abortRef.current = null;
          },
          onError(err) {
            dispatch({ type: 'STREAM_ERROR', payload: err.message });
            abortRef.current = null;
          },
        },
      );
    },
    [state.currentSessionId, state.isStreaming],
  );

  // ═══════════════════════════════════════
  //  提供 context
  // ═══════════════════════════════════════

  const value: AppContextValue = {
    state,
    dispatch,
    loadCharacters,
    loadSessions,
    loadMessages,
    selectCharacter,
    selectSession,
    createCharacter: createCharacterFn,
    updateCharacter: updateCharacterFn,
    deleteCharacter,
    createSession: createSessionFn,
    deleteSession: deleteSessionFn,
    sendMessage: sendMessageFn,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ═══════════════════════════════════════
//  Hook
// ═══════════════════════════════════════

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
