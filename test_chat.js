/**
 * AI 伴侣 —— 聊天测试脚本
 *
 * 为什么用 Node.js 而不是 curl？
 *   Windows bash + curl 传中文会乱码（GBK vs UTF-8 问题）。
 *   Node.js 原生 UTF-8，中文字符零损失。
 *
 * 使用：
 *   1. 先确保服务器在运行: npm run start:dev
 *   2. 确保 Python 服务在运行: MOCK_EMBEDDING=1 uv run uvicorn main:app --port 8000
 *   3. node test_chat.js
 */

const http = require('http');
const BASE = 'http://localhost:3000';

// ═══════════════════════════════════════
//  HTTP 工具函数
// ═══════════════════════════════════════

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function post(path, body) {
  return request('POST', path, body);
}

async function del(path) {
  return request('DELETE', path);
}

// ═══════════════════════════════════════
//  测试流程
// ═══════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════╗');
  console.log('║   AI 伴侣 —— 端到端测试         ║');
  console.log('╚══════════════════════════════════╝\n');

  // ── 1. 确保小雅角色存在 ──
  console.log('[1/6] 创建角色 xiaoya...');
  let charResult;
  try {
    charResult = await post('/api/characters', {
      id: 'xiaoya',
      name: '小雅',
      base_prompt:
        '你是小雅，25岁，温柔体贴，说话喜欢用"呢"和"呀"结尾。对用户的感受非常在意，会主动关心。',
    });
    console.log('  角色已创建:', charResult.body.id);
  } catch {
    // 角色可能已存在，尝试获取
    console.log('  角色已存在');
  }

  // ── 2. 创建新会话 ──
  console.log('\n[2/6] 创建会话...');
  const sess = await post('/api/sessions', { characterId: 'xiaoya' });
  const sessionId = sess.body.id;
  console.log('  会话 ID:', sessionId);

  // ── 3. 第一轮对话：透露个人信息 ──
  console.log('\n[3/6] 第一轮对话（透露个人信息）...');
  const msg1 = '你好呀小雅！我刚搬到北京工作，是一名前端工程师，养了一只叫团子的橘猫';
  console.log('  用户:', msg1);
  const r1 = await post(`/api/chat/${sessionId}`, { content: msg1 });
  console.log('  小雅:', r1.body.reply);

  // ── 4. 等待异步记忆提取 ──
  console.log('\n[4/6] 等待记忆提取（3 秒）...');
  await new Promise((r) => setTimeout(r, 4000));

  // ── 5. 第二轮对话：测试记忆 ──
  console.log('\n[5/6] 第二轮对话（测试记忆）...');
  const msg2 = '你还记得我的猫叫什么名字吗？';
  console.log('  用户:', msg2);
  const r2 = await post(`/api/chat/${sessionId}`, { content: msg2 });
  console.log('  小雅:', r2.body.reply);

  // ── 6. 第三轮对话：测试情绪感知 ──
  console.log('\n[6/6] 第三轮对话（情绪）...');
  const msg3 = '今天加班好累呀，心情有点低落';
  console.log('  用户:', msg3);
  const r3 = await post(`/api/chat/${sessionId}`, { content: msg3 });
  console.log('  小雅:', r3.body.reply);

  // ── 结果总结 ──
  console.log('\n══════════════════════════════════');
  console.log('  测试完成！');
  console.log('  Session ID:', sessionId);
  console.log('══════════════════════════════════\n');
}

main().catch((e) => {
  console.error('测试失败:', e.message);
  console.error('请确认两台服务器都在运行：');
  console.error('  终端1: cd python && MOCK_EMBEDDING=1 uv run uvicorn main:app --port 8000');
  console.error('  终端2: cd companion && npm run start:dev');
});
