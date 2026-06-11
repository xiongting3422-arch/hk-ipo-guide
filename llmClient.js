/**
 * 富途 LLM 网关通用客户端（axios，非官方 Anthropic SDK）
 * 环境变量见 .env：LLM_GATEWAY_URL / LLM_GATEWAY_KEY / LLM_MODEL_ID
 */
require('dotenv').config();

const axios = require('axios');

function requireEnv(name) {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`缺少环境变量 ${name}，请在项目根目录 .env 中配置`);
  return v;
}

function resolveModelId(override) {
  if (override) return String(override).trim();
  const raw = requireEnv('LLM_MODEL_ID');
  return raw.split(',')[0].trim();
}

function extractClaudeText(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (Array.isArray(data.content)) {
    return data.content
      .filter(block => block && (block.type === 'text' || block.text))
      .map(block => block.text || '')
      .join('');
  }
  const choice = data.choices && data.choices[0];
  if (choice && choice.message && choice.message.content) return String(choice.message.content);
  if (data.output_text) return String(data.output_text);
  if (data.text) return String(data.text);
  return '';
}

let _client = null;

function getLlmClient() {
  if (_client) return _client;
  const baseURL = requireEnv('LLM_GATEWAY_URL').replace(/\/$/, '');
  _client = axios.create({
    baseURL,
    timeout: Number(process.env.LLM_TIMEOUT_MS || 120000),
    headers: { 'Content-Type': 'application/json' },
  });
  return _client;
}

/**
 * @param {string|{ system?: string, user?: string, content?: string }} prompt
 * @param {{ model?: string, system?: string, maxTokens?: number, temperature?: number }} [options]
 * @returns {Promise<{ text: string, raw: unknown, model: string }>}
 */
async function requestClaude(prompt, options = {}) {
  const model = resolveModelId(options.model);
  const apiKey = requireEnv('LLM_GATEWAY_KEY');
  const maxTokens = options.maxTokens ?? Number(process.env.LLM_MAX_TOKENS || 4096);
  const temperature = options.temperature ?? Number(process.env.LLM_TEMPERATURE ?? 0.25);

  let system = options.system;
  let user = '';
  if (typeof prompt === 'string') {
    user = prompt;
  } else if (prompt && typeof prompt === 'object') {
    system = prompt.system ?? system;
    user = prompt.user ?? prompt.content ?? '';
  }
  if (!user) throw new Error('requestClaude: prompt 不能为空');

  const messages = [{ role: 'user', content: user }];
  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (Number.isFinite(temperature)) body.temperature = temperature;

  const apiPath = String(process.env.LLM_API_PATH || '/v1/messages').trim() || '/v1/messages';

  const client = getLlmClient();
  const res = await client.post(apiPath, body, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'anthropic-version': process.env.LLM_ANTHROPIC_VERSION || '2023-06-01',
    },
  });

  const text = extractClaudeText(res.data);
  if (!text) {
    throw new Error('LLM 网关返回空内容 · ' + JSON.stringify(res.data).slice(0, 200));
  }
  return { text, raw: res.data, model };
}

module.exports = {
  requestClaude,
  getLlmClient,
  extractClaudeText,
  resolveModelId,
};
