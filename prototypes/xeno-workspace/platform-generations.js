/* Studio generation addresses and lists. Parent owns workspace route/frame mounting. */
(() => {
  const P = window.XENO_PLATFORM;
  const TYPES = ['image', 'video', 'audio', '3d'];
  const pathFor = (type, id) => '/workspace/studio/generate/' + type + (id ? '/g/' + encodeURIComponent(id) : '');
  const route = (path = location.pathname) => {
    const m = path.match(/^\/workspace\/studio\/generate\/(image|video|audio|3d)(?:\/g\/([0-9a-f-]{36}))?\/?$/i);
    return m ? { type: m[1].toLowerCase(), id: m[2] || null, framePath: '/chat?generationType=' + m[1].toLowerCase() + (m[2] ? '&generationId=' + encodeURIComponent(m[2]) : '') } : null;
  };
  const host = () => '<div class="live-chat-host" data-chat-frame data-generation-host></div>';
  const open = (type, id) => {
    if (!TYPES.includes(type)) throw new Error('Unsupported generation type');
    window.location.assign(pathFor(type, id));
  };
  async function list(type) {
    if (!P?.served || !TYPES.includes(type)) throw new Error('Generation history unavailable');
    const result = await P.api('GET', '/api/generations?type=' + encodeURIComponent(type));
    if (!result.ok || !Array.isArray(result.d?.generations)) throw new Error(result.d?.message || 'Generation history unavailable');
    return result.d.generations;
  }
  async function paintList(container, type) {
    container.replaceChildren(); const status = document.createElement('p'); status.textContent = 'Loading generations…'; container.append(status);
    try {
      const items = await list(type); if (!container.isConnected) return;
      container.replaceChildren();
      if (!items.length) { status.textContent = 'No generations yet.'; container.append(status); }
      for (const item of items) {
        const link = document.createElement('a'); link.href = pathFor(item.type, item.id); link.textContent = (item.request?.prompt || item.id) + ' · ' + String(item.state).replace(/_/g, ' '); container.append(link);
      }
    } catch(e) { status.textContent = e.message || 'Generation history unavailable'; const retry=document.createElement('button');retry.textContent='Reload history';retry.addEventListener('click',()=>void paintList(container,type));container.append(retry); }
  }
  window.XENO_GENERATIONS = { served: Boolean(P?.served), pathFor, route, host, open, list, paintList };
})();
