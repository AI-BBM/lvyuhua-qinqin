#!/usr/bin/env node
// Antigravity PreInvocation 钩子：每轮模型推理前检查 agent-teams 待读消息队列。
// - 子智能体（invoke_subagent）与 swarm worker：直接跳过，不注册会话、不注入队列提醒。
// - agy-manager 受控实例：由 agy-manager 通过 .system_generated/messages + stdin 100% 原生接管，直接跳过 Hook。
// - 交互式 Antigravity IDE 顶层会话：按 30s/会话限频查询 /wake/status，发现未读时注入队列提醒。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getOrClaimSession, getOrCreateWorkspaceId } = require('./session_registry.js');

const queueLibCandidates = [
  path.join(__dirname, 'queue_status.js'),
  path.join(__dirname, '..', '..', 'hooks', 'lib', 'queue_status.js'),
  'D:/agent-teams/hooks/lib/queue_status.js',
  'D:/agent-teams/.agents/scripts/queue_status.js',
  'C:/Users/hxx/.gemini/config/scripts/queue_status.js',
];
const queueLibPath = queueLibCandidates.find((p) => fs.existsSync(p)) || queueLibCandidates[1];
const queueLib = require(queueLibPath);

const {
  checkRateLimit,
  fetchWakeStatus,
  workspaceFromStatus,
  isSubagentSession,
  resolveManagedSession,
  formatMidTurnReminder,
} = queueLib;

const LOG_FILE = path.join(__dirname, 'hook_debug.log');
function logDebug(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [pre_invocation] ${msg}\n`, 'utf-8');
  } catch {}
}

function emitEmpty() {
  process.stdout.write('{}\n');
}

const EXE = process.env.AGENT_TEAMS_EXE
  || (fs.existsSync('D:/agent-teams/agent-teams.exe')
    ? 'D:\\agent-teams\\agent-teams.exe'
    : path.resolve(__dirname, '../../agent-teams.exe'));

(async () => {
  try {
    const raw = fs.readFileSync(0, 'utf-8');
    if (!raw || !raw.trim()) {
      emitEmpty();
      return;
    }

    const input = JSON.parse(raw);
    const convId = String(
      input.conversationId || input.conversation_id || input.sessionId || input.session_id || ''
    ).trim();
    const workspace = (input.workspacePaths && input.workspacePaths[0])
      || (input.workspace_roots && input.workspace_roots[0])
      || process.cwd();

    // 仅跳过纯离线批处理一次性任务目录，保留 agy-manager 受控实例进入 Hook 队列感知
    if (
      process.env.AGY_HEADLESS_BATCH === '1'
      || /[\\/]agy[\\/](collect|daily|publish|reply|build)([\\/]|$)/i.test(workspace)
    ) {
      emitEmpty();
      return;
    }

    // 子智能体（invoke_subagent）与 swarm worker 不触发 Hook
    if (isSubagentSession(input)) {
      logDebug(`subagent session skipped: conv=${convId}`);
      emitEmpty();
      return;
    }

    const managed = resolveManagedSession(convId);
    if (managed.isManaged) {
      logDebug(`managed session skipped (native agy-manager inbox): conv=${convId} me=${managed.agentId || ''}`);
      emitEmpty();
      return;
    }

    const wsId = getOrCreateWorkspaceId(workspace);
    const session = getOrClaimSession(convId, 'antigravity', 'gemini', wsId);
    let me = (process.env.AGENT_TEAMS_ID || session.id || '').trim();
    let effWs = session.workspace || wsId;
    const minIntervalMs = 30 * 1000;

    if (!me && !convId) {
      emitEmpty();
      return;
    }

    const safeKey = (convId || me || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    const stateDir = fs.existsSync('D:/agent-teams')
      ? 'D:/agent-teams/data'
      : path.join(os.tmpdir(), 'agent-teams-hooks');
    const stateFile = process.env.AGENT_TEAMS_QUEUE_STATE
      || path.join(stateDir, `inbox-check-agy-${safeKey}.state`);

    if (!checkRateLimit(stateFile, minIntervalMs)) {
      emitEmpty();
      return;
    }

    const res = await fetchWakeStatus({ me, ws: effWs, session: convId, timeoutMs: 3500 });
    if (!res.ok || !res.data) {
      emitEmpty();
      return;
    }

    if (!me && res.data.id) {
      me = String(res.data.id).trim();
    } else if (!process.env.AGENT_TEAMS_ID && res.data.id) {
      me = String(res.data.id).trim();
    }
    effWs = workspaceFromStatus(res.data, effWs);

    const pending = typeof res.data.pending_count === 'number' ? res.data.pending_count : 0;
    if (pending <= 0 || !me) {
      emitEmpty();
      return;
    }

    const sessionArg = convId ? ` --session ${convId}` : '';
    const exeCmd = `& "${EXE}" wake --id ${me} --ide antigravity${sessionArg}`;
    const message = formatMidTurnReminder(me, pending, 'antigravity', exeCmd);

    logDebug(`injecting mid-turn reminder: managed=${managed.isManaged} me=${me} pending=${pending} conv=${convId}`);
    process.stdout.write(JSON.stringify({
      injectSteps: [
        {
          systemMessage: {
            systemMessage: message,
          },
        },
      ],
    }) + '\n');
  } catch (err) {
    logDebug(`error: ${err && err.message ? err.message : String(err)}`);
    emitEmpty();
  }
})();
