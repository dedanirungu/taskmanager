// Minimal Telegram Bot API wrapper using fetch — no extra dependency.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT = process.env.TELEGRAM_ADMIN_CHAT_ID || '';

export function telegramEnabled() {
  return Boolean(TOKEN && ADMIN_CHAT);
}

export async function sendTelegram(text, { chatId = ADMIN_CHAT, parseMode = 'HTML' } = {}) {
  if (!TOKEN || !chatId) {
    console.log('[telegram] disabled, would have sent:', text);
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    });
    const body = await res.json();
    if (!body.ok) console.error('[telegram] api error:', body);
    return body;
  } catch (err) {
    console.error('[telegram] send failed:', err.message);
    return { ok: false, error: err.message };
  }
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
