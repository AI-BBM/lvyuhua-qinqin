#!/usr/bin/env node
// Antigravity Stop 钩子：收尾队列感知 + 待机唤醒保障。
// - 子智能体（invoke_subagent）与 swarm worker：直接跳过，不注册会话、不拦截 Stop。
// - agy-manager 受控实例：由 agy-manager 通过 .system_generated/messages + stdin 100% 原生接管，直接返回 {} 放行。
// - 交互式 Antigravity IDE 顶层会话：检查 wait_connected 与 pending_count，断连时提醒后台启动 agent-teams.exe wake。
const fs = require('node:fs');
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
  fetchWakeStatus,
  workspaceFromStatus,
  isSubagentSession,
  resolveManagedSession,
  formatStopNudge,
  formatStopRemind,
} = queueLib;

const LOG_FILE = path.join(__dirname, 'hook_debug.log');
function logDebug(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [stop_guard] ${msg}\n`, 'utf-8');
  } catch {}
}

function emitJson(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

const EXE = process.env.AGENT_TEAMS_EXE
  || (fs.existsSync('D:/agent-teams/agent-teams.exe')
    ? 'D:\\agent-teams\\agent-teams.exe'
    : path.resolve(__dirname, '../../agent-teams.exe'));

(async () => {
  try {
    const raw = fs.readFileSync(0, 'utf-8');
    if (!raw || !raw.trim()) {
      emitJson({});
      return;
    }

    const input = JSON.parse(raw);
    const validNormalStops = new Set(['model_stop', 'MODEL_STOP', 'NO_TOOL_CALL', 'STOP', 'END_TURN', '']);
    if (input.terminationReason && !validNormalStops.has(input.terminationReason)) {
      logDebug(`abnormal terminationReason=${input.terminationReason} -> pass`);
      emitJson({});
      return;
    }

    const workspace = (input.workspacePaths && input.workspacePaths[0])
      || (input.workspace_roots && input.workspace_roots[0])
      || process.cwd();

    if (
      process.env.AGY_HEADLESS_BATCH === '1'
      || /[\\/]agy[\\/](collect|daily|publish|reply|build)([\\/]|$)/i.test(workspace)
    ) {
      emitJson({});
      return;
    }

    const convId = String(input.conversationId || input.conversation_id || '').trim();

    // 子智能体（invoke_subagent）与 swarm worker 不触发 Hook
    if (isSubagentSession(input)) {
      logDebug(`subagent session skipped: conv=${convId}`);
      emitJson({});
      return;
    }

    const managed = resolveManagedSession(convId);

    // 1. agy-manager 受控实例：由 agy-manager 通过 .system_generated/messages + stdin 100% 原生接管，彻底跳过 Hook
    if (managed.isManaged) {
      logDebug(`managed session skipped (native agy-manager inbox): conv=${convId} me=${managed.agentId || ''}`);
      emitJson({});
      return;
    }

    // 2. 交互式 Antigravity IDE 会话：最多拦截 2 次，保障后台长连接与未读清零
    if (input.executionNum && input.executionNum > 2) {
      emitJson({});
      return;
    }

    const wsId = getOrCreateWorkspaceId(workspace);
    const session = getOrClaimSession(convId, 'antigravity', 'gemini', wsId);
    let targetId = (process.env.AGENT_TEAMS_ID || session.id || '').trim();
    let effWs = session.workspace || wsId;
    const sessionParam = convId ? ` --session ${convId}` : '';

    const res = await fetchWakeStatus({ me: targetId, ws: effWs, session: convId, timeoutMs: 4000 });
    if (!res.ok) {
      if (res.status === 404) {
        const initCmd = `& "${EXE}" wake --model gemini --ide antigravity${sessionParam}`;
        emitJson({
          decision: 'continue',
          reason: formatStopRemind(targetId, 0, 'antigravity', initCmd),
        });
        return;
      }
      emitJson({});
      return;
    }

    const st = res.data || {};
    if (!process.env.AGENT_TEAMS_ID && st.id) {
      targetId = String(st.id).trim();
    }
    effWs = workspaceFromStatus(st, effWs);
    const pending = (typeof st.pending_count === 'number' && st.pending_count > 0) ? st.pending_count : 0;
    const exeCmd = `& "${EXE}" wake --id ${targetId} --ide antigravity${sessionParam}`;

    if (st.wait_connected) {
      if (pending > 0) {
        emitJson({
          decision: 'continue',
          reason: formatStopNudge(targetId, pending, 'antigravity', exeCmd),
        });
        return;
      }
      emitJson({});
      return;
    }

    emitJson({
      decision: 'continue',
      reason: formatStopRemind(targetId, pending, 'antigravity', exeCmd),
    });
  } catch (err) {
    logDebug(`unexpected error: ${err && err.message ? err.message : String(err)}`);
    emitJson({});
  }
})();
