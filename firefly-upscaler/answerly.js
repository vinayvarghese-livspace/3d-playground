// Answerly / Triflo API helpers for the local playground bridge.
const fs = require('fs');
const path = require('path');

const BASE = 'https://answerly.livspace.com';
// Prefer the shared Marketing Visualization team workspace over personal.
const DEFAULT_WORKSPACE = '9901bfd2-4c06-4746-8d63-aa2867248f1e';
const PREFERRED_WORKSPACE_NAME = /marketing\s*visualization/i;
const TOKEN_PATH = path.join(__dirname, 'answerly-token.json');

const WORKFLOWS = {
  'image-edit-workflow': {
    id: 'image-edit-workflow',
    label: 'Image Edit',
    needsImage: true,
    imageField: 'image_url',
    promptField: 'edit_instructions'
  },
  'image-to-image-workflow': {
    id: 'image-to-image-workflow',
    label: 'Image to Image',
    needsImage: true,
    imageField: 'reference_image_url',
    promptField: 'prompt'
  },
  'image-generate-workflow': {
    id: 'image-generate-workflow',
    label: 'Image Generation',
    needsImage: false,
    imageField: null,
    promptField: 'prompt'
  }
};

const FALLBACK_MODELS = [
  { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image' },
  { id: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image' },
  { id: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1' },
  { id: 'openai/gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst' },
  { id: 'krea/krea-2-large', label: 'Krea 2 Large (1 ref)' },
  { id: 'krea/krea-realtime', label: 'Krea Realtime (1 ref)' },
  { id: 'xai/grok-imagine', label: 'Grok Imagine (1 ref)' }
];

/** Prefer working image-to-image models; demote experimental / 1-ref-only entries. */
function preferModelOrder(models) {
  const rank = (id) => {
    const low = String(id || '').toLowerCase();
    if (/gemini-3\.1-flash-image/.test(low)) return 0;
    if (/gemini-3-pro-image/.test(low)) return 1;
    if (/gpt-image-2\.5|sunburst/.test(low)) return 2;
    if (/nano-banana/.test(low)) return 3;
    if (/krea/.test(low)) return 8;
    if (/grok|xai\//.test(low)) return 9;
    return 5;
  };
  return models.slice().sort((a, b) => {
    const d = rank(a.id) - rank(b.id);
    if (d) return d;
    return String(a.label || a.id).localeCompare(String(b.label || b.id));
  });
}

let state = {
  accessToken: null,
  workspaceId: DEFAULT_WORKSPACE,
  workspaceName: 'Marketing Visualization Team',
  workspaceKind: 'team',
  savedAt: 0
};

function loadTokenFile() {
  try {
    if (!fs.existsSync(TOKEN_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    if (raw && raw.accessToken) {
      state.accessToken = String(raw.accessToken).trim();
      state.workspaceId = raw.workspaceId || DEFAULT_WORKSPACE;
      state.workspaceName = raw.workspaceName || state.workspaceName;
      state.workspaceKind = raw.workspaceKind || state.workspaceKind;
      state.savedAt = raw.savedAt || Date.now();
    }
  } catch (_) {}
}

function saveTokenFile() {
  try {
    fs.writeFileSync(
      TOKEN_PATH,
      JSON.stringify(
        {
          accessToken: state.accessToken,
          workspaceId: state.workspaceId,
          workspaceName: state.workspaceName,
          workspaceKind: state.workspaceKind,
          savedAt: state.savedAt
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  } catch (_) {}
}

loadTokenFile();

// If a token is already on disk, resolve Marketing Visualization Team on boot (non-blocking).
setTimeout(() => {
  if (!state.accessToken) return;
  setTokenAndResolveWorkspace(state.accessToken, state.workspaceId || DEFAULT_WORKSPACE).catch(() => {});
}, 0);

function decodeJwtExp(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch (_) {
    return null;
  }
}

function workspaceInfo() {
  return {
    id: state.workspaceId || DEFAULT_WORKSPACE,
    name: state.workspaceName || 'Marketing Visualization Team',
    kind: state.workspaceKind || 'team'
  };
}

function tokenStatus() {
  const ws = workspaceInfo();
  if (!state.accessToken) {
    return {
      hasToken: false,
      expired: true,
      exp: null,
      expiresAt: null,
      secondsLeft: 0,
      workspaceId: ws.id,
      workspaceName: ws.name,
      workspaceKind: ws.kind
    };
  }
  const exp = decodeJwtExp(state.accessToken);
  if (!exp) {
    return {
      hasToken: true,
      expired: false,
      exp: null,
      expiresAt: null,
      secondsLeft: null,
      workspaceId: ws.id,
      workspaceName: ws.name,
      workspaceKind: ws.kind
    };
  }
  const secondsLeft = exp - Math.floor(Date.now() / 1000);
  return {
    hasToken: true,
    expired: secondsLeft <= 0,
    exp,
    expiresAt: new Date(exp * 1000).toISOString(),
    secondsLeft,
    workspaceId: ws.id,
    workspaceName: ws.name,
    workspaceKind: ws.kind
  };
}

function pickPreferredWorkspace(list) {
  const workspaces = Array.isArray(list) ? list : [];
  const byId = workspaces.find((w) => w && w.id === DEFAULT_WORKSPACE);
  if (byId) return byId;
  const byName = workspaces.find((w) => w && PREFERRED_WORKSPACE_NAME.test(String(w.name || '')));
  if (byName) return byName;
  const team = workspaces.find((w) => w && String(w.kind || '').toLowerCase() === 'team');
  if (team) return team;
  return workspaces[0] || null;
}

function applyWorkspace(ws, fallbackId) {
  if (ws && ws.id) {
    state.workspaceId = String(ws.id);
    state.workspaceName = String(ws.name || 'Workspace');
    state.workspaceKind = String(ws.kind || '');
    return;
  }
  if (fallbackId) state.workspaceId = String(fallbackId).trim();
  if (!state.workspaceId) state.workspaceId = DEFAULT_WORKSPACE;
  if (!state.workspaceName) state.workspaceName = 'Marketing Visualization Team';
}

function setToken(accessToken, workspaceId) {
  const token = String(accessToken || '').trim();
  if (!token) throw new Error('accessToken is required');
  if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(token)) {
    throw new Error('Not a JWT accessToken. Paste the /api/auth/session JSON (or the accessToken value), not the URL.');
  }
  const exp = decodeJwtExp(token);
  if (exp && exp <= Math.floor(Date.now() / 1000)) {
    throw new Error(
      'This accessToken is already expired (' + new Date(exp * 1000).toLocaleString() +
      '). Open https://answerly.livspace.com/api/auth/session while logged in, copy a fresh response, and paste again.'
    );
  }
  state.accessToken = token;
  if (workspaceId) applyWorkspace(null, workspaceId);
  state.savedAt = Date.now();
  saveTokenFile();
  return tokenStatus();
}

async function setTokenAndResolveWorkspace(accessToken, workspaceId) {
  const status = setToken(accessToken, workspaceId || DEFAULT_WORKSPACE);
  try {
    const list = await listWorkspaces();
    const preferred = workspaceId
      ? (list.find((w) => w.id === String(workspaceId)) || pickPreferredWorkspace(list))
      : pickPreferredWorkspace(list);
    if (preferred) {
      applyWorkspace(preferred);
      // Never keep a personal workspace when Marketing Visualization Team is available.
      if (String(preferred.kind || '').toLowerCase() === 'personal') {
        const marketing = pickPreferredWorkspace(list.filter((w) => String(w.kind || '').toLowerCase() !== 'personal'));
        if (marketing) applyWorkspace(marketing);
      }
      saveTokenFile();
    }
  } catch (_) {
    applyWorkspace(null, workspaceId || DEFAULT_WORKSPACE);
    saveTokenFile();
  }
  return tokenStatus();
}

function clearToken() {
  state.accessToken = null;
  state.savedAt = 0;
  state.workspaceId = DEFAULT_WORKSPACE;
  state.workspaceName = 'Marketing Visualization Team';
  state.workspaceKind = 'team';
  try {
    fs.rmSync(TOKEN_PATH, { force: true });
  } catch (_) {}
  return tokenStatus();
}

function requireToken() {
  const st = tokenStatus();
  if (!st.hasToken) throw new Error('No Answerly token. Paste accessToken from /api/auth/session.');
  if (st.expired) throw new Error('Answerly token expired. Refresh from /api/auth/session and paste again.');
  return state.accessToken;
}

function activeWorkspaceId() {
  return state.workspaceId || DEFAULT_WORKSPACE;
}

async function api(pathname, opts = {}) {
  const token = requireToken();
  const wsId = activeWorkspaceId();
  const headers = Object.assign(
    {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      // Single header only — sending both X-Workspace-Id and x-workspace-id makes Answerly return "Workspace not found".
      'X-Workspace-Id': wsId
    },
    opts.headers || {}
  );
  const res = await fetch(BASE + pathname, {
    method: opts.method || 'GET',
    headers,
    body: opts.body,
    signal: opts.signal
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const detail = json && (json.detail || json.error || json.message);
    const msg = typeof detail === 'string' ? detail : text.slice(0, 300) || res.statusText;
    const err = new Error(msg);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function listWorkspaces() {
  const data = await api('/api/workspaces');
  const list = Array.isArray(data) ? data : (data && data.workspaces) || [];
  return list.map((w) => ({
    id: w.id,
    name: w.name || w.id,
    kind: w.kind || '',
    role: w.role || '',
    orgId: w.org_id || null
  }));
}

async function listModels(tool) {
  // Specific tool → that list only. Otherwise merge every known image-tool filter
  // plus an unfiltered call so Krea / Grok / newer providers are not dropped.
  const tools = tool
    ? [tool]
    : [
        '',
        'image_to_image',
        'image_edit',
        'image_generate',
        'image',
        'text_to_image',
        'img2img'
      ];
  const seen = Object.create(null);
  const models = [];
  let defaultId = '';
  for (const t of tools) {
    try {
      const path = t
        ? '/api/v2/image-models?tool=' + encodeURIComponent(t)
        : '/api/v2/image-models';
      const data = await api(path);
      if (!defaultId && data.default_model_id) defaultId = data.default_model_id;
      (data.models || []).forEach((m) => {
        if (!m || !m.id || seen[m.id]) return;
        seen[m.id] = true;
        models.push({
          id: m.id,
          label: m.label || m.id,
          group: m.group || ''
        });
      });
    } catch (_) { /* try next */ }
  }
  if (!models.length) {
    return { default_model_id: FALLBACK_MODELS[0].id, models: FALLBACK_MODELS };
  }
  const ordered = preferModelOrder(models);
  // Prefer a multi-ref Gemini/GPT default when the API default is a 1-ref model.
  let pick = defaultId || (ordered[0] && ordered[0].id) || FALLBACK_MODELS[0].id;
  if (/krea|grok|xai\//.test(String(pick).toLowerCase())) {
    const better = ordered.find((m) => !/krea|grok|xai\//.test(String(m.id).toLowerCase()));
    if (better) pick = better.id;
  }
  return {
    default_model_id: pick,
    models: ordered
  };
}

async function uploadImage(buffer, filename, contentType) {
  const workspaceId = activeWorkspaceId();
  const name = (filename || 'upload.png').replace(/[\\/:*?"<>|]+/g, '_');
  const mime = contentType || 'image/png';

  const presign = await api('/api/assets/presign-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: name,
      content_type: mime,
      workspace_id: workspaceId
    })
  });

  // Do not add X-Workspace-Id on the storage PUT — only the signed headers from Answerly.
  const putHeaders = Object.assign({ 'Content-Type': mime }, presign.headers || {});
  const put = await fetch(presign.upload_url, {
    method: presign.method || 'PUT',
    headers: putHeaders,
    body: buffer
  });
  if (!put.ok) {
    const t = await put.text().catch(() => '');
    throw new Error('Upload to storage failed (' + put.status + '): ' + t.slice(0, 200));
  }

  const registered = await api('/api/assets/register-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asset_id: presign.asset_id,
      workspace_id: workspaceId
    })
  });

  const publicUrl = registered.public_url;
  if (!publicUrl) throw new Error('Upload registered but no public_url returned');
  return { assetId: registered.id || presign.asset_id, publicUrl };
}

function buildInput(workflowMeta, opts) {
  const input = {
    model: opts.model || 'gemini-3.1-flash-image',
    image_size: opts.image_size || '1K',
    aspect_ratio: '1:1'
  };
  input[workflowMeta.promptField] = opts.prompt;
  if (workflowMeta.needsImage) {
    const urls = Array.isArray(opts.imageUrls)
      ? opts.imageUrls.filter(Boolean)
      : (opts.imageUrl ? [opts.imageUrl] : []);
    if (!urls.length) throw new Error(workflowMeta.label + ' needs an input image');
    // Image to Image: one field per slot only — aliases duplicate rows in Answerly Jobs UI.
    // Primary = reference_image_url; products = second/third/fourth/fifth_reference_url.
    if (workflowMeta.id === 'image-to-image-workflow') {
      input.reference_image_url = urls[0];
      const modelLow = String(opts.model || '').toLowerCase();
      // Krea / Grok / xAI accept at most 1 reference — never set extra slots.
      const maxRefs = /krea|grok|xai\//.test(modelLow) ? 1 : 5; // A + up to 4 B
      const take = urls.slice(0, maxRefs);
      // Strip every multi-ref key (including legacy aliases) so Jobs UI stays clean.
      [
        'second_reference_url', 'third_reference_url', 'fourth_reference_url', 'fifth_reference_url',
        'second_reference_image_url', 'third_reference_image_url', 'fourth_reference_image_url',
        'fifth_reference_image_url', 'reference_image_urls'
      ].forEach((k) => { delete input[k]; });
      if (maxRefs > 1) {
        if (take[1]) input.second_reference_url = take[1];
        if (take[2]) input.third_reference_url = take[2];
        if (take[3]) input.fourth_reference_url = take[3];
        if (take[4]) input.fifth_reference_url = take[4];
      }
    } else {
      input[workflowMeta.imageField] = urls[0];
    }
  }
  return input;
}

async function queueWorkflow(workflowId, input) {
  const meta = WORKFLOWS[workflowId];
  if (!meta) throw new Error('Unknown workflow: ' + workflowId);
  const workspaceId = activeWorkspaceId();
  return api('/api/v2/workflow-executions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_id: workflowId,
      workspace_id: workspaceId,
      input
    })
  });
}

async function getExecution(executionId) {
  return api('/api/v2/workflow-executions/' + encodeURIComponent(executionId) + '?lean=true');
}

/** Best-effort cancel of a remote Answerly execution. Missing endpoints are ignored. */
async function cancelExecution(executionId) {
  if (!executionId) return { ok: false, skipped: true };
  const paths = [
    '/api/v2/workflow-executions/' + encodeURIComponent(executionId) + '/cancel',
    '/api/v2/workflow-executions/' + encodeURIComponent(executionId) + '/stop'
  ];
  let lastErr = null;
  for (let i = 0; i < paths.length; i++) {
    try {
      await api(paths[i], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      return { ok: true, path: paths[i] };
    } catch (err) {
      lastErr = err;
      // 404/405 → try next shape; other errors still try next then give up.
      if (err && (err.status === 404 || err.status === 405 || err.status === 501)) continue;
    }
  }
  return { ok: false, error: (lastErr && lastErr.message) || 'cancel unsupported' };
}

function pickResultUrl(execution) {
  const media =
    execution &&
    execution.output &&
    execution.output.final_output &&
    execution.output.final_output.media;
  if (!Array.isArray(media) || !media.length) return null;
  const edited = media.find((m) => /edit/i.test(m.label || '')) || media[media.length - 1];
  return edited && edited.url ? edited.url : null;
}

async function fetchResultBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to download result (' + res.status + ')');
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/png';
  return { buffer: buf, contentType };
}

module.exports = {
  BASE,
  DEFAULT_WORKSPACE,
  WORKFLOWS,
  FALLBACK_MODELS,
  tokenStatus,
  workspaceInfo,
  setToken,
  setTokenAndResolveWorkspace,
  clearToken,
  listWorkspaces,
  listModels,
  uploadImage,
  buildInput,
  queueWorkflow,
  getExecution,
  cancelExecution,
  pickResultUrl,
  fetchResultBytes
};
