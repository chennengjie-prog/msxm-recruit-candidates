const SOURCE_CLASS = {
  "BOSS直聘": "tag-boss",
  "猎聘": "tag-liepin",
  "智联招聘": "tag-zhilian",
};

function sourceTagClass(source) {
  return SOURCE_CLASS[source] || "tag-other";
}

function isPlaceholderName(name) {
  return /^[一-龥]{1,3}(先生|女士)$/.test(name || "");
}

// Contact numbers a recruiter types in via the "待获取" button on the list page
// are saved to this browser's localStorage only — the static site has no backend
// to write them back to data/candidates.js, so they don't sync to other people or
// devices until someone merges them into the real data file and pushes.
const CONTACT_OVERRIDE_KEY = "recruit_contact_overrides_v1";

function loadContactOverrides() {
  try {
    return JSON.parse(localStorage.getItem(CONTACT_OVERRIDE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveContactOverride(id, phone) {
  const all = loadContactOverrides();
  all[id] = { phone, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(CONTACT_OVERRIDE_KEY, JSON.stringify(all));
  } catch {
    // localStorage unavailable (private mode, etc.) — edit still shows for this
    // page view via the in-memory candidate object, just won't persist on reload.
  }
}

function clearContactOverride(id) {
  const all = loadContactOverrides();
  delete all[id];
  try {
    localStorage.setItem(CONTACT_OVERRIDE_KEY, JSON.stringify(all));
  } catch {}
}

// If set, edits are POSTed to <WORKER_BASE_URL>/<path> and committed straight
// into data/candidates.js on GitHub (see worker/index.js + SETUP-BACKEND.md),
// so they show up for every recruiter instead of staying stuck in one
// browser. Left blank until the Cloudflare Worker is deployed; until then
// every save silently falls back to the localStorage-only behavior below.
const WORKER_BASE_URL = "https://msxm-recruit-contact-sync.chennengjie.workers.dev";
const CONTACT_API_URL = WORKER_BASE_URL ? WORKER_BASE_URL + "/update-contact" : "";
const FEEDBACK_API_URL = WORKER_BASE_URL ? WORKER_BASE_URL + "/update-feedback" : "";

const TEAM_SECRET_KEY = "recruit_team_secret";
const EDITOR_NAME_KEY = "recruit_editor_name";

function getTeamSecret() {
  let v = localStorage.getItem(TEAM_SECRET_KEY);
  if (!v) {
    v = window.prompt("请输入团队口令（向管理员获取，只需输入一次，会记住在这台电脑上）") || "";
    if (v) localStorage.setItem(TEAM_SECRET_KEY, v);
  }
  return v;
}

function getEditorName() {
  let v = localStorage.getItem(EDITOR_NAME_KEY);
  if (!v) {
    v = window.prompt("请输入你的姓名（用于记录是谁录入的，只需输入一次）") || "";
    if (v) localStorage.setItem(EDITOR_NAME_KEY, v);
  }
  return v;
}

// Returns { synced: true } on success (written straight to GitHub, visible to
// everyone), or { synced: false, reason } if the backend isn't configured yet
// or the request failed — callers should fall back to the local-only save.
async function syncContactToGitHub(id, phone) {
  if (!CONTACT_API_URL) return { synced: false, reason: "未配置同步服务" };
  const secret = getTeamSecret();
  if (!secret) return { synced: false, reason: "未输入团队口令" };
  const editor = getEditorName();
  try {
    const res = await fetch(CONTACT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Team-Secret": secret },
      body: JSON.stringify({ id, phone, editor }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) return { synced: true };
    if (res.status === 401) {
      // Wrong/stale secret — clear it so the next attempt re-prompts.
      localStorage.removeItem(TEAM_SECRET_KEY);
    }
    return { synced: false, reason: data.error || ("请求失败（" + res.status + "）") };
  } catch (err) {
    return { synced: false, reason: "网络错误：" + err.message };
  }
}

// Same local-first pattern as the contact-number override above, but for the
// "联系完候选人后的反馈" pair of fields (when you talked to them + what they
// said). Kept as a separate localStorage key/override so it doesn't interfere
// with the phone-number editing state.
const FEEDBACK_OVERRIDE_KEY = "recruit_feedback_overrides_v1";

function loadFeedbackOverrides() {
  try {
    return JSON.parse(localStorage.getItem(FEEDBACK_OVERRIDE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveFeedbackOverride(id, date, feedback) {
  const all = loadFeedbackOverrides();
  all[id] = { date, feedback, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(FEEDBACK_OVERRIDE_KEY, JSON.stringify(all));
  } catch {}
}

function clearFeedbackOverride(id) {
  const all = loadFeedbackOverrides();
  delete all[id];
  try {
    localStorage.setItem(FEEDBACK_OVERRIDE_KEY, JSON.stringify(all));
  } catch {}
}

async function syncFeedbackToGitHub(id, date, feedback) {
  if (!FEEDBACK_API_URL) return { synced: false, reason: "未配置同步服务" };
  const secret = getTeamSecret();
  if (!secret) return { synced: false, reason: "未输入团队口令" };
  const editor = getEditorName();
  try {
    const res = await fetch(FEEDBACK_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Team-Secret": secret },
      body: JSON.stringify({ id, date, feedback, editor }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) return { synced: true };
    if (res.status === 401) localStorage.removeItem(TEAM_SECRET_KEY);
    return { synced: false, reason: data.error || ("请求失败（" + res.status + "）") };
  } catch (err) {
    return { synced: false, reason: "网络错误：" + err.message };
  }
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function buildSearchIndex(c) {
  const parts = [
    c.name, c.source, c.education, c.school, c.major,
    c.currentCompany, c.currentPosition, c.expectedPosition,
    c.location, c.status, c.jobSeekingStatus, c.email,
    c.resumeContact, c.activityStatus,
    c.lastContactDate, c.contactFeedback,
    c.hasSecQualification ? "证券从业资格证" : "",
    ...(c.certificates || []),
    c.selfEvaluation, c.notes,
    ...(c.workExperience || []).flatMap((w) => [w.company, w.position, w.description]),
    ...(c.educationExperience || []).flatMap((e) => [e.school, e.degree, e.major]),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

async function loadCandidates() {
  if (!Array.isArray(window.CANDIDATES_DATA)) {
    throw new Error("未找到候选人数据，请确认 data/candidates.js 已正确引入");
  }
  const overrides = loadContactOverrides();
  const feedbackOverrides = loadFeedbackOverrides();
  const list = window.CANDIDATES_DATA.map((c) => ({ ...c }));
  list.forEach((c) => {
    if (!c.contactObtained && overrides[c.id]) {
      c._localPhone = overrides[c.id].phone;
    }
    if (!c.contactFeedback && feedbackOverrides[c.id]) {
      c._localFeedbackDate = feedbackOverrides[c.id].date;
      c._localFeedback = feedbackOverrides[c.id].feedback;
    }
    c._searchIndex = buildSearchIndex(c);
  });
  return list;
}

// ---------- index page ----------

function initListPage() {
  const tbody = document.querySelector("#candidate-table tbody");
  const searchInput = document.querySelector("#search-input");
  const sourceChips = document.querySelectorAll(".filter-chip[data-source]");
  const contactChips = document.querySelectorAll(".filter-chip[data-contact]");
  const qualOnly = document.querySelector("#qual-only");
  const contactOnly = document.querySelector("#contact-only");
  const resultMeta = document.querySelector("#result-meta");
  const emptyState = document.querySelector("#empty-state");
  const table = document.querySelector("#candidate-table");
  const headers = document.querySelectorAll("th.sortable");

  let allCandidates = [];
  let activeSource = "all";
  let activeResumeContact = "all";
  let sortKey = "acquiredDate";
  let sortDir = "desc";
  let editingContactId = null;
  let editingFeedbackId = null;

  // Keeps the current search/filter/sort state reflected in the URL (via
  // replaceState, no new history entries) so that navigating to a candidate's
  // detail page and back restores the exact same filtered view instead of
  // dropping back to the full unfiltered list — see restoreStateFromUrl().
  function syncUrlFromState() {
    const params = new URLSearchParams();
    const q = searchInput.value.trim();
    if (q) params.set("q", q);
    if (activeSource !== "all") params.set("source", activeSource);
    if (activeResumeContact !== "all") params.set("contact", activeResumeContact);
    if (qualOnly.checked) params.set("qual", "1");
    if (contactOnly.checked) params.set("hascontact", "1");
    if (sortKey !== "acquiredDate") params.set("sort", sortKey);
    if (sortDir !== "desc") params.set("dir", sortDir);
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? "?" + qs : "");
    window.history.replaceState(null, "", newUrl);
  }

  function restoreStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) searchInput.value = q;

    const source = params.get("source");
    if (source) {
      const chip = document.querySelector(`.filter-chip[data-source="${CSS.escape(source)}"]`);
      if (chip) {
        activeSource = source;
        sourceChips.forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
      }
    }

    const contact = params.get("contact");
    if (contact) {
      const chip = document.querySelector(`.filter-chip[data-contact="${CSS.escape(contact)}"]`);
      if (chip) {
        activeResumeContact = contact;
        contactChips.forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
      }
    }

    if (params.get("qual") === "1") qualOnly.checked = true;
    if (params.get("hascontact") === "1") contactOnly.checked = true;

    const sort = params.get("sort");
    if (sort) sortKey = sort;
    const dir = params.get("dir");
    if (dir === "asc" || dir === "desc") sortDir = dir;
  }

  function applyAndRender() {
    const q = searchInput.value.trim().toLowerCase();

    let filtered = allCandidates.filter((c) => {
      const matchesSource = activeSource === "all" || c.source === activeSource;
      const matchesResumeContact = activeResumeContact === "all" || c.resumeContact === activeResumeContact;
      const matchesQuery = !q || c._searchIndex.includes(q);
      const matchesQual = !qualOnly.checked || c.hasSecQualification;
      const matchesContact = !contactOnly.checked || c.contactObtained;
      return matchesSource && matchesResumeContact && matchesQuery && matchesQual && matchesContact;
    });

    filtered.sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === "acquiredDate") {
        av = new Date(av).getTime();
        bv = new Date(bv).getTime();
      } else if (typeof av === "string") {
        av = av.toLowerCase();
        bv = (bv || "").toLowerCase();
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    renderRows(filtered);
    resultMeta.innerHTML = `共 <strong>${allCandidates.length}</strong> 位候选人，当前显示 <strong>${filtered.length}</strong> 位`;
    table.style.display = filtered.length ? "" : "none";
    emptyState.style.display = filtered.length ? "none" : "block";
    syncUrlFromState();
  }

  function contactCellHtml(c) {
    if (c.contactObtained) {
      return '<span class="status-pill pill-yes">' + escapeHtml(c.phone) + '</span>';
    }
    if (c.id === editingContactId) {
      return `
        <span class="contact-edit">
          <input type="text" class="contact-input" data-id="${c.id}" value="${escapeHtml(c._localPhone || "")}" placeholder="手机号">
          <button type="button" class="btn-mini contact-save" data-id="${c.id}">保存</button>
          <button type="button" class="btn-mini contact-cancel">取消</button>
        </span>`;
    }
    if (c._localPhone) {
      return `
        <span class="status-pill pill-yes contact-local" title="仅保存在你当前浏览器，尚未同步进 data/candidates.js">
          ${escapeHtml(c._localPhone)}
          <button type="button" class="contact-icon-btn contact-edit-btn" data-id="${c.id}" title="修改">✎</button>
          <button type="button" class="contact-icon-btn contact-clear-btn" data-id="${c.id}" title="清除本地记录">×</button>
        </span>`;
    }
    return `<button type="button" class="contact-btn" data-id="${c.id}">+ 录入联系方式</button>`;
  }

  // Renders the 联系时间/反馈内容 pair together (one edit toggle spans both
  // cells, since a single feedback entry always has both a date and a note).
  function feedbackCellsHtml(c) {
    const date = c.lastContactDate || c._localFeedbackDate || "";
    const feedback = c.contactFeedback || c._localFeedback || "";
    const isLocalOnly = !c.contactFeedback && (c._localFeedback || c._localFeedbackDate);

    if (c.id === editingFeedbackId) {
      return {
        dateCell: `<input type="date" class="feedback-date-input" data-id="${c.id}" value="${escapeHtml(date)}">`,
        feedbackCell: `
          <span class="feedback-edit">
            <input type="text" class="feedback-text-input" data-id="${c.id}" value="${escapeHtml(feedback)}" placeholder="简要反馈，如：已加微信，本周约面">
            <button type="button" class="btn-mini feedback-save" data-id="${c.id}">保存</button>
            <button type="button" class="btn-mini feedback-cancel">取消</button>
          </span>`,
      };
    }

    if (!date && !feedback) {
      return {
        dateCell: `<button type="button" class="contact-btn feedback-btn" data-id="${c.id}">+ 记录反馈</button>`,
        feedbackCell: `<span class="muted">-</span>`,
      };
    }

    const dateTitle = isLocalOnly ? ' title="仅保存在你当前浏览器，尚未同步进 data/candidates.js"' : "";
    const textTitle = feedback
      ? ` title="${escapeHtml(feedback)}${isLocalOnly ? "（仅保存在你当前浏览器，尚未同步）" : ""}"`
      : "";
    return {
      dateCell: `<span class="muted"${dateTitle}>${escapeHtml(date || "-")}</span>`,
      feedbackCell: `
        <span class="feedback-view${isLocalOnly ? " feedback-local" : ""}">
          <span class="feedback-text"${textTitle}>${escapeHtml(feedback || "-")}</span>
          <button type="button" class="contact-icon-btn feedback-edit-btn" data-id="${c.id}" title="修改">✎</button>
          ${isLocalOnly ? `<button type="button" class="contact-icon-btn feedback-clear-btn" data-id="${c.id}" title="清除本地记录">×</button>` : ""}
        </span>`,
    };
  }

  function renderRows(list) {
    tbody.innerHTML = list.map((c) => {
      const fb = feedbackCellsHtml(c);
      return `
      <tr data-id="${c.id}">
        <td class="muted">${escapeHtml(c.acquiredDate)}</td>
        <td class="name-cell">${escapeHtml(c.name)}</td>
        <td><span class="tag ${sourceTagClass(c.source)}">${escapeHtml(c.source)}</span></td>
        <td class="muted">${escapeHtml(c.activityStatus)}</td>
        <td class="contact-cell">${contactCellHtml(c)}</td>
        <td class="feedback-cell">${fb.dateCell}</td>
        <td class="feedback-cell">${fb.feedbackCell}</td>
        <td>${escapeHtml(c.education)}</td>
        <td>${c.hasSecQualification
          ? '<span class="status-pill pill-yes">有</span>'
          : '<span class="status-pill pill-no">无</span>'}</td>
        <td>${escapeHtml(c.school)}</td>
        <td>${escapeHtml(c.currentCompany)}</td>
        <td class="muted">${escapeHtml(c.currentPosition)}</td>
        <td>${c.yearsOfExperience != null ? c.yearsOfExperience + " 年" : "-"}</td>
        <td>${escapeHtml(c.expectedPosition)}</td>
        <td class="muted">${escapeHtml(c.location)}</td>
        <td><span class="status-pill">${escapeHtml(c.status || "-")}</span></td>
        <td>${escapeHtml(c.resumeContact)}</td>
      </tr>
    `;
    }).join("");

    tbody.querySelectorAll("tr").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".contact-cell") || e.target.closest(".feedback-cell")) return;
        window.location.href = "candidate.html?id=" + encodeURIComponent(row.dataset.id);
      });
    });

    if (editingContactId) {
      const input = tbody.querySelector(`.contact-input[data-id="${editingContactId}"]`);
      if (input) {
        input.focus();
        input.select();
      }
    }
    if (editingFeedbackId) {
      const input = tbody.querySelector(`.feedback-text-input[data-id="${editingFeedbackId}"]`);
      if (input) {
        input.focus();
        input.select();
      }
    }
  }

  // Saves immediately to this browser's localStorage (so nothing is lost even
  // if the network request fails), then tries to sync straight to GitHub in
  // the background so every recruiter sees it, not just this one. Renders
  // once optimistically and again once the sync attempt resolves.
  async function saveContactEdit(id) {
    const input = tbody.querySelector(`.contact-input[data-id="${id}"]`);
    const value = input ? input.value.trim() : "";
    if (editingContactId === id) editingContactId = null;
    if (!value) return;

    saveContactOverride(id, value);
    const c = allCandidates.find((item) => item.id === id);
    if (c) c._localPhone = value;
    applyAndRender();

    const result = await syncContactToGitHub(id, value);
    if (result.synced) {
      clearContactOverride(id);
      if (c) {
        c.phone = value;
        c.contactObtained = true;
        delete c._localPhone;
      }
    } else if (CONTACT_API_URL) {
      window.alert(
        "联系方式已保存在这台电脑上，但同步到共享数据失败：" + result.reason +
        "\n（其他人暂时还看不到，请稍后重试一次，或联系管理员手动更新）"
      );
    }
    applyAndRender();
  }

  // Mirrors saveContactEdit above: local-first save, background sync to
  // GitHub if configured, falls back silently to local-only otherwise.
  async function saveFeedbackEdit(id) {
    const dateInput = tbody.querySelector(`.feedback-date-input[data-id="${id}"]`);
    const textInput = tbody.querySelector(`.feedback-text-input[data-id="${id}"]`);
    const date = dateInput ? dateInput.value.trim() : "";
    const feedback = textInput ? textInput.value.trim() : "";
    if (editingFeedbackId === id) editingFeedbackId = null;
    if (!date && !feedback) return;

    saveFeedbackOverride(id, date, feedback);
    const c = allCandidates.find((item) => item.id === id);
    if (c) {
      c._localFeedbackDate = date;
      c._localFeedback = feedback;
    }
    applyAndRender();

    const result = await syncFeedbackToGitHub(id, date, feedback);
    if (result.synced) {
      clearFeedbackOverride(id);
      if (c) {
        c.lastContactDate = date;
        c.contactFeedback = feedback;
        delete c._localFeedbackDate;
        delete c._localFeedback;
      }
    } else if (FEEDBACK_API_URL) {
      window.alert(
        "反馈已保存在这台电脑上，但同步到共享数据失败：" + result.reason +
        "\n（其他人暂时还看不到，请稍后重试一次，或联系管理员手动更新）"
      );
    }
    applyAndRender();
  }

  // If another row's edit box is still open with unsaved typed text, any
  // full re-render (opening/clearing a *different* row) would otherwise wipe
  // it silently. Auto-save it first instead of discarding what was typed.
  function flushPendingEditExcept(exceptId) {
    if (editingContactId && editingContactId !== exceptId) {
      saveContactEdit(editingContactId);
    }
    if (editingFeedbackId && editingFeedbackId !== exceptId) {
      saveFeedbackEdit(editingFeedbackId);
    }
  }

  // Delegated once on tbody (which persists across re-renders — only its
  // innerHTML is replaced) so these handlers keep working after every render.
  tbody.addEventListener("click", (e) => {
    // Feedback-button checks come first: the "+ 记录反馈" button also carries
    // the generic .contact-btn class for shared styling, so it would
    // otherwise match the .contact-btn check below too.
    const fbAddBtn = e.target.closest(".feedback-btn");
    if (fbAddBtn) {
      flushPendingEditExcept(fbAddBtn.dataset.id);
      editingFeedbackId = fbAddBtn.dataset.id;
      applyAndRender();
      return;
    }
    const fbEditBtn = e.target.closest(".feedback-edit-btn");
    if (fbEditBtn) {
      flushPendingEditExcept(fbEditBtn.dataset.id);
      editingFeedbackId = fbEditBtn.dataset.id;
      applyAndRender();
      return;
    }
    const fbClearBtn = e.target.closest(".feedback-clear-btn");
    if (fbClearBtn) {
      flushPendingEditExcept(fbClearBtn.dataset.id);
      clearFeedbackOverride(fbClearBtn.dataset.id);
      const c = allCandidates.find((item) => item.id === fbClearBtn.dataset.id);
      if (c) {
        delete c._localFeedbackDate;
        delete c._localFeedback;
      }
      applyAndRender();
      return;
    }
    const fbSaveBtn = e.target.closest(".feedback-save");
    if (fbSaveBtn) {
      saveFeedbackEdit(fbSaveBtn.dataset.id);
      return;
    }
    const fbCancelBtn = e.target.closest(".feedback-cancel");
    if (fbCancelBtn) {
      editingFeedbackId = null;
      applyAndRender();
      return;
    }

    const addBtn = e.target.closest(".contact-btn");
    if (addBtn) {
      flushPendingEditExcept(addBtn.dataset.id);
      editingContactId = addBtn.dataset.id;
      applyAndRender();
      return;
    }
    const editBtn = e.target.closest(".contact-edit-btn");
    if (editBtn) {
      flushPendingEditExcept(editBtn.dataset.id);
      editingContactId = editBtn.dataset.id;
      applyAndRender();
      return;
    }
    const clearBtn = e.target.closest(".contact-clear-btn");
    if (clearBtn) {
      flushPendingEditExcept(clearBtn.dataset.id);
      clearContactOverride(clearBtn.dataset.id);
      const c = allCandidates.find((item) => item.id === clearBtn.dataset.id);
      if (c) delete c._localPhone;
      applyAndRender();
      return;
    }
    const saveBtn = e.target.closest(".contact-save");
    if (saveBtn) {
      saveContactEdit(saveBtn.dataset.id);
      return;
    }
    const cancelBtn = e.target.closest(".contact-cancel");
    if (cancelBtn) {
      editingContactId = null;
      applyAndRender();
    }
  });

  tbody.addEventListener("keydown", (e) => {
    const isContactInput = e.target.classList.contains("contact-input");
    const isFeedbackInput = e.target.classList.contains("feedback-text-input") || e.target.classList.contains("feedback-date-input");
    if (!isContactInput && !isFeedbackInput) return;
    if (e.key === "Enter" || e.keyCode === 13 || e.which === 13) {
      e.preventDefault();
      if (isContactInput) saveContactEdit(e.target.dataset.id);
      else saveFeedbackEdit(e.target.dataset.id);
    } else if (e.key === "Escape" || e.keyCode === 27 || e.which === 27) {
      if (isContactInput) editingContactId = null;
      else editingFeedbackId = null;
      applyAndRender();
    }
  });

  function updateSortHeaders() {
    headers.forEach((th) => {
      th.classList.toggle("sort-active", th.dataset.sortKey === sortKey);
      const arrow = th.querySelector(".arrow");
      if (arrow) arrow.textContent = th.dataset.sortKey === sortKey ? (sortDir === "asc" ? "▲" : "▼") : "▼";
    });
  }

  headers.forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sortKey;
      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = key;
        sortDir = key === "acquiredDate" ? "desc" : "asc";
      }
      updateSortHeaders();
      applyAndRender();
    });
  });

  sourceChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      sourceChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeSource = chip.dataset.source;
      applyAndRender();
    });
  });

  contactChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      contactChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeResumeContact = chip.dataset.contact;
      applyAndRender();
    });
  });

  searchInput.addEventListener("input", applyAndRender);
  qualOnly.addEventListener("change", applyAndRender);
  contactOnly.addEventListener("change", applyAndRender);

  restoreStateFromUrl();
  loadCandidates()
    .then((list) => {
      allCandidates = list;
      updateSortHeaders();
      applyAndRender();
    })
    .catch((err) => {
      resultMeta.textContent = "数据加载失败：" + err.message;
      emptyState.style.display = "block";
      emptyState.textContent = "无法加载候选人数据，请检查 data/candidates.json 是否存在。";
    });
}

// ---------- detail page ----------

function initDetailPage() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const container = document.querySelector("#detail-container");

  // If we arrived here from the list page, its URL (captured via
  // document.referrer) carries whatever search/filter state was active —
  // send "back" there instead of a bare index.html so a filtered view (e.g.
  // searching "兴业银行") isn't lost when the recruiter clicks back. The list
  // page is normally reached via the bare directory URL (.../repo-name/,
  // no filename — that's the link everyone actually uses), which GitHub
  // Pages serves as index.html but whose pathname has no "index.html" in
  // it, so this must accept an empty last path segment too, not just an
  // explicit "index.html" — matching only the latter was the original bug.
  const backLink = document.querySelector(".detail-back");
  if (backLink && document.referrer) {
    try {
      const ref = new URL(document.referrer);
      const lastSegment = ref.pathname.split("/").pop();
      if (ref.origin === window.location.origin && (lastSegment === "" || lastSegment === "index.html")) {
        backLink.href = ref.pathname + ref.search;
      }
    } catch {}
  }

  loadCandidates()
    .then((list) => {
      const c = list.find((item) => item.id === id);
      if (!c) {
        container.innerHTML = `<div class="card empty-state">未找到该候选人（id=${escapeHtml(id)}），可能已被移除。</div>`;
        return;
      }
      document.title = c.name + " - 候选人详情";
      container.innerHTML = renderDetail(c);
    })
    .catch((err) => {
      container.innerHTML = `<div class="card empty-state">数据加载失败：${escapeHtml(err.message)}</div>`;
    });
}

function renderDetail(c) {
  const initial = (c.name || "?").slice(0, 1);
  const certs = (c.certificates || []).map((cert) => `<span class="cert">${escapeHtml(cert)}</span>`).join("");
  const workItems = (c.workExperience || []).map((w) => `
    <div class="timeline-item">
      <div class="t-title">${escapeHtml(w.company)} · ${escapeHtml(w.position)}</div>
      <div class="t-period">${escapeHtml(w.period)}</div>
      <div class="t-desc">${escapeHtml(w.description)}</div>
    </div>
  `).join("") || `<div class="empty-state">暂无工作经历记录</div>`;

  const eduItems = (c.educationExperience || []).map((e) => `
    <div class="timeline-item">
      <div class="t-title">${escapeHtml(e.school)} · ${escapeHtml(e.degree)}${e.major ? " / " + escapeHtml(e.major) : ""}</div>
      <div class="t-period">${escapeHtml(e.period)}</div>
    </div>
  `).join("") || `<div class="empty-state">暂无教育经历记录</div>`;

  let contactBlock;
  if (c.contactObtained) {
    contactBlock = `<div class="value">${escapeHtml(c.phone)}</div>`;
  } else if (c._localPhone) {
    contactBlock = `<div class="value">${escapeHtml(c._localPhone)}<span class="mask-hint">（本地录入，仅你当前浏览器可见，尚未同步进数据文件）</span></div>`;
  } else {
    contactBlock = `<div class="value"><span class="status-pill pill-pending">待获取</span><span class="mask-hint">需通过BOSS直聘自行联系，可在列表页点"+ 录入联系方式"记录</span></div>`;
  }

  return `
    <div class="detail-grid">
      <div>
        <div class="card">
          <div class="profile-header">
            <div class="avatar-circle">${escapeHtml(initial)}</div>
            <div>
              <div class="name">${escapeHtml(c.name)}${isPlaceholderName(c.name) ? '<span class="mask-hint">（平台展示称呼，非真实姓名）</span>' : ""}</div>
              <div class="meta-line">${escapeHtml(c.gender || "")}${c.age ? " · " + c.age + "岁" : ""}${c.location ? " · " + escapeHtml(c.location) : ""}</div>
            </div>
          </div>
          <div class="info-list">
            <div class="item"><label>简历来源</label><div class="value"><span class="tag ${sourceTagClass(c.source)}">${escapeHtml(c.source)}</span></div></div>
            <div class="item"><label>获取时间</label><div class="value">${escapeHtml(c.acquiredDate)}</div></div>
            <div class="item"><label>简历联系人</label><div class="value">${escapeHtml(c.resumeContact) || "-"}</div></div>
            <div class="item"><label>活跃状态</label><div class="value">${escapeHtml(c.activityStatus) || "-"}</div></div>
            <div class="item"><label>联系电话</label>${contactBlock}</div>
            ${c.email ? `<div class="item"><label>邮箱</label><div class="value">${escapeHtml(c.email)}</div></div>` : ""}
            ${c.jobSeekingStatus ? `<div class="item"><label>求职状态</label><div class="value">${escapeHtml(c.jobSeekingStatus)}</div></div>` : ""}
            <div class="item"><label>跟进状态</label><div class="value"><span class="status-pill">${escapeHtml(c.status || "-")}</span></div></div>
            <div class="item"><label>联系时间</label><div class="value">${escapeHtml(c.lastContactDate || c._localFeedbackDate) || "-"}</div></div>
            <div class="item"><label>证券从业资格证</label><div class="value">${c.hasSecQualification ? '<span class="status-pill pill-yes">有</span>' : '<span class="status-pill pill-no">无</span>'}</div></div>
            <div class="item"><label>学历</label><div class="value">${escapeHtml(c.education)}</div></div>
            <div class="item"><label>毕业院校</label><div class="value">${escapeHtml(c.school)}</div></div>
            <div class="item"><label>专业</label><div class="value">${escapeHtml(c.major)}</div></div>
            <div class="item"><label>工作年限</label><div class="value">${c.yearsOfExperience != null ? c.yearsOfExperience + " 年" : "-"}</div></div>
            <div class="item"><label>目前/最近单位</label><div class="value">${escapeHtml(c.currentCompany)}</div></div>
            <div class="item"><label>目前/最近职位</label><div class="value">${escapeHtml(c.currentPosition)}</div></div>
            <div class="item"><label>意向职位</label><div class="value">${escapeHtml(c.expectedPosition)}</div></div>
            <div class="item"><label>期望薪资</label><div class="value">${escapeHtml(c.expectedSalary)}</div></div>
          </div>
        </div>
        <div class="card">
          <h2>资格证书</h2>
          <div class="tag-list">${certs || '<span class="empty-state">暂无</span>'}</div>
        </div>
        <div class="card">
          <h2>沟通反馈</h2>
          <div class="note-box">${escapeHtml(c.contactFeedback || c._localFeedback) || "暂无反馈记录"}</div>
        </div>
        <div class="card">
          <h2>招聘备注</h2>
          <div class="note-box">${escapeHtml(c.notes || "暂无备注")}</div>
        </div>
      </div>
      <div>
        <div class="card">
          <h2>工作经历</h2>
          <div class="timeline">${workItems}</div>
        </div>
        <div class="card">
          <h2>教育经历</h2>
          <div class="timeline">${eduItems}</div>
        </div>
        <div class="card">
          <h2>自我评价</h2>
          <p style="font-size:13.5px; color:var(--color-text-muted); margin:0;">${escapeHtml(c.selfEvaluation || "暂无")}</p>
        </div>
      </div>
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "list") initListPage();
  if (page === "detail") initDetailPage();
});
