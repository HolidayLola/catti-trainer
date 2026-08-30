"use strict";
/* ============ 基础工具 ============ */
const $ = s => document.querySelector(s);
const root = $("#root");
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 4000); }
function todayStr() { return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

/* ============ 配置与进度 ============ */
let cfg = Object.assign({ base: "https://api.deepseek.com", key: "", model: "deepseek-chat", gistToken: "", gistId: "" }, lsGet("catti.cfg", {}));
let progress = Object.assign({ vocab: [], results: {}, drills: {}, updatedAt: 0 }, lsGet("catti.progress", {}));
function saveCfg() { lsSet("catti.cfg", cfg); }
let syncTimer = null;
function saveProgress() {
  progress.updatedAt = Date.now();
  lsSet("catti.progress", progress);
  if (cfg.gistToken && cfg.gistId) { clearTimeout(syncTimer); syncTimer = setTimeout(pushGist, 2500); }
  updateDueDot();
}

/* ============ GitHub Gist 云同步（可选） ============ */
const GIST_FILE = "catti-progress.json";
async function gistApi(method, path, body) {
  const r = await fetch("https://api.github.com" + path, {
    method, headers: { Authorization: "Bearer " + cfg.gistToken, Accept: "application/vnd.github+json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error("GitHub API " + r.status);
  return r.json();
}
async function pushGist() {
  try { await gistApi("PATCH", "/gists/" + cfg.gistId, { files: { [GIST_FILE]: { content: JSON.stringify(progress) } } }); }
  catch (e) { console.warn(e); toast("云同步失败：" + e.message); }
}
async function pullGist() {
  const g = await gistApi("GET", "/gists/" + cfg.gistId);
  const f = g.files && g.files[GIST_FILE];
  if (!f) return;
  const remote = JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);
  if ((remote.updatedAt || 0) > (progress.updatedAt || 0)) {
    progress = Object.assign({ vocab: [], results: {}, drills: {} }, remote);
    lsSet("catti.progress", progress);
    toast("已从云端拉取最新学习记录");
  }
}
async function createGist() {
  const g = await gistApi("POST", "/gists", { description: "CATTI trainer progress", public: false, files: { [GIST_FILE]: { content: JSON.stringify(progress) } } });
  cfg.gistId = g.id; saveCfg();
}

/* ============ LLM 调用（OpenAI 兼容接口） ============ */
async function llm(messages, { json = true, maxTokens = 4000 } = {}) {
  if (!cfg.key) { toast("请先在「设置」中填入 API Key"); switchTab("settings"); throw new Error("no key"); }
  let r;
  try {
    r = await fetch(cfg.base.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify(Object.assign({ model: cfg.model, messages, temperature: 0.3, max_tokens: maxTokens },
        json ? { response_format: { type: "json_object" } } : {}))
    });
  } catch (e) {
    throw new Error("网络请求失败——可能是网络不通或该 API 不允许浏览器直连（CORS）。可在设置中改用代理地址。");
  }
  if (r.status === 401) throw new Error("API Key 无效（401）");
  if (!r.ok) throw new Error("API 错误 " + r.status + "：" + (await r.text()).slice(0, 200));
  const content = (await r.json()).choices[0].message.content;
  if (!json) return content;
  try { return JSON.parse(content.replace(/^```(json)?|```$/g, "").trim()); }
  catch (e) { throw new Error("模型未返回合法 JSON，请重试"); }
}

/* ============ 数据加载 ============ */
let index = null, day = null, viewDate = null, curTab = "today";
async function fetchJson(path) { const r = await fetch(path + "?t=" + Date.now()); if (!r.ok) throw new Error(path + " " + r.status); return r.json(); }
async function loadIndex() { index = await fetchJson("data/index.json"); }
async function loadDay(date) { day = await fetchJson("data/" + date + ".json"); viewDate = date; }

/* ============ 词源查询 ============ */
const panel = $("#panel");
function closePanel() { panel.hidden = true; }
async function showEtym(word, sentence) {
  panel.hidden = false;
  panel.innerHTML = '<button class="close">×</button><h2>' + esc(word) + '</h2><p><span class="spin"></span> 正在查询词源…</p>';
  panel.querySelector(".close").onclick = closePanel;
  let d;
  try {
    d = await llm([
      { role: "system", content: "你是德语词源学专家，面向中国德语学习者，只输出合法 JSON。" },
      { role: "user", content: `讲解德语单词「${word}」（上下文：${sentence}）。输出 JSON：
{"lemma":"原形","art":"冠词(名词才有,否则空)","zh":"中文释义(含此语境义)","origin":"词源讲解：来自什么语言什么词根，演变路径，2-4句，中文",
"roots":"核心词根/词干及其含义","family":[{"w":"同根词","zh":"释义"}](5-10个，按常用度排),
"colloc":["常用搭配1","搭配2","搭配3"],"cognate":"与英语同源词的对应(若有)","mnem":"一句记忆提示"}` }
    ]);
  } catch (e) { panel.innerHTML = '<button class="close">×</button><p>' + esc(e.message) + "</p>"; panel.querySelector(".close").onclick = closePanel; return; }
  const famHtml = (d.family || []).map(f => `<span title="${esc(f.zh)}">${esc(f.w)} <small style="color:var(--muted)">${esc(f.zh)}</small></span>`).join("");
  panel.innerHTML = `<button class="close">×</button>
    <h2>${esc(d.art ? d.art + " " : "")}${esc(d.lemma || word)}</h2>
    <div>${esc(d.zh || "")}</div>
    <div class="etyk">词源 Herkunft</div><div>${esc(d.origin || "")}</div>
    <div class="etyk">词根 Wurzel</div><div>${esc(d.roots || "")}</div>
    <div class="etyk">同根词族 Wortfamilie</div><div class="fam">${famHtml}</div>
    <div class="etyk">搭配 Kollokationen</div><div>${(d.colloc || []).map(esc).join("；")}</div>
    ${d.cognate ? '<div class="etyk">英语同源</div><div>' + esc(d.cognate) + "</div>" : ""}
    ${d.mnem ? '<div class="etyk">记忆提示</div><div>' + esc(d.mnem) + "</div>" : ""}
    <button class="btn" id="add-vocab">＋ 收入生词本</button>
    <div class="hint">同根词族里的词也值得一起记——点击下方按钮只收录本词，词族信息会存进备注。</div>`;
  panel.querySelector(".close").onclick = closePanel;
  panel.querySelector("#add-vocab").onclick = () => {
    addVocab({
      de: (d.art ? d.art + " " : "") + (d.lemma || word), zh: d.zh || "",
      root: d.roots || "", note: "词族: " + (d.family || []).map(f => f.w).join(", ") + (d.colloc && d.colloc.length ? "｜搭配: " + d.colloc.join("; ") : "")
    });
    panel.querySelector("#add-vocab").textContent = "✓ 已收入生词本";
    panel.querySelector("#add-vocab").disabled = true;
  };
}
function addVocab(v) {
  const lemma = v.de.replace(/^(der|die|das)\s+/i, "").toLowerCase();
  if (progress.vocab.some(x => x.de.replace(/^(der|die|das)\s+/i, "").toLowerCase() === lemma)) { toast("已在生词本中"); return; }
  progress.vocab.push(Object.assign({ addedAt: todayStr(), srs: { due: todayStr(), iv: 0, ease: 2.5, reps: 0 } }, v));
  saveProgress(); toast("已加入生词本：" + v.de);
  document.querySelectorAll('.passage .w').forEach(w => { if (w.textContent.toLowerCase() === lemma) w.classList.add("saved"); });
}

/* ============ 批改 ============ */
function gradePrompt(dir, source, mine) {
  const rubric = dir === "de2zh"
    ? "扣分类型：错译(-1~-3)、漏译(-1~-2)、理解(-1~-2)、表达(-0.5~-1)、错别字/标点(-0.5)"
    : "扣分类型：语法(-1~-2，格/动词变位/框架结构/性数一致须单独指出)、错译(-1~-3)、漏译(-1~-2)、用词搭配(-0.5~-1.5)、句式(-0.5~-1)";
  return `你是 CATTI 德语二级笔译阅卷专家。请按扣分制批改下面这篇${dir === "de2zh" ? "德译汉" : "汉译德"}（满分25，及格线15）。${rubric}。
评分对标真实 CATTI 阅卷严格度，不送人情分，但每处扣分都要有依据；q 精确引用出错文字，x 用中文讲清错在哪、考点是什么，fix 给正确译法；deductions 按原文顺序。
ref 给出高质量参考译文${dir === "zh2de" ? "（德语参考译文必须语法零错误、用词正式地道）" : ""}。sum 写2-4句总评（主要失分模式+针对性建议）。
vocab 挑 3-6 个本篇值得积累的词汇/搭配（de 为德语原形带冠词）。
只输出 JSON：{"score":数字,"max":25,"deductions":[{"q":"","t":"","p":-1,"x":"","fix":""}],"ref":"","sum":"","vocab":[{"de":"","zh":"","note":""}]}

【原文】
${source}

【考生译文】
${mine}`;
}
async function grade(part, mineText, card) {
  const p = day[part];
  const btn = card.querySelector(".btn");
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> AI 批改中…';
  let fb;
  try {
    fb = await llm([{ role: "user", content: gradePrompt(part, p.text, mineText) }], { maxTokens: 5000 });
  } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = "提交批改"; return; }
  fb.mine = mineText; fb.at = new Date().toISOString();
  if (!progress.results[viewDate]) progress.results[viewDate] = {};
  progress.results[viewDate][part] = fb;
  saveProgress();
  try { localStorage.removeItem("draft:" + viewDate + ":" + part); } catch (e) {}
  render();
}

/* ============ 今日练习 ============ */
function renderToday() {
  root.innerHTML = "";
  const due = dueVocab().length;
  if (due) {
    const b = el("div", "banner", `📚 有 <b>${due}</b> 个生词到期待复习——先复习再做新题效果最好。 <a href="#" id="go-rev">去复习 →</a>`);
    b.querySelector("#go-rev").onclick = e => { e.preventDefault(); switchTab("review"); };
    root.appendChild(b);
  }
  if (!day) {
    root.appendChild(el("div", "empty", "今日材料尚未生成。<br>GitHub Actions 每天早上约 6:45 自动抓取新闻并更新；<br>也可以到仓库 Actions 页手动触发 daily-material 工作流。"));
    return;
  }
  $("#issue-line").textContent = `Ausgabe Nr. ${day.issue || "?"} · ${day.date} · 主题：${day.theme}`;
  if (viewDate !== (index.days && index.days[0])) {
    const back = el("div", "", '<button class="btn ghost">← 回到最新一期</button>');
    back.querySelector("button").onclick = async () => { await loadDay(index.days[0]); render(); };
    root.appendChild(back);
  }
  root.appendChild(partCard("de2zh"));
  root.appendChild(partCard("zh2de"));
}
function tokenizeDe(text) {
  return esc(text).replace(/[A-Za-zÄÖÜäöüß]{3,}/g, m => `<span class="w">${m}</span>`);
}
function partCard(part) {
  const p = day[part], isDe = part === "de2zh";
  const card = el("div", "card");
  const res = (progress.results[viewDate] || {})[part];
  const head = el("div", "part-label",
    `<span class="kicker">${isDe ? "Teil 1 · Deutsch → Chinesisch" : "Teil 2 · Chinesisch → Deutsch"}</span><h2>${isDe ? "德译汉" : "汉译德"}</h2>`);
  head.appendChild(res
    ? el("span", "badge " + (res.score >= 15 ? "done" : "fail"), res.score >= 15 ? "已批改 · 达标" : "已批改 · 未达标")
    : el("span", "badge wait", "待作答"));
  card.appendChild(head);
  if (p.title) card.appendChild(el("h3", "p-title", esc(p.title)));
  const src = [];
  if (p.source) src.push(esc(p.source));
  if (p.url) src.push(`<a href="${esc(p.url)}" target="_blank" rel="noopener">原文链接</a>`);
  if (src.length) card.appendChild(el("div", "src", "来源：" + src.join(" · ")));
  const passage = el("div", "passage");
  passage.innerHTML = isDe ? tokenizeDe(p.text) : esc(p.text);
  if (isDe) passage.addEventListener("click", e => {
    const w = e.target.closest(".w"); if (!w) return;
    const sent = (w.parentNode.textContent.match(new RegExp("[^.!?]*" + w.textContent + "[^.!?]*[.!?]?")) || [""])[0];
    showEtym(w.textContent, sent.trim().slice(0, 300));
  });
  card.appendChild(passage);
  if (isDe) card.appendChild(el("div", "hint", "💡 点任何单词查词源词根、同根词族，一键收入生词本。"));

  if (res) renderFeedback(card, res, part);
  else {
    const draftKey = "draft:" + viewDate + ":" + part;
    const ta = document.createElement("textarea");
    ta.placeholder = isDe ? "在此输入你的汉语译文…" : "Geben Sie hier Ihre deutsche Übersetzung ein …";
    try { ta.value = localStorage.getItem(draftKey) || ""; } catch (e) {}
    ta.addEventListener("input", () => { try { localStorage.setItem(draftKey, ta.value); } catch (e) {} });
    card.appendChild(ta);
    const btn = el("button", "btn", "提交批改");
    btn.onclick = () => {
      const txt = ta.value.trim();
      if (txt.length < 20) { toast("译文太短，请完成后再提交"); return; }
      grade(part, txt, card);
    };
    card.appendChild(btn);
    if (!isDe) {
      const ask = el("details", "", "<summary>翻译卡住了？问一下某个表达怎么说</summary>");
      const row = el("div", "colloc-row", '<input type="text" placeholder="例如：非物质文化遗产 / 同比增长 8%"><button class="btn small">问 AI</button>');
      const out = el("div", "why"); out.hidden = true;
      row.querySelector("button").onclick = async () => {
        const q = row.querySelector("input").value.trim(); if (!q) return;
        out.hidden = false; out.innerHTML = '<span class="spin"></span>';
        try {
          out.textContent = await llm([{ role: "user", content: `中文表达「${q}」在正式德语（新闻/政府文体）中怎么说？给1-2个译法并各配一个例句，简短回答。` }], { json: false, maxTokens: 500 });
        } catch (e) { out.textContent = e.message; }
      };
      ask.appendChild(row); ask.appendChild(out); card.appendChild(ask);
    }
  }
  return card;
}
function renderFeedback(card, fb, part) {
  const pass = fb.score >= 15;
  card.appendChild(el("div", "", "<b>你的译文</b>"));
  card.appendChild(el("div", "subtext", esc(fb.mine)));
  const sl = el("div", "score-line");
  sl.appendChild(el("span", "num " + (pass ? "pass" : "nopass"), fb.score + ' <span style="font-size:15px;font-weight:500">/ 25</span>'));
  card.appendChild(sl);
  (fb.deductions || []).forEach(d => {
    let h = `<span class="p">${d.p}</span><span class="t">[${esc(d.t)}]</span><span class="q">„${esc(d.q)}“</span><br>${esc(d.x)}`;
    if (d.fix) h += `<br><span class="fix">✓ ${esc(d.fix)}</span>`;
    card.appendChild(el("div", "ded", h));
  });
  if (!(fb.deductions || []).length) card.appendChild(el("p", "", "无扣分点，译文质量很好。"));
  if (fb.ref) {
    const det = el("details", "", "<summary>参考译文</summary>");
    det.appendChild(el("div", "refbox", esc(fb.ref)));
    card.appendChild(det);
  }
  if (fb.sum) card.appendChild(el("div", "sum", "<b>总评</b>　" + esc(fb.sum)));
  if (fb.vocab && fb.vocab.length) {
    const vb = el("div", "sum", "<b>本篇积累</b>　");
    fb.vocab.forEach(v => {
      const b = el("button", "btn small ghost", "＋ " + esc(v.de));
      b.style.margin = "3px 4px 3px 0";
      b.title = v.zh;
      b.onclick = () => { addVocab(v); b.disabled = true; b.textContent = "✓ " + v.de; };
      vb.appendChild(b);
    });
    card.appendChild(vb);
  }
  const redo = el("button", "btn ghost", "清除结果，重新练习");
  redo.onclick = () => { delete progress.results[viewDate][part]; saveProgress(); render(); };
  card.appendChild(redo);
}

/* ============ 每日小卷 ============ */
function renderDrills() {
  root.innerHTML = "";
  if (!day || !day.drills || !(day.drills.mcq || []).length) { root.appendChild(el("div", "empty", "今日小卷尚未生成。")); return; }
  const stat = progress.drills[viewDate] || { answers: {}, colloc: {} };
  const card = el("div", "card");
  card.appendChild(el("div", "part-label", '<span class="kicker">Wortschatz-Quiz</span><h2>综合风格单选 · 10 题</h2>'));
  day.drills.mcq.forEach((q, i) => {
    const box = el("div", "mcq", `<div class="qtext">${i + 1}. ${esc(q.q)}</div>`);
    const opts = el("div", "opts");
    const answered = stat.answers[i];
    q.opts.forEach((o, j) => {
      const b = el("button", "", "ABCD"[j] + ". " + esc(o));
      if (answered != null) {
        if (j === q.ans) b.className = "right";
        else if (j === answered && answered !== q.ans) b.className = "wrong";
        b.disabled = true;
      } else b.onclick = () => {
        stat.answers[i] = j; progress.drills[viewDate] = stat; saveProgress(); renderDrills();
      };
      opts.appendChild(b);
    });
    box.appendChild(opts);
    if (answered != null && q.why) box.appendChild(el("div", "why", esc(q.why)));
    card.appendChild(box);
  });
  root.appendChild(card);

  const card2 = el("div", "card");
  card2.appendChild(el("div", "part-label", '<span class="kicker">Kollokationen</span><h2>固定搭配填空 · ' + (day.drills.colloc || []).length + " 题</h2>"));
  (day.drills.colloc || []).forEach((q, i) => {
    const done = stat.colloc[i];
    const box = el("div", "mcq", `<div class="qtext">${i + 1}. ${esc(q.q)}</div><div class="hint">${esc(q.hint || "")}</div>`);
    if (done) {
      box.appendChild(el("div", "why", (done.ok ? "✓ 正确 " : `✗ 你填的是「${esc(done.val)}」，正确答案：<b>${esc(q.ans)}</b>。`) + (q.why ? "<br>" + esc(q.why) : "")));
    } else {
      const row = el("div", "colloc-row", '<input type="text" placeholder="填入答案"><button class="btn small">检查</button>');
      const check = () => {
        const val = row.querySelector("input").value.trim();
        if (!val) return;
        stat.colloc[i] = { val, ok: val.toLowerCase() === q.ans.trim().toLowerCase() };
        progress.drills[viewDate] = stat; saveProgress(); renderDrills();
      };
      row.querySelector("button").onclick = check;
      row.querySelector("input").addEventListener("keydown", e => { if (e.key === "Enter") check(); });
      box.appendChild(row);
    }
    card2.appendChild(box);
  });
  const total = day.drills.mcq.length, right = day.drills.mcq.filter((q, i) => stat.answers[i] === q.ans).length;
  const answeredN = Object.keys(stat.answers).length;
  if (answeredN === total) card2.appendChild(el("div", "sum", `<b>单选得分 ${right}/${total}</b>　错题考点建议顺手收入生词本。`));
  root.appendChild(card2);
}

/* ============ 复习（间隔重复） ============ */
function dueVocab() { const t = todayStr(); return progress.vocab.filter(v => (v.srs && v.srs.due || t) <= t); }
function updateDueDot() { const n = dueVocab().length; const d = $("#due-dot"); d.hidden = !n; d.textContent = n; }
function renderReview() {
  root.innerHTML = "";
  const queue = dueVocab();
  if (!queue.length) { root.appendChild(el("div", "empty", "今天没有到期的生词 🎉<br>去做今日练习，点选生词继续积累。")); return; }
  let i = 0;
  const card = el("div", "card rev-card");
  root.appendChild(el("div", "hint", "到期 " + queue.length + " 词。按记忆情况自评，系统按间隔重复安排下次复习。"));
  root.appendChild(card);
  function show() {
    if (i >= queue.length) { card.innerHTML = "<h2>✓ 今日复习完成</h2>"; updateDueDot(); return; }
    const v = queue[i];
    card.innerHTML = `<div class="hint">${i + 1} / ${queue.length}</div><div class="front">${esc(v.de)}</div>
      <button class="btn" id="flip">显示释义</button><div class="back" hidden></div>`;
    card.querySelector("#flip").onclick = () => {
      const back = card.querySelector(".back");
      back.hidden = false;
      back.innerHTML = `<div>${esc(v.zh)}</div>${v.root ? '<div class="hint">词根：' + esc(v.root) + "</div>" : ""}${v.note ? '<div class="hint">' + esc(v.note) + "</div>" : ""}
        <div class="rev-btns"><button class="btn again">不会</button><button class="btn hard">模糊</button><button class="btn good">会</button></div>`;
      card.querySelector("#flip").hidden = true;
      const s = v.srs || (v.srs = { due: todayStr(), iv: 0, ease: 2.5, reps: 0 });
      function next(days, dEase) {
        s.ease = Math.max(1.3, s.ease + dEase); s.iv = days; s.reps++;
        s.due = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
        saveProgress(); i++; show();
      }
      back.querySelector(".again").onclick = () => next(1, -0.2);
      back.querySelector(".hard").onclick = () => next(Math.max(1, Math.round(s.iv * 1.2) || 1), -0.05);
      back.querySelector(".good").onclick = () => next(s.iv === 0 ? 1 : s.iv === 1 ? 3 : Math.round(s.iv * s.ease), 0.05);
    };
  }
  show();
}

/* ============ 生词本 ============ */
function renderVocab() {
  root.innerHTML = "";
  const bar = el("div", "colloc-row", '<input type="text" id="vq" placeholder="搜索生词 / 词根 / 释义"><button class="btn small" id="vadd">＋ 手动添加</button>');
  root.appendChild(bar);
  const listBox = el("div", "card");
  root.appendChild(listBox);
  function draw(q) {
    listBox.innerHTML = "";
    const items = progress.vocab.filter(v => !q || (v.de + v.zh + (v.root || "") + (v.note || "")).toLowerCase().includes(q.toLowerCase()));
    listBox.appendChild(el("div", "hint", "共 " + progress.vocab.length + " 词" + (q ? "，匹配 " + items.length : "")));
    if (!items.length) { listBox.appendChild(el("div", "empty", "生词本为空。去今日练习里点选单词收词吧。")); return; }
    items.slice().reverse().forEach(v => {
      const r = el("div", "vrow",
        `<span class="de">${esc(v.de)}</span><span>${esc(v.zh)}</span>` +
        (v.root ? `<span class="root">${esc(v.root)}</span>` : "") +
        `<span class="date">${esc(v.addedAt || "")}</span><button class="del" title="删除">✕</button>`);
      if (v.note) r.title = v.note;
      r.querySelector(".del").onclick = () => {
        if (!confirm("删除「" + v.de + "」？")) return;
        progress.vocab = progress.vocab.filter(x => x !== v); saveProgress(); draw(q);
      };
      listBox.appendChild(r);
    });
  }
  bar.querySelector("#vq").addEventListener("input", e => draw(e.target.value.trim()));
  bar.querySelector("#vadd").onclick = () => {
    const de = prompt("德语（名词带冠词，如 die Nachhaltigkeit）"); if (!de) return;
    const zh = prompt("中文释义") || "";
    addVocab({ de: de.trim(), zh: zh.trim(), root: "", note: "" }); draw("");
  };
  draw("");
}

/* ============ 历史 ============ */
function renderHistory() {
  root.innerHTML = "";
  const dates = (index && index.days) || [];
  if (!dates.length) { root.appendChild(el("div", "empty", "还没有练习记录。")); return; }
  const wrap = el("div", "tablewrap");
  const t = el("table", "", "<thead><tr><th>日期</th><th>德译汉</th><th>汉译德</th><th>小卷</th></tr></thead>");
  const tb = document.createElement("tbody");
  dates.forEach(d => {
    const r = progress.results[d] || {}, dr = progress.drills[d];
    const drillCell = dr && day ? Object.keys(dr.answers || {}).length + " 题" : (dr ? Object.keys(dr.answers || {}).length + " 题" : "—");
    const tr = el("tr", "clickable",
      `<td class="n">${d}</td><td class="n">${r.de2zh ? r.de2zh.score + " / 25" : "—"}</td><td class="n">${r.zh2de ? r.zh2de.score + " / 25" : "—"}</td><td class="n">${drillCell}</td>`);
    tr.style.cursor = "pointer";
    tr.onclick = async () => { try { await loadDay(d); switchTab("today"); } catch (e) { toast("加载失败"); } };
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t); root.appendChild(wrap);
  const graded = dates.map(d => progress.results[d]).filter(Boolean);
  const scores = graded.flatMap(r => [r.de2zh, r.zh2de].filter(Boolean).map(f => f.score));
  if (scores.length) {
    const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
    root.appendChild(el("div", "hint", `已批改 ${scores.length} 篇，平均 ${avg} / 25（及格线 15）。`));
  }
}

/* ============ 设置 ============ */
function renderSettings() {
  root.innerHTML = "";
  const card = el("div", "card");
  card.innerHTML = `
    <div class="part-label"><span class="kicker">API</span><h2>大模型接口（OpenAI 兼容）</h2></div>
    <div class="field"><label>API 地址</label><input type="text" id="s-base" value="${esc(cfg.base)}" placeholder="https://api.deepseek.com"></div>
    <div class="field"><label>API Key</label><input type="password" id="s-key" value="${esc(cfg.key)}" placeholder="sk-…"></div>
    <div class="field"><label>模型名</label><input type="text" id="s-model" value="${esc(cfg.model)}" placeholder="deepseek-chat"></div>
    <button class="btn" id="s-save">保存</button> <button class="btn ghost" id="s-test">测试连接</button>
    <div class="hint">Key 只保存在本机浏览器，不会上传到任何仓库。换模型只需改地址和模型名（如通义/月之暗面/硅基流动均兼容）。</div>`;
  root.appendChild(card);
  const card2 = el("div", "card");
  card2.innerHTML = `
    <div class="part-label"><span class="kicker">Sync</span><h2>跨设备云同步（可选）</h2></div>
    <p class="hint">用 GitHub 私密 Gist 同步生词本和成绩（手机/电脑通用）。到 github.com/settings/tokens 创建一个只勾选 <b>gist</b> 权限的 token 填入即可。</p>
    <div class="field"><label>GitHub Token（仅 gist 权限）</label><input type="password" id="s-gt" value="${esc(cfg.gistToken)}"></div>
    <div class="field"><label>Gist ID（留空则自动创建）</label><input type="text" id="s-gid" value="${esc(cfg.gistId)}"></div>
    <button class="btn" id="s-sync">启用并立即同步</button>
    <hr style="border:none;border-top:1px solid var(--line);margin:18px 0">
    <button class="btn ghost" id="s-exp">导出学习数据</button> <button class="btn ghost" id="s-imp">导入</button>`;
  root.appendChild(card2);
  card.querySelector("#s-save").onclick = () => {
    cfg.base = card.querySelector("#s-base").value.trim() || "https://api.deepseek.com";
    cfg.key = card.querySelector("#s-key").value.trim();
    cfg.model = card.querySelector("#s-model").value.trim() || "deepseek-chat";
    saveCfg(); toast("已保存");
  };
  card.querySelector("#s-test").onclick = async () => {
    card.querySelector("#s-save").click();
    try {
      const r = await llm([{ role: "user", content: '回复 JSON {"ok":true}' }], { maxTokens: 20 });
      toast(r.ok ? "✓ 连接成功，模型可用" : "连接成功");
    } catch (e) { toast("✗ " + e.message); }
  };
  card2.querySelector("#s-sync").onclick = async () => {
    cfg.gistToken = card2.querySelector("#s-gt").value.trim();
    cfg.gistId = card2.querySelector("#s-gid").value.trim();
    if (!cfg.gistToken) { toast("请先填入 token"); return; }
    try {
      if (!cfg.gistId) { await createGist(); toast("已创建私密 Gist：" + cfg.gistId); }
      else { await pullGist(); await pushGist(); toast("✓ 同步完成"); }
      saveCfg(); renderSettings();
    } catch (e) { toast("✗ " + e.message); }
  };
  card2.querySelector("#s-exp").onclick = () => {
    const a = document.createElement("a");
    a.href = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(progress, null, 1));
    a.download = "catti-progress-" + todayStr() + ".json"; a.click();
  };
  card2.querySelector("#s-imp").onclick = () => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json";
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      f.text().then(t => { progress = JSON.parse(t); saveProgress(); toast("导入成功"); render(); }).catch(() => toast("文件格式错误"));
    };
    inp.click();
  };
}

/* ============ 框架 ============ */
function switchTab(tab) { curTab = tab; render(); }
function render() {
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === curTab));
  closePanel();
  ({ today: renderToday, review: renderReview, drills: renderDrills, vocab: renderVocab, history: renderHistory, settings: renderSettings })[curTab]();
  updateDueDot();
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => switchTab(b.dataset.tab));

/* 连续打卡：有任意批改或小卷记录的日期算打卡 */
function calcStreak() {
  const set = new Set([...Object.keys(progress.results), ...Object.keys(progress.drills)]);
  let n = 0, d = new Date();
  if (!set.has(todayStr())) d.setDate(d.getDate() - 1);
  while (set.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

(async function init() {
  try {
    await loadIndex();
    $("#cd").textContent = Math.max(0, Math.round((new Date(index.exam || "2027-06-20") - new Date()) / 86400000));
    if (index.days && index.days.length) await loadDay(index.days[0]);
  } catch (e) { console.warn(e); }
  if (cfg.gistToken && cfg.gistId) { try { await pullGist(); } catch (e) { console.warn(e); } }
  $("#streak").textContent = calcStreak();
  render();
})();
