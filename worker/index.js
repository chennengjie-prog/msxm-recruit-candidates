// Cloudflare Worker: receives candidate contact info / follow-up feedback
// from the site's inline "+" buttons and commits it straight into
// data/candidates.js on GitHub, so it shows up for every recruiter instead
// of staying stuck in one person's browser (see README.md for why the site
// alone can't do this).
//
// Deploy notes live in ../SETUP-BACKEND.md. This file has no secrets in it —
// GITHUB_TOKEN and TEAM_SECRET are injected as Cloudflare Worker secrets at
// runtime, never committed to the repo.

const REPO = "chennengjie-prog/msxm-recruit-candidates";
const FILE_PATH = "data/candidates.js";
const ALLOWED_ORIGIN = "https://chennengjie-prog.github.io";
const PHONE_RE = /^1[3-9]\d{9}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Team-Secret",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
  });
}

function b64ToUtf8(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

async function githubRequest(path, env, options = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "msxm-recruit-candidates-worker",
      ...(options.headers || {}),
    },
  });
}

// Fetches data/candidates.js, hands the matching candidate object to
// `mutate` to edit in place, and commits the result back. `mutate` returns
// the commit message, or throws {status, message} to abort without writing
// (e.g. candidate not found, or a guard condition like "already has a
// phone number"). On a concurrent-edit conflict (someone else committed in
// between our read and write) it retries once against fresh data.
async function updateCandidateFile(id, mutate, env) {
  const getRes = await githubRequest(`/repos/${REPO}/contents/${FILE_PATH}`, env);
  if (!getRes.ok) throw new Error("读取 GitHub 上的数据文件失败（状态码 " + getRes.status + "）");
  const file = await getRes.json();
  const content = b64ToUtf8(file.content);

  const match = content.match(/(window\.CANDIDATES_DATA\s*=\s*)(\[[\s\S]*\])(;?\s*)$/);
  if (!match) throw new Error("数据文件格式异常，未找到 CANDIDATES_DATA 数组");

  let list;
  try {
    list = JSON.parse(match[2]);
  } catch {
    throw new Error("数据文件解析失败（不是合法 JSON）");
  }

  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) throw { status: 404, message: "未找到编号为 " + id + " 的候选人" };

  const commitMessage = mutate(list[idx]);

  const newContent = content.slice(0, match.index) + match[1] + JSON.stringify(list, null, 2) + ";\n";

  const putRes = await githubRequest(`/repos/${REPO}/contents/${FILE_PATH}`, env, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: commitMessage, content: utf8ToB64(newContent), sha: file.sha }),
  });

  if (putRes.status === 409) {
    // Someone else committed in between our GET and PUT — safe to retry once
    // against a fresh copy (mutate only ever sets fields from its own
    // closure variables, never from prior state, so re-running it is safe).
    return updateCandidateFile(id, mutate, env);
  }
  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error("写入 GitHub 失败（状态码 " + putRes.status + "）：" + errText.slice(0, 300));
  }
  return list[idx].name;
}

async function updateContact(id, phone, editor, env) {
  const who = editor || "网页录入";
  return updateCandidateFile(id, (c) => {
    if (c.contactObtained && c.phone) {
      throw { status: 409, message: "该候选人已经登记过联系方式了，如需修改请联系管理员直接改数据文件" };
    }
    const today = new Date().toISOString().slice(0, 10);
    c.phone = phone;
    c.contactObtained = true;
    c.contactEnteredBy = who;
    c.notes = ((c.notes || "").trim() + ` [${today} 由${who}通过网页录入联系方式]`).trim();
    return `录入联系方式：${c.name}（${id}），由${who}通过网页提交`;
  }, env);
}

async function updateFeedback(id, date, feedback, editor, env) {
  const who = editor || "网页录入";
  return updateCandidateFile(id, (c) => {
    c.lastContactDate = date;
    c.contactFeedback = feedback;
    c.feedbackEnteredBy = who;
    return `记录沟通反馈：${c.name}（${id}），由${who}通过网页提交`;
  }, env);
}

async function handleUpdateContact(body, env) {
  const id = String(body.id || "").trim();
  const phone = String(body.phone || "").trim();
  const editor = String(body.editor || "").trim().slice(0, 20);
  if (!id) return json({ error: "缺少候选人编号" }, 400);
  if (!PHONE_RE.test(phone)) return json({ error: "手机号格式不正确，请输入11位手机号" }, 400);

  try {
    const name = await updateContact(id, phone, editor, env);
    return json({ ok: true, name });
  } catch (err) {
    if (err && err.status) return json({ error: err.message }, err.status);
    return json({ error: (err && err.message) || "服务器内部错误" }, 500);
  }
}

async function handleUpdateFeedback(body, env) {
  const id = String(body.id || "").trim();
  const date = String(body.date || "").trim();
  const feedback = String(body.feedback || "").trim().slice(0, 500);
  const editor = String(body.editor || "").trim().slice(0, 20);
  if (!id) return json({ error: "缺少候选人编号" }, 400);
  if (date && !DATE_RE.test(date)) return json({ error: "日期格式不正确" }, 400);
  if (!date && !feedback) return json({ error: "联系时间和反馈内容至少填一个" }, 400);

  try {
    const name = await updateFeedback(id, date, feedback, editor, env);
    return json({ ok: true, name });
  } catch (err) {
    if (err && err.status) return json({ error: err.message }, err.status);
    return json({ error: (err && err.message) || "服务器内部错误" }, 500);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return json({ error: "只接受 POST 请求" }, 405);
    }

    if ((request.headers.get("X-Team-Secret") || "") !== env.TEAM_SECRET) {
      return json({ error: "口令不正确，请向管理员确认" }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "请求格式错误" }, 400);
    }

    const url = new URL(request.url);
    if (url.pathname === "/update-contact") return handleUpdateContact(body, env);
    if (url.pathname === "/update-feedback") return handleUpdateFeedback(body, env);
    return json({ error: "接口不存在" }, 404);
  },
};
