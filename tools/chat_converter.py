#!/usr/bin/env python3
"""
聊天记录格式转换器 —— 把各种聊天记录转成 AI Companion 导入 API 格式。

支持的输入格式:
  1. 微信 PC 版时间戳格式（自动识别）
  2. 冒号分隔格式（我：消息内容）
  3. 方括号格式（[用户名] 消息内容）
  4. QQ 导出格式
  5. CSV / TSV 格式
  6. 纯文本（一行一条，交替排列）

输出:
  - JSON（可直接 POST 到 /api/import/chat-records）
  - 或纯文本预览

用法:
  python tools/chat_converter.py input.txt --user "我,自己" --ai "小雅,bot"
  python tools/chat_converter.py "粘贴的聊天文本" --format wechat --json
  python tools/chat_converter.py chat.txt -u "我" -a "小雅" --api-url http://localhost:3000
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib import request
from urllib.error import URLError


# ═══════════════════════════════════════════════════════════════
#  解析器
# ═══════════════════════════════════════════════════════════════

class ChatRecord:
    """单条聊天记录"""
    __slots__ = ('speaker', 'role', 'content', 'timestamp')
    def __init__(self, speaker: str, role: str, content: str, timestamp: Optional[str] = None):
        self.speaker = speaker
        self.role = role          # 'user' | 'assistant'
        self.content = content
        self.timestamp = timestamp


class ChatParser:
    """通用聊天记录解析器"""

    def __init__(
        self,
        text: str,
        user_aliases: list[str] | None = None,
        assistant_aliases: list[str] | None = None,
        default_role: str = "user",
    ):
        self.raw = text.replace('\r\n', '\n')
        self.user_aliases = self._normalize(user_aliases or [], [
            '我', '用户', 'user', 'me', '自己', '本人', 'mine', 'self',
        ])
        self.assistant_aliases = self._normalize(assistant_aliases or [], [
            'ai', 'assistant', 'bot', '机器人', '小雅', '系统', 'system',
            'gpt', 'chatgpt', 'claude', 'deepseek',
        ])
        self.default_role = default_role
        self.records: list[ChatRecord] = []

    @staticmethod
    def _normalize(extra: list[str], defaults: list[str]) -> set[str]:
        return {s.strip().lower() for s in extra + defaults if s.strip()}

    def resolve_role(self, speaker: str) -> str:
        """根据说话人名字判断是 user 还是 assistant"""
        s = speaker.strip().lower()
        if s in self.user_aliases:
            return 'user'
        if s in self.assistant_aliases:
            return 'assistant'
        return self.default_role

    # ── 主解析入口 ────────────────────────────────────────────

    def parse(self) -> list[ChatRecord]:
        """自动检测格式并解析"""
        if not self.raw.strip():
            return []

        # 尝试各格式，优先匹配微信时间戳格式
        for detector in [
            self._try_wechat_timestamp,
            self._try_qq_timestamp,
            self._try_colon_inline,
            self._try_bracket_format,
            self._try_csv,
            self._try_fallback,
        ]:
            result = detector()
            if result:
                self.records = result
                break

        return self.records

    # ── 微信时间戳格式 ────────────────────────────────────────
    # 2026-06-04 21:18:03 用户名
    # 消息内容第一行
    # 消息内容第二行

    def _try_wechat_timestamp(self) -> list[ChatRecord] | None:
        # 时间戳开头的行
        ts_pattern = re.compile(
            r'^(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s+(.{1,40})$'
        )
        lines = self.raw.split('\n')
        records: list[ChatRecord] = []
        current_speaker: str | None = None
        current_ts: str | None = None
        current_lines: list[str] = []

        def flush():
            nonlocal current_speaker, current_ts, current_lines
            if current_speaker and current_lines:
                content = '\n'.join(current_lines).strip()
                if content:
                    role = self.resolve_role(current_speaker)
                    records.append(ChatRecord(current_speaker, role, content, current_ts))
            current_speaker = None
            current_ts = None
            current_lines = []

        for line in lines:
            m = ts_pattern.match(line.strip())
            if m:
                flush()
                current_ts = m.group(1)
                current_speaker = m.group(2).strip()
                current_lines = []
                continue

            # 检查"用户名：消息"行内格式
            if current_speaker is None:
                inline = re.match(r'^(.{1,40})[:：]\s*(.+)$', line.strip())
                if inline:
                    sp = inline.group(1).strip()
                    role = self.resolve_role(sp)
                    records.append(ChatRecord(sp, role, inline.group(2).strip()))
                continue

            if line.strip():
                    # 检查是否是行内格式（冒号前面是已知说话人就单独成条）
                    inline = re.match(r'^(.{1,40})[:：]\s*(.+)$', line.strip())
                    if inline:
                        sp = inline.group(1).strip()
                        sp_lower = sp.lower()
                        is_known = (
                            sp_lower in self.user_aliases
                            or sp_lower in self.assistant_aliases
                        )
                        if is_known or sp != current_speaker:
                            flush()
                            role = self.resolve_role(sp)
                            records.append(ChatRecord(sp, role, inline.group(2).strip()))
                            continue
                    current_lines.append(line.strip())
            elif current_lines:
                current_lines.append('')  # 保留空行

        flush()

        # 至少 2 条带时间戳的记录才认为是微信格式
        ts_records = [r for r in records if r.timestamp]
        if len(ts_records) >= 2:
            return records
        return None

    # ── QQ 时间戳格式 ─────────────────────────────────────────
    # 用户名 2026-06-04 21:18:03
    # 消息内容

    def _try_qq_timestamp(self) -> list[ChatRecord] | None:
        qq_pattern = re.compile(
            r'^(.{1,40})\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s*$'
        )
        lines = self.raw.split('\n')
        records: list[ChatRecord] = []
        current_speaker: str | None = None
        current_ts: str | None = None
        current_lines: list[str] = []

        def flush():
            nonlocal current_speaker, current_ts, current_lines
            if current_speaker and current_lines:
                content = '\n'.join(current_lines).strip()
                if content:
                    role = self.resolve_role(current_speaker)
                    records.append(ChatRecord(current_speaker, role, content, current_ts))
            current_speaker = None
            current_ts = None
            current_lines = []

        for line in lines:
            m = qq_pattern.match(line.strip())
            if m:
                flush()
                current_speaker = m.group(1).strip()
                current_ts = m.group(2)
                current_lines = []
                continue

            if current_speaker is not None:
                if line.strip():
                    # 检查是否是行内格式（冒号前面是已知说话人就单独成条）
                    inline = re.match(r'^(.{1,40})[:：]\s*(.+)$', line.strip())
                    if inline:
                        sp = inline.group(1).strip()
                        sp_lower = sp.lower()
                        is_known = (
                            sp_lower in self.user_aliases
                            or sp_lower in self.assistant_aliases
                        )
                        if is_known or sp != current_speaker:
                            flush()
                            role = self.resolve_role(sp)
                            records.append(ChatRecord(sp, role, inline.group(2).strip()))
                            continue
                    current_lines.append(line.strip())
            elif line.strip():
                current_lines.append(line.strip())

        flush()
        ts_records = [r for r in records if r.timestamp]
        if len(ts_records) >= 3:
            return records
        return None

    # ── 冒号行内格式 ──────────────────────────────────────────
    # 我：今天好累
    # 小雅：辛苦啦

    def _try_colon_inline(self) -> list[ChatRecord] | None:
        pattern = re.compile(r'^(.{1,40})[:：]\s*(.+)$')
        records: list[ChatRecord] = []
        for line in self.raw.split('\n'):
            line = line.strip()
            if not line:
                continue
            m = pattern.match(line)
            if m:
                sp = m.group(1).strip()
                content = m.group(2).strip()
                role = self.resolve_role(sp)
                records.append(ChatRecord(sp, role, content))
        if len(records) >= 3:
            return records
        return None

    # ── 方括号格式 ────────────────────────────────────────────
    # [我] 今天好累
    # [小雅] 辛苦啦

    def _try_bracket_format(self) -> list[ChatRecord] | None:
        pattern = re.compile(r'^\[(.{1,40})\]\s*(.+)$')
        records: list[ChatRecord] = []
        for line in self.raw.split('\n'):
            line = line.strip()
            if not line:
                continue
            m = pattern.match(line)
            if m:
                sp = m.group(1).strip()
                content = m.group(2).strip()
                role = self.resolve_role(sp)
                records.append(ChatRecord(sp, role, content))
        if len(records) >= 3:
            return records
        return None

    # ── CSV 格式 ──────────────────────────────────────────────
    # speaker,role,content
    # 我,user,今天好累

    def _try_csv(self) -> list[ChatRecord] | None:
        import csv
        from io import StringIO

        # 检查是否有明显的 CSV 特征
        sample = self.raw[:500]
        if ',' not in sample or '\t' in sample:
            # 也尝试 TSV
            pass

        # 尝试 CSV
        try:
            reader = csv.reader(StringIO(self.raw))
            records: list[ChatRecord] = []
            for row in reader:
                if not row or len(row) < 2:
                    continue
                if len(row) >= 3:
                    sp, role_or_content, content = row[0], row[1], row[2]
                    if role_or_content in ('user', 'assistant'):
                        records.append(ChatRecord(sp, role_or_content, content))
                    else:
                        role = self.resolve_role(sp)
                        records.append(ChatRecord(sp, role, role_or_content))
                else:
                    sp, content = row[0], row[1]
                    role = self.resolve_role(sp)
                    records.append(ChatRecord(sp, role, content))
            if len(records) >= 3:
                return records
        except Exception:
            pass
        return None

    # ── 回退：交替行 ──────────────────────────────────────────

    def _try_fallback(self) -> list[ChatRecord]:
        """最后手段：按行拆分，user/assistant 交替分配"""
        lines = [l.strip() for l in self.raw.split('\n') if l.strip()]
        if len(lines) < 2:
            return []

        records: list[ChatRecord] = []
        roles = ['user', 'assistant']
        for i, line in enumerate(lines):
            records.append(ChatRecord(
                speaker=roles[i % 2],
                role=roles[i % 2],
                content=line,
            ))
        return records

    # ── 输出 ──────────────────────────────────────────────────

    def to_json(self, session_id: str = "", pretty: bool = True) -> str:
        """输出为 AI Companion 导入 API 兼容的 JSON"""
        payload = {
            "sessionId": session_id,
            "text": self.to_wechat_format(),
            "userAliases": sorted(self.user_aliases),
            "assistantAliases": sorted(self.assistant_aliases),
            "triggerMemoryExtraction": True,
            "generateSummary": True,
            "extractProfile": True,
        }
        indent = 2 if pretty else None
        return json.dumps(payload, ensure_ascii=False, indent=indent)

    def to_wechat_format(self) -> str:
        """转回微信时间戳格式文本"""
        lines: list[str] = []
        base_time = datetime.now()
        for i, r in enumerate(self.records):
            ts = r.timestamp or base_time.replace(
                second=(base_time.second + i) % 60
            ).strftime('%Y-%m-%d %H:%M:%S')
            lines.append(f"{ts} {r.speaker}")
            lines.append(r.content)
            lines.append("")
        return '\n'.join(lines).strip()

    def to_preview(self) -> str:
        """人类可读预览"""
        lines: list[str] = []
        for r in self.records:
            role_tag = "[U]" if r.role == 'user' else "[AI]"
            ts = f" [{r.timestamp}]" if r.timestamp else ""
            lines.append(f"{role_tag} {r.speaker}{ts}: {r.content}")
        return '\n'.join(lines)

    @property
    def stats(self) -> dict:
        """统计信息"""
        user_count = sum(1 for r in self.records if r.role == 'user')
        ai_count = sum(1 for r in self.records if r.role == 'assistant')
        speakers = list(dict.fromkeys(r.speaker for r in self.records))
        return {
            "total": len(self.records),
            "user_messages": user_count,
            "assistant_messages": ai_count,
            "speakers": speakers,
        }


# ═══════════════════════════════════════════════════════════════
#  CLI
# ═══════════════════════════════════════════════════════════════

def detect_encoding(filepath: str) -> str:
    """检测文件编码"""
    # 尝试常见编码
    for enc in ['utf-8', 'utf-8-sig', 'gbk', 'gb2312', 'gb18030']:
        try:
            with open(filepath, 'r', encoding=enc) as f:
                f.read()
            return enc
        except (UnicodeDecodeError, UnicodeError):
            continue
    return 'utf-8'


def read_input(source: str) -> str:
    """读取输入：文件路径或直接文本"""
    # 判断是文件还是直接文本
    if os.path.isfile(source):
        enc = detect_encoding(source)
        with open(source, 'r', encoding=enc) as f:
            return f.read()
    # 尝试作为文件路径（支持相对路径）
    p = Path(source)
    if p.exists() and p.is_file():
        enc = detect_encoding(str(p))
        return p.read_text(encoding=enc)
    # 直接文本
    return source


def post_to_api(api_url: str, session_id: str, payload: dict) -> bool:
    """发送到 AI Companion 导入 API"""
    payload["sessionId"] = session_id
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    url = f"{api_url.rstrip('/')}/api/import/chat-records"

    req = request.Request(url, data=data, headers={
        'Content-Type': 'application/json; charset=utf-8',
    }, method='POST')

    try:
        with request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            print(f"\n✅ 导入成功!")
            print(f"   解析: {result.get('parsed', '?')} 条")
            print(f"   写入: {result.get('inserted', '?')} 条")
            if result.get('memoryExtractionQueued'):
                print(f"   🧠 记忆提取已排队")
            if result.get('summaryQueued'):
                print(f"   📝 摘要生成已排队")
            if result.get('profileExtractionQueued'):
                print(f"   👤 画像提取已排队")
            return True
    except URLError as e:
        print(f"\n❌ API 请求失败: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description='聊天记录格式转换器 —— 把各种聊天记录转成 AI Companion 导入格式',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 预览解析结果
  python tools/chat_converter.py chat.txt -u "我,自己" -a "小雅"

  # 输出 JSON（可直接 POST 到导入 API）
  python tools/chat_converter.py chat.txt -u "我" -a "小雅" --json

  # 直接发送到后端
  python tools/chat_converter.py chat.txt -u "我" -a "小雅" --api-url http://localhost:3000 --session-id "<UUID>"

  # 从剪贴板粘贴（Windows）
  powershell Get-Clipboard | python tools/chat_converter.py - -u "我" -a "小雅"
        """,
    )
    parser.add_argument(
        'input', help='输入文件路径 或 直接粘贴的聊天文本（用引号包裹）'
    )
    parser.add_argument(
        '-u', '--user', default='我', help='用户别名，逗号分隔（默认: 我）'
    )
    parser.add_argument(
        '-a', '--assistant', default='小雅', help='AI 别名，逗号分隔（默认: 小雅）'
    )
    parser.add_argument(
        '--format', choices=['wechat', 'qq', 'auto'], default='auto',
        help='强制指定输入格式（默认: auto 自动检测）'
    )
    parser.add_argument(
        '--json', action='store_true', help='输出 JSON（导入 API 格式）'
    )
    parser.add_argument(
        '--json-pretty', action='store_true', default=True,
        help='JSON 美化输出（默认开启）'
    )
    parser.add_argument(
        '--api-url', help='AI Companion 后端地址（如 http://localhost:3000）'
    )
    parser.add_argument(
        '--session-id', help='目标会话 UUID（配合 --api-url 使用）'
    )
    parser.add_argument(
        '--output', '-o', help='输出文件路径（默认: stdout）'
    )
    parser.add_argument(
        '--preview', action='store_true', help='仅预览前 10 条'
    )

    args = parser.parse_args()

    # 读取输入
    text = read_input(args.input)

    # 解析
    user_aliases = [x.strip() for x in args.user.split(',') if x.strip()]
    assistant_aliases = [x.strip() for x in args.assistant.split(',') if x.strip()]

    chat_parser = ChatParser(
        text,
        user_aliases=user_aliases,
        assistant_aliases=assistant_aliases,
    )
    records = chat_parser.parse()

    if not records:
        print("❌ 未能解析任何聊天记录。请检查输入格式。", file=sys.stderr)
        print("   支持格式: 微信时间戳 / QQ时间戳 / 冒号分隔 / 方括号 / CSV", file=sys.stderr)
        sys.exit(1)

    # 统计
    stats = chat_parser.stats
    print(f"📊 解析结果:", file=sys.stderr)
    print(f"   总条数: {stats['total']}", file=sys.stderr)
    print(f"   用户消息: {stats['user_messages']}", file=sys.stderr)
    print(f"   AI 消息: {stats['assistant_messages']}", file=sys.stderr)
    print(f"   说话人: {', '.join(stats['speakers'])}", file=sys.stderr)
    print(file=sys.stderr)

    # 输出
    if args.preview:
        output = '\n'.join(chat_parser.to_preview().split('\n')[:10])
        output += f"\n... (共 {len(records)} 条)"
    elif args.json:
        output = chat_parser.to_json(session_id=args.session_id or "", pretty=args.json_pretty)
    else:
        output = chat_parser.to_preview()

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(output)
        print(f"✅ 已保存到 {args.output}", file=sys.stderr)
    else:
        print(output)

    # 发送到 API
    if args.api_url:
        if not args.session_id:
            print("❌ --api-url 需要配合 --session-id 使用", file=sys.stderr)
            sys.exit(1)
        payload = json.loads(chat_parser.to_json(session_id=args.session_id, pretty=False))
        post_to_api(args.api_url, args.session_id, payload)


if __name__ == '__main__':
    main()
