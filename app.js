"use strict";
/* ============ 鍩虹宸ュ叿 ============ */
const $ = s => document.querySelector(s);
const root = $("#root");
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 4000); }
function todayStr() { return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

/* ============ 閰嶇疆涓庤繘搴?============ */
let cfg = Object.assign({ base: "https://api.deepseek.com", key: "", model: "deepseek-v4-pro", gistToken: "", gistId: "" }, lsGet("catti.cfg", {}));
let progress = Object.assign({ vocab: [], results: {}, drills: {}, updatedAt: 0 }, lsGet("catti.progress", {}));
function saveCfg() { lsSet("catti.cfg", cfg); }
let syncTimer = null;
function saveProgress() {
  progress.updatedAt = Date.now();
  lsSet("catti.progress", progress);
  if (cfg.gistToken && cfg.gistId) { clearTimeout(syncTimer); syncTimer = setTimeout(pushGist, 2500); }
  updateDueDot();
}

/* ============ GitHub Gist 浜戝悓姝ワ紙鍙€夛級 ============ */
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
  catch (e) { console.warn(e); toast("浜戝悓姝ュけ璐ワ細" + e.message); }
}
async function pullGist() {
  const g = await gistApi("GET", "/gists/" + cfg.gistId);
  const f = g.files && g.files[GIST_FILE];
  if (!f) return;
  const remote = JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);
  if ((remote.updatedAt || 0) > (progress.updatedAt || 0)) {
    progress = Object.assign({ vocab: [], results: {}, drills: {} }, remote);
    lsSet("catti.progress", progress);
    toast("宸蹭粠浜戠鎷夊彇鏈€鏂板涔犺褰?);
  }
}
async function createGist() {
  const g = await gistApi("POST", "/gists", { description: "CATTI trainer progress", public: false, files: { [GIST_FILE]: { content: JSON.stringify(progress) } } });
  cfg.gistId = g.id; saveCfg();
}

/* ============ LLM 璋冪敤锛圤penAI 鍏煎鎺ュ彛锛?============ */
async function llm(messages, { json = true, maxTokens = 4000 } = {}) {
  if (!cfg.key) { toast("璇峰厛鍦ㄣ€岃缃€嶄腑濉叆 API Key"); switchTab("settings"); throw new Error("no key"); }
  let r;
  try {
    r = await fetch(cfg.base.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify(Object.assign({ model: cfg.model, messages, temperature: 0.3, max_tokens: maxTokens },
        json ? { response_format: { type: "json_object" } } : {}))
    });
  } catch (e) {
    throw new Error("缃戠粶璇锋眰澶辫触鈥斺€斿彲鑳芥槸缃戠粶涓嶉€氭垨璇?API 涓嶅厑璁告祻瑙堝櫒鐩磋繛锛圕ORS锛夈€傚彲鍦ㄨ缃腑鏀圭敤浠ｇ悊鍦板潃銆?);
  }
  if (r.status === 401) throw new Error("API Key 鏃犳晥锛?01锛?);
  if (!r.ok) throw new Error("API 閿欒 " + r.status + "锛? + (await r.text()).slice(0, 200));
  const content = (await r.json()).choices[0].message.content;
  if (!json) return content;
  try { return JSON.parse(content.replace(/^```(json)?|```$/g, "").trim()); }
  catch (e) { throw new Error("妯″瀷鏈繑鍥炲悎娉?JSON锛岃閲嶈瘯"); }
}

/* ============ 鏁版嵁鍔犺浇 ============ */
let index = null, day = null, viewDate = null, curTab = "today";
async function fetchJson(path) { const r = await fetch(path + "?t=" + Date.now()); if (!r.ok) throw new Error(path + " " + r.status); return r.json(); }
async function loadIndex() { index = await fetchJson("data/index.json"); }
async function loadDay(date) { day = await fetchJson("data/" + date + ".json"); viewDate = date; }

/* ============ 璇嶆簮鏌ヨ ============ */
const panel = $("#panel");
function closePanel() { panel.hidden = true; }
async function showEtym(word, sentence) {
  panel.hidden = false;
  panel.innerHTML = '<button class="close">脳</button><h2>' + esc(word) + '</h2><p><span class="spin"></span> 姝ｅ湪鏌ヨ璇嶆簮鈥?/p>';
  panel.querySelector(".close").onclick = closePanel;
  let d;
  try {
    d = await llm([
      { role: "system", content: "浣犳槸寰疯璇嶆簮瀛︿笓瀹讹紝闈㈠悜涓浗寰疯瀛︿範鑰咃紝鍙緭鍑哄悎娉?JSON銆? },
      { role: "user", content: `璁茶В寰疯鍗曡瘝銆?{word}銆嶏紙涓婁笅鏂囷細${sentence}锛夈€傝緭鍑?JSON锛?{"lemma":"鍘熷舰","art":"鍐犺瘝(鍚嶈瘝鎵嶆湁,鍚﹀垯绌?","zh":"涓枃閲婁箟(鍚璇涔?","origin":"璇嶆簮璁茶В锛氭潵鑷粈涔堣瑷€浠€涔堣瘝鏍癸紝婕斿彉璺緞锛?-4鍙ワ紝涓枃",
"roots":"鏍稿績璇嶆牴/璇嶅共鍙婂叾鍚箟","family":[{"w":"鍚屾牴璇?,"zh":"閲婁箟"}](5-10涓紝鎸夊父鐢ㄥ害鎺?,
"colloc":["甯哥敤鎼厤1","鎼厤2","鎼厤3"],"cognate":"涓庤嫳璇悓婧愯瘝鐨勫搴?鑻ユ湁)","mnem":"涓€鍙ヨ蹇嗘彁绀?}` }
    ]);
  } catch (e) { panel.innerHTML = '<button class="close">脳</button><p>' + esc(e.message) + "</p>"; panel.querySelector(".close").onclick = closePanel; return; }
  const famHtml = (d.family || []).map(f => `<span title="${esc(f.zh)}">${esc(f.w)} <small style="color:var(--muted)">${esc(f.zh)}</small></span>`).join("");
  panel.innerHTML = `<button class="close">脳</button>
    <h2>${esc(d.art ? d.art + " " : "")}${esc(d.lemma || word)}</h2>
    <div>${esc(d.zh || "")}</div>
    <div class="etyk">璇嶆簮 Herkunft</div><div>${esc(d.origin || "")}</div>
    <div class="etyk">璇嶆牴 Wurzel</div><div>${esc(d.roots || "")}</div>
    <div class="etyk">鍚屾牴璇嶆棌 Wortfamilie</div><div class="fam">${famHtml}</div>
    <div class="etyk">鎼厤 Kollokationen</div><div>${(d.colloc || []).map(esc).join("锛?)}</div>
    ${d.cognate ? '<div class="etyk">鑻辫鍚屾簮</div><div>' + esc(d.cognate) + "</div>" : ""}
    ${d.mnem ? '<div class="etyk">璁板繂鎻愮ず</div><div>' + esc(d.mnem) + "</div>" : ""}
    <button class="btn" id="add-vocab">锛?鏀跺叆鐢熻瘝鏈?/button>
    <div class="hint">鍚屾牴璇嶆棌閲岀殑璇嶄篃鍊煎緱涓€璧疯鈥斺€旂偣鍑讳笅鏂规寜閽彧鏀跺綍鏈瘝锛岃瘝鏃忎俊鎭細瀛樿繘澶囨敞銆?/div>`;
  panel.querySelector(".close").onclick = closePanel;
  panel.querySelector("#add-vocab").onclick = () => {
    addVocab({
      de: (d.art ? d.art + " " : "") + (d.lemma || word), zh: d.zh || "",
      root: d.roots || "", note: "璇嶆棌: " + (d.family || []).map(f => f.w).join(", ") + (d.colloc && d.colloc.length ? "锝滄惌閰? " + d.colloc.join("; ") : "")
    });
    panel.querySelector("#add-vocab").textContent = "鉁?宸叉敹鍏ョ敓璇嶆湰";
    panel.querySelector("#add-vocab").disabled = true;
  };
}
function addVocab(v) {
  const lemma = v.de.replace(/^(der|die|das)\s+/i, "").toLowerCase();
  if (progress.vocab.some(x => x.de.replace(/^(der|die|das)\s+/i, "").toLowerCase() === lemma)) { toast("宸插湪鐢熻瘝鏈腑"); return; }
  progress.vocab.push(Object.assign({ addedAt: todayStr(), srs: { due: todayStr(), iv: 0, ease: 2.5, reps: 0 } }, v));
  saveProgress(); toast("宸插姞鍏ョ敓璇嶆湰锛? + v.de);
  document.querySelectorAll('.passage .w').forEach(w => { if (w.textContent.toLowerCase() === lemma) w.classList.add("saved"); });
}

/* ============ 鎵规敼 ============ */
function gradePrompt(dir, source, mine) {
  const rubric = dir === "de2zh"
    ? "鎵ｅ垎绫诲瀷锛氶敊璇?-1~-3)銆佹紡璇?-1~-2)銆佺悊瑙?-1~-2)銆佽〃杈?-0.5~-1)銆侀敊鍒瓧/鏍囩偣(-0.5)"
    : "鎵ｅ垎绫诲瀷锛氳娉?-1~-2锛屾牸/鍔ㄨ瘝鍙樹綅/妗嗘灦缁撴瀯/鎬ф暟涓€鑷撮』鍗曠嫭鎸囧嚭)銆侀敊璇?-1~-3)銆佹紡璇?-1~-2)銆佺敤璇嶆惌閰?-0.5~-1.5)銆佸彞寮?-0.5~-1)";
  return `浣犳槸 CATTI 寰疯浜岀骇绗旇瘧闃呭嵎涓撳銆傝鎸夋墸鍒嗗埗鎵规敼涓嬮潰杩欑瘒${dir === "de2zh" ? "寰疯瘧姹? : "姹夎瘧寰?}锛堟弧鍒?5锛屽強鏍肩嚎15锛夈€?{rubric}銆?璇勫垎瀵规爣鐪熷疄 CATTI 闃呭嵎涓ユ牸搴︼紝涓嶉€佷汉鎯呭垎锛屼絾姣忓鎵ｅ垎閮借鏈変緷鎹紱q 绮剧‘寮曠敤鍑洪敊鏂囧瓧锛寈 鐢ㄤ腑鏂囪娓呴敊鍦ㄥ摢銆佽€冪偣鏄粈涔堬紝fix 缁欐纭瘧娉曪紱deductions 鎸夊師鏂囬『搴忋€?ref 缁欏嚭楂樿川閲忓弬鑰冭瘧鏂?{dir === "zh2de" ? "锛堝痉璇弬鑰冭瘧鏂囧繀椤昏娉曢浂閿欒銆佺敤璇嶆寮忓湴閬擄級" : ""}銆俿um 鍐?-4鍙ユ€昏瘎锛堜富瑕佸け鍒嗘ā寮?閽堝鎬у缓璁級銆?vocab 鎸?3-6 涓湰绡囧€煎緱绉疮鐨勮瘝姹?鎼厤锛坉e 涓哄痉璇師褰㈠甫鍐犺瘝锛夈€?鍙緭鍑?JSON锛歿"score":鏁板瓧,"max":25,"deductions":[{"q":"","t":"","p":-1,"x":"","fix":""}],"ref":"","sum":"","vocab":[{"de":"","zh":"","note":""}]}

銆愬師鏂囥€?${source}

銆愯€冪敓璇戞枃銆?${mine}`;
}
async function grade(part, mineText, card) {
  const p = day[part];
  const btn = card.querySelector(".btn");
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> AI 鎵规敼涓€?;
  let fb;
  try {
    fb = await llm([{ role: "user", content: gradePrompt(part, p.text, mineText) }], { maxTokens: 5000 });
  } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = "鎻愪氦鎵规敼"; return; }
  fb.mine = mineText; fb.at = new Date().toISOString();
  if (!progress.results[viewDate]) progress.results[viewDate] = {};
  progress.results[viewDate][part] = fb;
  saveProgress();
  try { localStorage.removeItem("draft:" + viewDate + ":" + part); } catch (e) {}
  render();
}

/* ============ 浠婃棩缁冧範 ============ */
function renderToday() {
  root.innerHTML = "";
  const due = dueVocab().length;
  if (due) {
    const b = el("div", "banner", `馃摎 鏈?<b>${due}</b> 涓敓璇嶅埌鏈熷緟澶嶄範鈥斺€斿厛澶嶄範鍐嶅仛鏂伴鏁堟灉鏈€濂姐€?<a href="#" id="go-rev">鍘诲涔?鈫?/a>`);
    b.querySelector("#go-rev").onclick = e => { e.preventDefault(); switchTab("review"); };
    root.appendChild(b);
  }
  if (!day) {
    root.appendChild(el("div", "empty", "浠婃棩鏉愭枡灏氭湭鐢熸垚銆?br>GitHub Actions 姣忓ぉ鏃╀笂绾?6:45 鑷姩鎶撳彇鏂伴椈骞舵洿鏂帮紱<br>涔熷彲浠ュ埌浠撳簱 Actions 椤垫墜鍔ㄨЕ鍙?daily-material 宸ヤ綔娴併€?));
    return;
  }
  $("#issue-line").textContent = `Ausgabe Nr. ${day.issue || "?"} 路 ${day.date} 路 涓婚锛?{day.theme}`;
  if (viewDate !== (index.days && index.days[0])) {
    const back = el("div", "", '<button class="btn ghost">鈫?鍥炲埌鏈€鏂颁竴鏈?/button>');
    back.querySelector("button").onclick = async () => { await loadDay(index.days[0]); render(); };
    root.appendChild(back);
  }
  root.appendChild(partCard("de2zh"));
  root.appendChild(partCard("zh2de"));
}
function tokenizeDe(text) {
  return esc(text).replace(/[A-Za-z脛脰脺盲枚眉脽]{3,}/g, m => `<span class="w">${m}</span>`);
}
function partCard(part) {
  const p = day[part], isDe = part === "de2zh";
  const card = el("div", "card");
  const res = (progress.results[viewDate] || {})[part];
  const head = el("div", "part-label",
    `<span class="kicker">${isDe ? "Teil 1 路 Deutsch 鈫?Chinesisch" : "Teil 2 路 Chinesisch 鈫?Deutsch"}</span><h2>${isDe ? "寰疯瘧姹? : "姹夎瘧寰?}</h2>`);
  head.appendChild(res
    ? el("span", "badge " + (res.score >= 15 ? "done" : "fail"), res.score >= 15 ? "宸叉壒鏀?路 杈炬爣" : "宸叉壒鏀?路 鏈揪鏍?)
    : el("span", "badge wait", "寰呬綔绛?));
  card.appendChild(head);
  if (p.title) card.appendChild(el("h3", "p-title", esc(p.title)));
  const src = [];
  if (p.source) src.push(esc(p.source));
  if (p.url) src.push(`<a href="${esc(p.url)}" target="_blank" rel="noopener">鍘熸枃閾炬帴</a>`);
  if (src.length) card.appendChild(el("div", "src", "鏉ユ簮锛? + src.join(" 路 ")));
  const passage = el("div", "passage");
  passage.innerHTML = isDe ? tokenizeDe(p.text) : esc(p.text);
  if (isDe) passage.addEventListener("click", e => {
    const w = e.target.closest(".w"); if (!w) return;
    const sent = (w.parentNode.textContent.match(new RegExp("[^.!?]*" + w.textContent + "[^.!?]*[.!?]?")) || [""])[0];
    showEtym(w.textContent, sent.trim().slice(0, 300));
  });
  card.appendChild(passage);
  if (isDe) card.appendChild(el("div", "hint", "馃挕 鐐逛换浣曞崟璇嶆煡璇嶆簮璇嶆牴銆佸悓鏍硅瘝鏃忥紝涓€閿敹鍏ョ敓璇嶆湰銆?));

  if (res) renderFeedback(card, res, part);
  else {
    const draftKey = "draft:" + viewDate + ":" + part;
    const ta = document.createElement("textarea");
    ta.placeholder = isDe ? "鍦ㄦ杈撳叆浣犵殑姹夎璇戞枃鈥? : "Geben Sie hier Ihre deutsche 脺bersetzung ein 鈥?;
    try { ta.value = localStorage.getItem(draftKey) || ""; } catch (e) {}
    ta.addEventListener("input", () => { try { localStorage.setItem(draftKey, ta.value); } catch (e) {} });
    card.appendChild(ta);
    const btn = el("button", "btn", "鎻愪氦鎵规敼");
    btn.onclick = () => {
      const txt = ta.value.trim();
      if (txt.length < 20) { toast("璇戞枃澶煭锛岃瀹屾垚鍚庡啀鎻愪氦"); return; }
      grade(part, txt, card);
    };
    card.appendChild(btn);
    if (!isDe) {
      const ask = el("details", "", "<summary>缈昏瘧鍗′綇浜嗭紵闂竴涓嬫煇涓〃杈炬€庝箞璇?/summary>");
      const row = el("div", "colloc-row", '<input type="text" placeholder="渚嬪锛氶潪鐗╄川鏂囧寲閬椾骇 / 鍚屾瘮澧為暱 8%"><button class="btn small">闂?AI</button>');
      const out = el("div", "why"); out.hidden = true;
      row.querySelector("button").onclick = async () => {
        const q = row.querySelector("input").value.trim(); if (!q) return;
        out.hidden = false; out.innerHTML = '<span class="spin"></span>';
        try {
          out.textContent = await llm([{ role: "user", content: `涓枃琛ㄨ揪銆?{q}銆嶅湪姝ｅ紡寰疯锛堟柊闂?鏀垮簻鏂囦綋锛変腑鎬庝箞璇达紵缁?-2涓瘧娉曞苟鍚勯厤涓€涓緥鍙ワ紝绠€鐭洖绛斻€俙 }], { json: false, maxTokens: 500 });
        } catch (e) { out.textContent = e.message; }
      };
      ask.appendChild(row); ask.appendChild(out); card.appendChild(ask);
    }
  }
  return card;
}
function renderFeedback(card, fb, part) {
  const pass = fb.score >= 15;
  card.appendChild(el("div", "", "<b>浣犵殑璇戞枃</b>"));
  card.appendChild(el("div", "subtext", esc(fb.mine)));
  const sl = el("div", "score-line");
  sl.appendChild(el("span", "num " + (pass ? "pass" : "nopass"), fb.score + ' <span style="font-size:15px;font-weight:500">/ 25</span>'));
  card.appendChild(sl);
  (fb.deductions || []).forEach(d => {
    let h = `<span class="p">${d.p}</span><span class="t">[${esc(d.t)}]</span><span class="q">鈥?{esc(d.q)}鈥?/span><br>${esc(d.x)}`;
    if (d.fix) h += `<br><span class="fix">鉁?${esc(d.fix)}</span>`;
    card.appendChild(el("div", "ded", h));
  });
  if (!(fb.deductions || []).length) card.appendChild(el("p", "", "鏃犳墸鍒嗙偣锛岃瘧鏂囪川閲忓緢濂姐€?));
  if (fb.ref) {
    const det = el("details", "", "<summary>鍙傝€冭瘧鏂?/summary>");
    det.appendChild(el("div", "refbox", esc(fb.ref)));
    card.appendChild(det);
  }
  if (fb.sum) card.appendChild(el("div", "sum", "<b>鎬昏瘎</b>銆€" + esc(fb.sum)));
  if (fb.vocab && fb.vocab.length) {
    const vb = el("div", "sum", "<b>鏈瘒绉疮</b>銆€");
    fb.vocab.forEach(v => {
      const b = el("button", "btn small ghost", "锛?" + esc(v.de));
      b.style.margin = "3px 4px 3px 0";
      b.title = v.zh;
      b.onclick = () => { addVocab(v); b.disabled = true; b.textContent = "鉁?" + v.de; };
      vb.appendChild(b);
    });
    card.appendChild(vb);
  }
  const redo = el("button", "btn ghost", "娓呴櫎缁撴灉锛岄噸鏂扮粌涔?);
  redo.onclick = () => { delete progress.results[viewDate][part]; saveProgress(); render(); };
  card.appendChild(redo);
}

/* ============ 姣忔棩灏忓嵎 ============ */
function renderDrills() {
  root.innerHTML = "";
  if (!day || !day.drills || !(day.drills.mcq || []).length) { root.appendChild(el("div", "empty", "浠婃棩灏忓嵎灏氭湭鐢熸垚銆?)); return; }
  const stat = progress.drills[viewDate] || { answers: {}, colloc: {} };
  const card = el("div", "card");
  card.appendChild(el("div", "part-label", '<span class="kicker">Wortschatz-Quiz</span><h2>缁煎悎椋庢牸鍗曢€?路 10 棰?/h2>'));
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
  card2.appendChild(el("div", "part-label", '<span class="kicker">Kollokationen</span><h2>鍥哄畾鎼厤濉┖ 路 ' + (day.drills.colloc || []).length + " 棰?/h2>"));
  (day.drills.colloc || []).forEach((q, i) => {
    const done = stat.colloc[i];
    const box = el("div", "mcq", `<div class="qtext">${i + 1}. ${esc(q.q)}</div><div class="hint">${esc(q.hint || "")}</div>`);
    if (done) {
      box.appendChild(el("div", "why", (done.ok ? "鉁?姝ｇ‘ " : `鉁?浣犲～鐨勬槸銆?{esc(done.val)}銆嶏紝姝ｇ‘绛旀锛?b>${esc(q.ans)}</b>銆俙) + (q.why ? "<br>" + esc(q.why) : "")));
    } else {
      const row = el("div", "colloc-row", '<input type="text" placeholder="濉叆绛旀"><button class="btn small">妫€鏌?/button>');
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
  if (answeredN === total) card2.appendChild(el("div", "sum", `<b>鍗曢€夊緱鍒?${right}/${total}</b>銆€閿欓鑰冪偣寤鸿椤烘墜鏀跺叆鐢熻瘝鏈€俙));
  root.appendChild(card2);
}

/* ============ 澶嶄範锛堥棿闅旈噸澶嶏級 ============ */
function dueVocab() { const t = todayStr(); return progress.vocab.filter(v => (v.srs && v.srs.due || t) <= t); }
function updateDueDot() { const n = dueVocab().length; const d = $("#due-dot"); d.hidden = !n; d.textContent = n; }
function renderReview() {
  root.innerHTML = "";
  const queue = dueVocab();
  if (!queue.length) { root.appendChild(el("div", "empty", "浠婂ぉ娌℃湁鍒版湡鐨勭敓璇?馃帀<br>鍘诲仛浠婃棩缁冧範锛岀偣閫夌敓璇嶇户缁Н绱€?)); return; }
  let i = 0;
  const card = el("div", "card rev-card");
  root.appendChild(el("div", "hint", "鍒版湡 " + queue.length + " 璇嶃€傛寜璁板繂鎯呭喌鑷瘎锛岀郴缁熸寜闂撮殧閲嶅瀹夋帓涓嬫澶嶄範銆?));
  root.appendChild(card);
  function show() {
    if (i >= queue.length) { card.innerHTML = "<h2>鉁?浠婃棩澶嶄範瀹屾垚</h2>"; updateDueDot(); return; }
    const v = queue[i];
    card.innerHTML = `<div class="hint">${i + 1} / ${queue.length}</div><div class="front">${esc(v.de)}</div>
      <button class="btn" id="flip">鏄剧ず閲婁箟</button><div class="back" hidden></div>`;
    card.querySelector("#flip").onclick = () => {
      const back = card.querySelector(".back");
      back.hidden = false;
      back.innerHTML = `<div>${esc(v.zh)}</div>${v.root ? '<div class="hint">璇嶆牴锛? + esc(v.root) + "</div>" : ""}${v.note ? '<div class="hint">' + esc(v.note) + "</div>" : ""}
        <div class="rev-btns"><button class="btn again">涓嶄細</button><button class="btn hard">妯＄硦</button><button class="btn good">浼?/button></div>`;
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

/* ============ 鐢熻瘝鏈?============ */
function renderVocab() {
  root.innerHTML = "";
  const bar = el("div", "colloc-row", '<input type="text" id="vq" placeholder="鎼滅储鐢熻瘝 / 璇嶆牴 / 閲婁箟"><button class="btn small" id="vadd">锛?鎵嬪姩娣诲姞</button>');
  root.appendChild(bar);
  const listBox = el("div", "card");
  root.appendChild(listBox);
  function draw(q) {
    listBox.innerHTML = "";
    const items = progress.vocab.filter(v => !q || (v.de + v.zh + (v.root || "") + (v.note || "")).toLowerCase().includes(q.toLowerCase()));
    listBox.appendChild(el("div", "hint", "鍏?" + progress.vocab.length + " 璇? + (q ? "锛屽尮閰?" + items.length : "")));
    if (!items.length) { listBox.appendChild(el("div", "empty", "鐢熻瘝鏈负绌恒€傚幓浠婃棩缁冧範閲岀偣閫夊崟璇嶆敹璇嶅惂銆?)); return; }
    items.slice().reverse().forEach(v => {
      const r = el("div", "vrow",
        `<span class="de">${esc(v.de)}</span><span>${esc(v.zh)}</span>` +
        (v.root ? `<span class="root">${esc(v.root)}</span>` : "") +
        `<span class="date">${esc(v.addedAt || "")}</span><button class="del" title="鍒犻櫎">鉁?/button>`);
      if (v.note) r.title = v.note;
      r.querySelector(".del").onclick = () => {
        if (!confirm("鍒犻櫎銆? + v.de + "銆嶏紵")) return;
        progress.vocab = progress.vocab.filter(x => x !== v); saveProgress(); draw(q);
      };
      listBox.appendChild(r);
    });
  }
  bar.querySelector("#vq").addEventListener("input", e => draw(e.target.value.trim()));
  bar.querySelector("#vadd").onclick = () => {
    const de = prompt("寰疯锛堝悕璇嶅甫鍐犺瘝锛屽 die Nachhaltigkeit锛?); if (!de) return;
    const zh = prompt("涓枃閲婁箟") || "";
    addVocab({ de: de.trim(), zh: zh.trim(), root: "", note: "" }); draw("");
  };
  draw("");
}

/* ============ 鍘嗗彶 ============ */
function renderHistory() {
  root.innerHTML = "";
  const dates = (index && index.days) || [];
  if (!dates.length) { root.appendChild(el("div", "empty", "杩樻病鏈夌粌涔犺褰曘€?)); return; }
  const wrap = el("div", "tablewrap");
  const t = el("table", "", "<thead><tr><th>鏃ユ湡</th><th>寰疯瘧姹?/th><th>姹夎瘧寰?/th><th>灏忓嵎</th></tr></thead>");
  const tb = document.createElement("tbody");
  dates.forEach(d => {
    const r = progress.results[d] || {}, dr = progress.drills[d];
    const drillCell = dr && day ? Object.keys(dr.answers || {}).length + " 棰? : (dr ? Object.keys(dr.answers || {}).length + " 棰? : "鈥?);
    const tr = el("tr", "clickable",
      `<td class="n">${d}</td><td class="n">${r.de2zh ? r.de2zh.score + " / 25" : "鈥?}</td><td class="n">${r.zh2de ? r.zh2de.score + " / 25" : "鈥?}</td><td class="n">${drillCell}</td>`);
    tr.style.cursor = "pointer";
    tr.onclick = async () => { try { await loadDay(d); switchTab("today"); } catch (e) { toast("鍔犺浇澶辫触"); } };
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t); root.appendChild(wrap);
  const graded = dates.map(d => progress.results[d]).filter(Boolean);
  const scores = graded.flatMap(r => [r.de2zh, r.zh2de].filter(Boolean).map(f => f.score));
  if (scores.length) {
    const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
    root.appendChild(el("div", "hint", `宸叉壒鏀?${scores.length} 绡囷紝骞冲潎 ${avg} / 25锛堝強鏍肩嚎 15锛夈€俙));
  }
}

/* ============ 璁剧疆 ============ */
function renderSettings() {
  root.innerHTML = "";
  const card = el("div", "card");
  card.innerHTML = `
    <div class="part-label"><span class="kicker">API</span><h2>澶фā鍨嬫帴鍙ｏ紙OpenAI 鍏煎锛?/h2></div>
    <div class="field"><label>API 鍦板潃</label><input type="text" id="s-base" value="${esc(cfg.base)}" placeholder="https://api.deepseek.com"></div>
    <div class="field"><label>API Key</label><input type="password" id="s-key" value="${esc(cfg.key)}" placeholder="sk-鈥?></div>
    <div class="field"><label>妯″瀷鍚?/label><input type="text" id="s-model" value="${esc(cfg.model)}" placeholder="deepseek-v4-pro"></div>
    <button class="btn" id="s-save">淇濆瓨</button> <button class="btn ghost" id="s-test">娴嬭瘯杩炴帴</button>
    <div class="hint">Key 鍙繚瀛樺湪鏈満娴忚鍣紝涓嶄細涓婁紶鍒颁换浣曚粨搴撱€傛崲妯″瀷鍙渶鏀瑰湴鍧€鍜屾ā鍨嬪悕锛堝閫氫箟/鏈堜箣鏆楅潰/纭呭熀娴佸姩鍧囧吋瀹癸級銆?/div>`;
  root.appendChild(card);
  const card2 = el("div", "card");
  card2.innerHTML = `
    <div class="part-label"><span class="kicker">Sync</span><h2>璺ㄨ澶囦簯鍚屾锛堝彲閫夛級</h2></div>
    <p class="hint">鐢?GitHub 绉佸瘑 Gist 鍚屾鐢熻瘝鏈拰鎴愮哗锛堟墜鏈?鐢佃剳閫氱敤锛夈€傚埌 github.com/settings/tokens 鍒涘缓涓€涓彧鍕鹃€?<b>gist</b> 鏉冮檺鐨?token 濉叆鍗冲彲銆?/p>
    <div class="field"><label>GitHub Token锛堜粎 gist 鏉冮檺锛?/label><input type="password" id="s-gt" value="${esc(cfg.gistToken)}"></div>
    <div class="field"><label>Gist ID锛堢暀绌哄垯鑷姩鍒涘缓锛?/label><input type="text" id="s-gid" value="${esc(cfg.gistId)}"></div>
    <button class="btn" id="s-sync">鍚敤骞剁珛鍗冲悓姝?/button>
    <hr style="border:none;border-top:1px solid var(--line);margin:18px 0">
    <button class="btn ghost" id="s-exp">瀵煎嚭瀛︿範鏁版嵁</button> <button class="btn ghost" id="s-imp">瀵煎叆</button>`;
  root.appendChild(card2);
  card.querySelector("#s-save").onclick = () => {
    cfg.base = card.querySelector("#s-base").value.trim() || "https://api.deepseek.com";
    cfg.key = card.querySelector("#s-key").value.trim();
    cfg.model = card.querySelector("#s-model").value.trim() || "deepseek-chat";
    saveCfg(); toast("宸蹭繚瀛?);
  };
  card.querySelector("#s-test").onclick = async () => {
    card.querySelector("#s-save").click();
    try {
      const r = await llm([{ role: "user", content: '鍥炲 JSON {"ok":true}' }], { maxTokens: 20 });
      toast(r.ok ? "鉁?杩炴帴鎴愬姛锛屾ā鍨嬪彲鐢? : "杩炴帴鎴愬姛");
    } catch (e) { toast("鉁?" + e.message); }
  };
  card2.querySelector("#s-sync").onclick = async () => {
    cfg.gistToken = card2.querySelector("#s-gt").value.trim();
    cfg.gistId = card2.querySelector("#s-gid").value.trim();
    if (!cfg.gistToken) { toast("璇峰厛濉叆 token"); return; }
    try {
      if (!cfg.gistId) { await createGist(); toast("宸插垱寤虹瀵?Gist锛? + cfg.gistId); }
      else { await pullGist(); await pushGist(); toast("鉁?鍚屾瀹屾垚"); }
      saveCfg(); renderSettings();
    } catch (e) { toast("鉁?" + e.message); }
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
      f.text().then(t => { progress = JSON.parse(t); saveProgress(); toast("瀵煎叆鎴愬姛"); render(); }).catch(() => toast("鏂囦欢鏍煎紡閿欒"));
    };
    inp.click();
  };
}

/* ============ 妗嗘灦 ============ */
function switchTab(tab) { curTab = tab; render(); }
function render() {
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === curTab));
  closePanel();
  ({ today: renderToday, review: renderReview, drills: renderDrills, vocab: renderVocab, history: renderHistory, settings: renderSettings })[curTab]();
  updateDueDot();
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => switchTab(b.dataset.tab));

/* 杩炵画鎵撳崱锛氭湁浠绘剰鎵规敼鎴栧皬鍗疯褰曠殑鏃ユ湡绠楁墦鍗?*/
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
