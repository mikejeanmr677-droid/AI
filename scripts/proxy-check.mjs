// 验证 NODE_USE_ENV_PROXY=1 + HTTPS_PROXY 是否让全局 fetch 走代理
console.log('NODE_USE_ENV_PROXY:', process.env.NODE_USE_ENV_PROXY, 'HTTPS_PROXY:', process.env.HTTPS_PROXY);
try {
  const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer test' }, signal: AbortSignal.timeout(25000) });
  console.log('status', r.status);
} catch (e) {
  console.log('ERR', e.cause?.code || e.message);
}
