const fs = require('fs');
const path = require('path');

// 注册表持久化在 data/sessions.json（已被 .gitignore 忽略）
const REGISTRY_FILE = process.env.AGENT_TEAMS_SESSIONS_FILE ||
  (fs.existsSync(path.join('D:/agent-teams', 'data', 'sessions.json'))
    ? path.join('D:/agent-teams', 'data', 'sessions.json')
    : path.join(__dirname, '..', '..', 'data', 'sessions.json'));

/**
 * 读取本地会话注册表
 */
function loadRegistry() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      const content = fs.readFileSync(REGISTRY_FILE, 'utf-8');
      if (content && content.trim()) {
        return JSON.parse(content);
      }
    }
  } catch (err) {
    // 读取异常时安全降级
  }
  return { conversations: {} };
}

/**
 * 保存会话注册表
 */
function saveRegistry(reg) {
  try {
    const dir = path.dirname(REGISTRY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // 先写临时文件再 rename 或直接写入
    const tmpFile = `${REGISTRY_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpFile, JSON.stringify(reg, null, 2), 'utf-8');
    fs.renameSync(tmpFile, REGISTRY_FILE);
  } catch (err) {
    // 降级直接写原文件
    try {
      fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2), 'utf-8');
    } catch {}
  }
}

/**
 * 获取或申请会话的编号与 ID
 * 核心保证：会话不变编号不变（以 conversationId 为准）
 *
 * @param {string} conversationId 当前会话系统ID
 * @param {string} [ide='antigravity'] IDE标识
 * @param {string} [name='gemini'] 角色/模型名
 * @returns {{ num: number, id: string, ide: string, name: string, isNew: boolean }}
 */
function getOrClaimSession(conversationId, ide = 'antigravity', name = 'gemini', workspace) {
  ide = (ide || 'antigravity').toLowerCase().trim();
  name = (name || 'gemini').toLowerCase().trim();
  if (workspace) workspace = String(workspace).trim();

  // 若无 conversationId（极端异常），降级默认 1
  if (!conversationId || typeof conversationId !== 'string') {
    return {
      num: 1,
      id: `${ide}-${name}-1`,
      ide,
      name,
      workspace: workspace || '',
      isNew: false
    };
  }

  conversationId = conversationId.trim();
  const reg = loadRegistry();
  if (!reg.conversations) {
    reg.conversations = {};
  }

  const now = new Date().toISOString();

  // 1. 若会话已存在：复用原有编号（会话不变编号不变）
  if (reg.conversations[conversationId]) {
    const item = reg.conversations[conversationId];
    item.lastSeen = now;
    // 首认领定死（issue-IKKGWF）：已存在条目只刷新 lastSeen，不再用本次
    // 调用的 ide/name/workspace 覆盖——跨目录值守会话的钩子每回合以 cwd
    // 派生值重复调用，覆盖会把注册行翻转进错误项目
    saveRegistry(reg);
    return {
      num: item.num,
      id: item.id,
      ide: item.ide,
      name: item.name,
      workspace: item.workspace || '',
      isNew: false
    };
  }

  // 2. 新会话：扫描该 ide + name 下已占用的编号
  const usedNums = new Set();
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  for (const [cid, item] of Object.entries(reg.conversations)) {
    if (item.ide === ide && item.name === name && typeof item.num === 'number') {
      const lastMs = item.lastSeen ? new Date(item.lastSeen).getTime() : 0;
      // 超过 7 天未活动的旧会话释放其编号，避免编号无限膨胀
      if (nowMs - lastMs < ONE_WEEK_MS) {
        usedNums.add(item.num);
      } else {
        delete reg.conversations[cid];
      }
    }
  }

  // 分配最小未被占用的正整数编号（1, 2, 3...）
  let num = 1;
  while (usedNums.has(num)) {
    num++;
  }

  const id = `${ide}-${name}-${num}`;
  const entry = {
    num,
    id,
    ide,
    name,
    firstSeen: now,
    lastSeen: now
  };
  if (workspace) entry.workspace = workspace;
  reg.conversations[conversationId] = entry;

  saveRegistry(reg);
  return {
    num,
    id,
    ide,
    name,
    workspace: workspace || '',
    isNew: true
  };
}

/**
 * 从工作区目录读取或生成 workspace ID：
 * 1. 优先读取 <workspace>/.project-id
 * 2. 其次读取 <workspace>/.agent-workspace
 * 3. 再次读取 <workspace>/.agents/project.json
 * 4. 如果文件不存在或为空：根据目录名自动生成干净 slug，并写入 .project-id
 * 确保多台电脑打开同一项目时 workspace ID 绝对一致！
 */
function getOrCreateWorkspaceId(workspace) {
  if (!workspace) return 'default';
  const f1 = path.join(workspace, '.project-id');
  try {
    if (fs.existsSync(f1)) {
      const s = fs.readFileSync(f1, 'utf-8').trim();
      if (s) return s;
    }
  } catch {}

  const f2 = path.join(workspace, '.agent-workspace');
  try {
    if (fs.existsSync(f2)) {
      const s = fs.readFileSync(f2, 'utf-8').trim();
      if (s) return s;
    }
  } catch {}

  const f3 = path.join(workspace, '.agents', 'project.json');
  try {
    if (fs.existsSync(f3)) {
      const p = JSON.parse(fs.readFileSync(f3, 'utf-8'));
      if (p && p.id && String(p.id).trim()) return String(p.id).trim();
    }
  } catch {}

  // 为空或不存在，根据目录名自动生成
  const base = path.basename(path.resolve(workspace)) || 'project';
  const clean = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';

  try {
    fs.writeFileSync(f1, `${clean}\n`, 'utf-8');
  } catch {}
  return clean;
}

function detectProjectId(workspace) {
  return getOrCreateWorkspaceId(workspace);
}

// 供命令行直接调用测试与查询
if (require.main === module) {
  const args = process.argv.slice(2);
  const cid = args[0] || process.env.CONVERSATION_ID || 'test-default';
  const ide = args[1] || 'antigravity';
  const name = args[2] || 'gemini';
  const workspace = args[3] || process.env.AGENT_TEAMS_WORKSPACE || '';

  const res = getOrClaimSession(cid, ide, name, workspace);
  console.log(JSON.stringify(res, null, 2));
}

/**
 * 把服务端分配的真实 id 写回会话注册表条目（取代本地 claim 的临时编号）。
 * @returns {boolean} 是否发生写回（条目不存在或 id 未变返回 false）
 */
function updateSessionId(conversationId, newId) {
  if (!conversationId || !newId) return false;
  const reg = loadRegistry();
  const entry = reg.conversations && reg.conversations[conversationId];
  if (!entry || entry.id === newId) return false;
  entry.id = newId;
  entry.lastSeen = new Date().toISOString();
  saveRegistry(reg);
  return true;
}

module.exports = {
  getOrClaimSession,
  updateSessionId,
  getOrCreateWorkspaceId,
  detectProjectId,
  loadRegistry,
  REGISTRY_FILE
};

