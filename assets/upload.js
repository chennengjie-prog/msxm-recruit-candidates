const KNOWN_CERTS = [
  "证券从业资格证", "证券投资顾问", "证券投资咨询从业资格证", "基金从业资格证",
  "期货从业资格证", "银行从业资格证", "保险从业资格证", "会计从业资格证",
  "全国黄金交易从业水平考试合格证", "CFA一级", "CFA二级", "CFA三级", "CFA",
  "CPA", "AFP", "CFP", "驾驶证C1", "大学英语四级", "大学英语六级", "计算机二级", "健康证",
];

const SEC_QUALIFICATION_PATTERNS = ["证券从业资格证", "证券从业资格", "证券业从业资格"];

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nextCandidateId() {
  const existing = Array.isArray(window.CANDIDATES_DATA) ? window.CANDIDATES_DATA : [];
  let maxN = 0;
  existing.forEach((c) => {
    const m = /^c(\d+)$/.exec(c.id || "");
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  });
  return "c" + String(maxN + 1).padStart(3, "0");
}

function extractHeuristics(rawText) {
  // OCR output often inserts stray spaces between CJK characters, which breaks
  // exact substring/keyword matching. Match against a whitespace-stripped copy;
  // digits/letters (phone, email) stay contiguous either way so this only helps.
  const text = rawText.replace(/[ \t　]+/g, "");
  const result = {};

  const phoneMatch = text.match(/1[3-9]\d{9}/);
  if (phoneMatch) {
    result.phone = phoneMatch[0];
    result.contactObtained = true;
  }
  const emailMatch = text.match(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+/);
  if (emailMatch) result.email = emailMatch[0];

  const ageMatch = text.match(/(\d{2})岁/);
  if (ageMatch) result.age = parseInt(ageMatch[1], 10);

  const genderMatch = text.match(/性别[:：]?(男|女)/);
  if (genderMatch) result.gender = genderMatch[1];

  const eduMatch = text.match(/本科|硕士|博士|大专|专科|MBA/);
  if (eduMatch) result.education = eduMatch[0] === "专科" ? "大专" : eduMatch[0];

  const placeholderName = text.match(/([一-龥]{1,3}(?:先生|女士))/);
  if (placeholderName && !result.name) {
    result.name = placeholderName[1];
    if (result.contactObtained === undefined) result.contactObtained = false;
  }

  result.hasSecQualification = SEC_QUALIFICATION_PATTERNS.some((p) => text.includes(p));

  result.certificates = KNOWN_CERTS.filter((c) => text.includes(c));

  const expMatch = text.match(/(\d{1,2})年(?:以上)?(?:证券|银行|理财|从业|工作)?经[验历]/);
  if (expMatch) result.yearsOfExperience = parseInt(expMatch[1], 10);

  return result;
}

async function ocrImage(file, onProgress) {
  const { data } = await Tesseract.recognize(file, "chi_sim+eng", {
    logger: (m) => {
      if (m.status === "recognizing text" && typeof m.progress === "number") {
        onProgress(m.progress);
      }
    },
  });
  return data.text || "";
}

async function extractPdfText(file, onProgress) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n";
    onProgress(i / pdf.numPages);
  }

  if (text.trim().length >= 30) return text;

  // Likely a scanned/image-based PDF: rasterize pages and OCR them instead.
  text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    text += await ocrImage(blob, (p) => onProgress((i - 1 + p) / pdf.numPages));
    text += "\n";
  }
  return text;
}

function makeWorkRow(data) {
  const row = document.createElement("div");
  row.className = "repeat-row";
  row.innerHTML = `
    <input type="text" class="w-company" placeholder="公司名称" value="${escapeHtml(data?.company || "")}">
    <input type="text" class="w-position" placeholder="职位" value="${escapeHtml(data?.position || "")}">
    <input type="text" class="w-period" placeholder="时间段，如 2021.03 - 至今" value="${escapeHtml(data?.period || "")}">
    <textarea class="w-description" rows="2" placeholder="职责/业绩描述">${escapeHtml(data?.description || "")}</textarea>
    <button type="button" class="btn btn-remove">删除</button>
  `;
  row.querySelector(".btn-remove").addEventListener("click", () => row.remove());
  return row;
}

function makeEduRow(data) {
  const row = document.createElement("div");
  row.className = "repeat-row repeat-row-edu";
  row.innerHTML = `
    <input type="text" class="e-school" placeholder="学校名称" value="${escapeHtml(data?.school || "")}">
    <input type="text" class="e-degree" placeholder="学历" value="${escapeHtml(data?.degree || "")}">
    <input type="text" class="e-major" placeholder="专业" value="${escapeHtml(data?.major || "")}">
    <input type="text" class="e-period" placeholder="时间段，如 2014.09 - 2018.06" value="${escapeHtml(data?.period || "")}">
    <button type="button" class="btn btn-remove">删除</button>
  `;
  row.querySelector(".btn-remove").addEventListener("click", () => row.remove());
  return row;
}

function checkDuplicate(phone, name) {
  const existing = Array.isArray(window.CANDIDATES_DATA) ? window.CANDIDATES_DATA : [];
  const warning = document.querySelector("#duplicate-warning");
  const hit = existing.find((c) => (phone && c.phone === phone) || (name && c.name === name && name.length >= 2));
  if (hit) {
    warning.hidden = false;
    warning.innerHTML = `⚠️ 检测到可能重复的候选人：<strong>${escapeHtml(hit.name)}</strong>（编号 ${escapeHtml(hit.id)}，来源 ${escapeHtml(hit.source)}，获取时间 ${escapeHtml(hit.acquiredDate)}）。请确认是否是同一个人，避免重复录入。`;
  } else {
    warning.hidden = true;
    warning.innerHTML = "";
  }
}

function initUploadPage() {
  const dropzone = document.querySelector("#dropzone");
  const fileInput = document.querySelector("#file-input");
  const fileStatus = document.querySelector("#file-status");
  const progressWrap = document.querySelector("#progress-wrap");
  const progressBar = document.querySelector("#progress-bar");
  const rawText = document.querySelector("#raw-text");
  const workRows = document.querySelector("#work-rows");
  const eduRows = document.querySelector("#edu-rows");
  const outputWrap = document.querySelector("#output-wrap");
  const outputBox = document.querySelector("#output-box");

  // Resets every field a *previous* candidate could have touched (auto-filled or
  // hand-typed) so processing a second resume in the same page session never
  // leaves anything — a company name, a work-history row — behind on the new one.
  function resetFormForNewCandidate() {
    document.querySelector("#field-id").value = nextCandidateId();
    document.querySelector("#field-acquiredDate").value = todayStr();
    document.querySelector("#field-currentCompany").value = "";
    document.querySelector("#field-currentPosition").value = "";
    document.querySelector("#field-location").value = "";
    document.querySelector("#field-school").value = "";
    document.querySelector("#field-major").value = "";
    document.querySelector("#field-expectedPosition").value = "";
    document.querySelector("#field-expectedSalary").value = "";
    document.querySelector("#field-jobSeekingStatus").value = "";
    document.querySelector("#field-status").value = "待联系";
    document.querySelector("#field-selfEvaluation").value = "";
    document.querySelector("#field-notes").value = "";
    workRows.innerHTML = "";
    eduRows.innerHTML = "";
    workRows.appendChild(makeWorkRow());
    eduRows.appendChild(makeEduRow());
    outputWrap.hidden = true;
    document.querySelector("#duplicate-warning").hidden = true;
  }

  resetFormForNewCandidate();
  document.querySelector("#add-work").addEventListener("click", () => workRows.appendChild(makeWorkRow()));
  document.querySelector("#add-edu").addEventListener("click", () => eduRows.appendChild(makeEduRow()));

  function setProgress(p) {
    progressWrap.hidden = false;
    progressBar.style.width = Math.round(p * 100) + "%";
  }

  // Every field here is fully re-derived (and cleared if not detected) on each run,
  // so a second upload in the same session never leaves a previous candidate's
  // auto-filled value (e.g. phone number) behind on the new one.
  function applyHeuristics(h) {
    document.querySelector("#field-phone").value = h.phone || "";
    document.querySelector("#field-email").value = h.email || "";
    document.querySelector("#field-age").value = h.age || "";
    document.querySelector("#field-gender").value = h.gender || "";
    document.querySelector("#field-education").value = h.education || "";
    document.querySelector("#field-name").value = h.name || "";
    document.querySelector("#field-contactObtained").checked = !!h.contactObtained;
    document.querySelector("#field-hasSecQualification").checked = !!h.hasSecQualification;
    document.querySelector("#field-certificates").value = (h.certificates || []).join("、");
    document.querySelector("#field-yearsOfExperience").value = h.yearsOfExperience || "";
    checkDuplicate(h.phone, h.name);
  }

  async function handleFile(file) {
    resetFormForNewCandidate();
    fileStatus.textContent = "正在识别：" + file.name;
    progressWrap.hidden = false;
    progressBar.style.width = "0%";
    rawText.value = "";

    try {
      let text = "";
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (isPdf) {
        text = await extractPdfText(file, setProgress);
      } else {
        text = await ocrImage(file, setProgress);
      }
      rawText.value = text.trim();
      fileStatus.textContent = "识别完成：" + file.name + "，已根据识别结果预填表单，请仔细核对。";
      applyHeuristics(extractHeuristics(text));
    } catch (err) {
      fileStatus.textContent = "识别失败：" + err.message + "（可以手动把文字粘贴到下面的识别原文框，或直接手动填写表单）";
    } finally {
      progressWrap.hidden = true;
    }
  }

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  rawText.addEventListener("blur", () => applyHeuristics(extractHeuristics(rawText.value)));
  document.querySelector("#field-phone").addEventListener("blur", (e) => {
    checkDuplicate(e.target.value.trim(), document.querySelector("#field-name").value.trim());
  });

  document.querySelector("#generate-btn").addEventListener("click", () => {
    const val = (id) => document.querySelector("#field-" + id).value.trim();
    const workExperience = Array.from(workRows.children).map((row) => ({
      company: row.querySelector(".w-company").value.trim(),
      position: row.querySelector(".w-position").value.trim(),
      period: row.querySelector(".w-period").value.trim(),
      description: row.querySelector(".w-description").value.trim(),
    })).filter((w) => w.company || w.position);

    const educationExperience = Array.from(eduRows.children).map((row) => ({
      school: row.querySelector(".e-school").value.trim(),
      degree: row.querySelector(".e-degree").value.trim(),
      major: row.querySelector(".e-major").value.trim(),
      period: row.querySelector(".e-period").value.trim(),
    })).filter((e) => e.school);

    const candidate = {
      id: val("id"),
      name: val("name"),
      source: val("source"),
      acquiredDate: val("acquiredDate"),
      contactObtained: document.querySelector("#field-contactObtained").checked,
      gender: val("gender"),
      age: val("age") ? parseInt(val("age"), 10) : null,
      education: val("education"),
      school: val("school"),
      major: val("major"),
      currentCompany: val("currentCompany"),
      currentPosition: val("currentPosition"),
      yearsOfExperience: val("yearsOfExperience") ? parseInt(val("yearsOfExperience"), 10) : null,
      expectedPosition: val("expectedPosition"),
      expectedSalary: val("expectedSalary"),
      location: val("location"),
      phone: val("phone"),
      email: val("email"),
      status: val("status"),
      jobSeekingStatus: val("jobSeekingStatus"),
      hasSecQualification: document.querySelector("#field-hasSecQualification").checked,
      certificates: val("certificates") ? val("certificates").split(/[、,，]/).map((s) => s.trim()).filter(Boolean) : [],
      selfEvaluation: val("selfEvaluation"),
      notes: val("notes"),
      workExperience,
      educationExperience,
    };

    outputBox.value = JSON.stringify(candidate, null, 2) + ",";
    outputWrap.hidden = false;
    outputWrap.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.querySelector("#copy-btn").addEventListener("click", async () => {
    await navigator.clipboard.writeText(outputBox.value);
    const btn = document.querySelector("#copy-btn");
    const original = btn.textContent;
    btn.textContent = "已复制！";
    setTimeout(() => { btn.textContent = original; }, 1500);
  });

  document.querySelector("#download-btn").addEventListener("click", () => {
    const id = document.querySelector("#field-id").value || "candidate";
    const blob = new Blob([outputBox.value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = id + "_snippet.txt";
    a.click();
    URL.revokeObjectURL(url);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.dataset.page === "upload") initUploadPage();
});
