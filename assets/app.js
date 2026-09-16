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

function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone || "-";
  return phone.slice(0, 3) + "****" + phone.slice(-4);
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
  const list = window.CANDIDATES_DATA.map((c) => ({ ...c }));
  list.forEach((c) => { c._searchIndex = buildSearchIndex(c); });
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
  }

  function renderRows(list) {
    tbody.innerHTML = list.map((c) => `
      <tr data-id="${c.id}">
        <td class="muted">${escapeHtml(c.acquiredDate)}</td>
        <td class="name-cell">${escapeHtml(c.name)}</td>
        <td><span class="tag ${sourceTagClass(c.source)}">${escapeHtml(c.source)}</span></td>
        <td class="muted">${escapeHtml(c.activityStatus)}</td>
        <td>${c.contactObtained
          ? '<span class="status-pill pill-yes">' + escapeHtml(maskPhone(c.phone)) + '</span>'
          : '<span class="status-pill pill-pending">待获取</span>'}</td>
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
    `).join("");

    tbody.querySelectorAll("tr").forEach((row) => {
      row.addEventListener("click", () => {
        window.location.href = "candidate.html?id=" + encodeURIComponent(row.dataset.id);
      });
    });
  }

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

  const contactBlock = c.contactObtained
    ? `<div class="value">${escapeHtml(maskPhone(c.phone))}<span class="mask-hint">（已隐藏部分号码）</span></div>`
    : `<div class="value"><span class="status-pill pill-pending">待获取</span><span class="mask-hint">需通过BOSS直聘自行联系</span></div>`;

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
