# WeChat current chat export tool

This is a safe, semi-automatic exporter for the currently opened WeChat chat.
It does not read, decrypt, or modify WeChat databases. It only uses the visible
WeChat window and the Windows clipboard.

## Recommended workflow

1. Open WeChat.
2. Click the chat you want to export.
3. Scroll upward until the history range you need is loaded.
4. Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File tools\export_wechat_current_chat.ps1 -SelectAll
~~~

The exported text is saved under:

~~~text
exports\wechat\
~~~

## Safer manual mode

If Ctrl+A does not select the chat area correctly:

1. Manually select messages in WeChat.
2. Press Ctrl+C.
3. Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File tools\export_wechat_current_chat.ps1 -NoAutoCopy
~~~

## Import into AI Companion

Start the backend first, then run:

~~~powershell
powershell -ExecutionPolicy Bypass -File tools\export_wechat_current_chat.ps1 -SelectAll -Import -SessionId <UUID>
~~~

Or import a saved file with the converter:

~~~powershell
python tools\chat_converter.py "exports\wechat\wechat_current_chat_YYYYMMDD_HHMMSS.txt" --api-url http://localhost:3000 --session-id <UUID>
~~~

## Notes

- WeChat official backup/restore does not produce readable text files.
- This tool works best for text messages. Images, voice messages, red packets,
  transfers, deleted messages, and some system messages may copy as placeholders
  or may not copy at all.
- For very long histories, scroll upward in WeChat first so the desired messages
  are loaded before copying.
