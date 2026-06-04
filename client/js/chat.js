/**
 * AI Companion - Web 聊天界面逻辑
 *
 * 依赖 api.js（纯 API 层，不依赖 DOM）
 * 本文件负责所有 UI 交互（DOM 操作）
 */

import * as API from './api.js';

// ═══════════════════════════════════════
//  全局状态
// ═══════════════════════════════════════

const state = {
  currentCharacterId: null,
  currentSessionId: null,
  isStreaming: false,
  abortController: null,
};

// ═══════════════════════════════════════
//  DOM 引用
// ═══════════════════════════════════════

const $ = (sel) => document.querySelector(sel);
const dom = {
  characterList: $('#character-list'),
  sessionList: $('#session-list'),
  chatTitle: $('#chat-title'),
  messages: $('#messages'),
  input: $('#message-input'),
  sendBtn: $('#send-btn'),
  newCharForm: $('#new-char-form'),
  charName: $('#char-name'),
  charId: $('#char-id'),
  charPrompt: $('#char-prompt'),
  newSessionBtn: $('#new-session-btn'),
  statusDot: $('#status-dot'),
  statusText: $('#status-text'),
};

// ═══════════════════════════════════════
//  初始化
// ═══════════════════════════════════════

export async function init() {
  await loadCharacters();
  await loadSessions();
  bindEvents();

  // 默认选中第一个角色和会话
  const firstChar = document.querySelector('.character-item');
  if (firstChar) firstChar.click();
}

// ═══════════════════════════════════════
//  角色列表
// ═══════════════════════════════════════

async function loadCharacters() {
  try {
    const chars = await API.getCharacters();
    dom.characterList.innerHTML = chars
      .map(
        (c) => `
      <div class="character-item ${c.id === state.currentCharacterId ? 'active' : ''}"
           data-id="${c.id}">
        <span class="char-avatar">${c.name[0]}</span>
        <div class="char-info" data-action="select">
          <span class="char-name">${c.name}</span>
          <span class="char-prompt-preview">${c.basePrompt.slice(0, 30)}...</span>
        </div>
        <button class="char-edit-btn" data-action="edit" title="编辑角色">✎</button>
      </div>`,
      )
      .join('');

    // 事件委托：点击角色切换 / 编辑
    dom.characterList.querySelectorAll('.character-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'edit') {
          e.stopPropagation();
          showEditCharacter(el.dataset.id);
        } else {
          selectCharacter(el.dataset.id);
        }
      });
    });
  } catch (err) {
    console.error('加载角色失败:', err);
  }
}

function selectCharacter(id) {
  state.currentCharacterId = id;
  dom.characterList.querySelectorAll('.character-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id);
  });
  dom.newSessionBtn.disabled = false;
  loadSessions();
}

// ═══════════════════════════════════════
//  编辑角色
// ═══════════════════════════════════════

async function showEditCharacter(id) {
  try {
    const char = await API.getCharacter(id);

    // 用对话框让用户编辑
    const newName = prompt('角色名称:', char.name);
    if (newName === null) return; // 取消

    const newPrompt = prompt('人格设定:', char.basePrompt);
    if (newPrompt === null) return;

    await API.updateCharacter(id, {
      name: newName.trim() || char.name,
      basePrompt: newPrompt.trim() || char.basePrompt,
    });

    await loadCharacters();
    // 恢复选中状态
    state.currentCharacterId = id;
    dom.characterList.querySelectorAll('.character-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === id);
    });
  } catch (err) {
    alert('修改失败: ' + err.message);
  }
}

// ═══════════════════════════════════════
//  会话列表
// ═══════════════════════════════════════

async function loadSessions() {
  try {
    const sessions = await API.getSessions();
    // 只显示当前角色的会话
    const filtered = state.currentCharacterId
      ? sessions.filter((s) => s.characterId === state.currentCharacterId)
      : sessions;

    dom.sessionList.innerHTML = filtered
      .map(
        (s) => `
      <div class="session-item ${s.id === state.currentSessionId ? 'active' : ''}"
           data-id="${s.id}">
        <span>💬</span>
        <span class="session-title">${s.title || '新对话'}</span>
        <span class="session-count">${s.messageCount}</span>
        <button class="session-delete" data-id="${s.id}">×</button>
      </div>`,
      )
      .join('');

    // 点击会话切换
    dom.sessionList.querySelectorAll('.session-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('session-delete')) return;
        selectSession(el.dataset.id);
      });
    });

    // 删除按钮
    dom.sessionList.querySelectorAll('.session-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSession(btn.dataset.id);
      });
    });
  } catch (err) {
    console.error('加载会话失败:', err);
  }
}

async function selectSession(id) {
  state.currentSessionId = id;
  dom.sessionList.querySelectorAll('.session-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id);
  });

  // 加载消息历史（简化：从 session 详情获取）
  try {
    const session = await API.getSession(id);
    dom.chatTitle.textContent = `对话 #${id.slice(0, 8)}`;
  } catch {
    dom.chatTitle.textContent = '聊天';
  }

  dom.input.disabled = false;
  dom.sendBtn.disabled = false;
  dom.input.focus();
}

async function deleteSession(id) {
  if (!confirm('删除这个会话？')) return;
  await API.deleteSession(id);
  if (state.currentSessionId === id) {
    state.currentSessionId = null;
    dom.messages.innerHTML = '';
    dom.chatTitle.textContent = '选择一个会话开始聊天';
    dom.input.disabled = true;
    dom.sendBtn.disabled = true;
  }
  loadSessions();
}

// ═══════════════════════════════════════
//  发送消息
// ═══════════════════════════════════════

async function sendMessage() {
  const content = dom.input.value.trim();
  if (!content || !state.currentSessionId || state.isStreaming) return;

  // 显示用户消息
  appendMessage('user', content);
  dom.input.value = '';
  state.isStreaming = true;
  dom.sendBtn.disabled = true;
  setStatus('streaming');

  // 创建 AI 消息气泡（空内容，后续逐字填充）
  const aiBubble = appendMessage('assistant', '', true);
  let fullText = '';

  state.abortController = API.sendMessageStream(state.currentSessionId, content, {
    onChunk(chunk) {
      fullText += chunk;
      aiBubble.textContent = fullText;
      dom.messages.scrollTop = dom.messages.scrollHeight;
    },
    onDone() {
      state.isStreaming = false;
      dom.sendBtn.disabled = false;
      setStatus('online');
      loadSessions(); // 刷新消息计数
    },
    onError(err) {
      aiBubble.textContent = `[错误] ${err.message}`;
      aiBubble.classList.add('error');
      state.isStreaming = false;
      dom.sendBtn.disabled = false;
      setStatus('error', err.message);
    },
  });
}

function appendMessage(role, content, isStreaming = false) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (isStreaming) div.classList.add('streaming');
  div.textContent = content;
  dom.messages.appendChild(div);
  dom.messages.scrollTop = dom.messages.scrollHeight;
  return div;
}

// ═══════════════════════════════════════
//  状态指示
// ═══════════════════════════════════════

function setStatus(state, msg = '') {
  const map = {
    online: { color: '#4ade80', text: '在线' },
    streaming: { color: '#facc15', text: '回复中...' },
    error: { color: '#ef4444', text: msg || '错误' },
  };
  const s = map[state] || map.online;
  dom.statusDot.style.background = s.color;
  dom.statusText.textContent = s.text;
}

// ═══════════════════════════════════════
//  事件绑定
// ═══════════════════════════════════════

function bindEvents() {
  // 发送按钮
  dom.sendBtn.addEventListener('click', sendMessage);
  dom.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // 新建角色
  dom.newCharForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = dom.charId.value.trim();
    const name = dom.charName.value.trim();
    const prompt = dom.charPrompt.value.trim();
    if (!id || !name || !prompt) return;

    try {
      await API.createCharacter(id, name, prompt);
      dom.charId.value = '';
      dom.charName.value = '';
      dom.charPrompt.value = '';
      await loadCharacters();
    } catch (err) {
      alert('创建角色失败: ' + err.message);
    }
  });

  // 新建会话
  dom.newSessionBtn.addEventListener('click', async () => {
    if (!state.currentCharacterId) {
      alert('请先选择一个角色');
      return;
    }
    try {
      const session = await API.createSession(state.currentCharacterId);
      await loadSessions();
      selectSession(session.id);
    } catch (err) {
      alert('创建会话失败: ' + err.message);
    }
  });
}
