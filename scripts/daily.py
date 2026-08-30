# -*- coding: utf-8 -*-
"""每日 CATTI 德语二笔训练材料生成器（在 GitHub Actions 中运行）。

流程：抓德语新闻 → DeepSeek 选段 + 生成汉译德段落 + 当日词汇小卷
     → 写入 data/YYYY-MM-DD.json → 发邮件推送。
"""
import html
import json
import os
import re
import smtplib
import sys
from datetime import datetime, timedelta, timezone
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formataddr

import requests

def env(key, default=""):
    """读取环境变量并去掉首尾空白和 BOM 等不可见字符（Windows 记事本粘贴常见）。"""
    return re.sub(r"[\s\ufeff\u200b\u00a0]+", "", os.environ.get(key) or default)


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
UA = {"User-Agent": "Mozilla/5.0 (compatible; catti-trainer/1.0)"}

THEMES = {0: "Politik", 1: "Wirtschaft", 2: "Gesellschaft",
          3: "Umwelt/Wissenschaft", 4: "Kultur", 5: "China-Themen", 6: "Panorama"}
THEME_KEYWORDS = {
    "Politik": ["inland", "ausland", "politik", "regierung", "wahl", "bundestag", "eu"],
    "Wirtschaft": ["wirtschaft", "inflation", "konjunktur", "unternehmen", "industrie", "export"],
    "Gesellschaft": ["gesellschaft", "inland", "bildung", "sozial", "arbeit", "migration"],
    "Umwelt/Wissenschaft": ["klima", "umwelt", "wissen", "energie", "forschung", "ki"],
    "Kultur": ["kultur", "film", "musik", "literatur", "museum", "theater"],
    "Panorama": [],
}


def strip_tags(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def word_count(text):
    return len(re.findall(r"[A-Za-zÄÖÜäöüß]+", text))


# ---------------------------------------------------------------- news sources

def fetch_tagesschau(theme):
    """Tagesschau JSON API：返回 [{title, url, text}]，全文干净无需解析 HTML。"""
    r = requests.get("https://www.tagesschau.de/api2u/homepage/", headers=UA, timeout=30)
    r.raise_for_status()
    items = [n for n in r.json().get("news", [])
             if n.get("type") == "story" and n.get("details")]
    keys = THEME_KEYWORDS.get(theme, [])

    def match(n):
        blob = " ".join([n.get("ressort") or "", n.get("topline") or "",
                         n.get("title") or ""] + (n.get("tags") and
                        [t.get("tag", "") for t in n["tags"]] or [])).lower()
        return any(k in blob for k in keys)

    ordered = ([n for n in items if match(n)] + [n for n in items if not match(n)])
    out = []
    for n in ordered[:8]:
        try:
            d = requests.get(n["details"], headers=UA, timeout=30).json()
            paras = [strip_tags(c.get("value", "")) for c in d.get("content", [])
                     if c.get("type") == "text"]
            text = "\n".join(p for p in paras if len(p) > 40)
            if word_count(text) >= 180:
                out.append({"title": n.get("title", ""),
                            "url": n.get("shareURL") or n.get("detailsweb", ""),
                            "source": "Tagesschau", "text": text})
        except Exception as e:
            print("tagesschau detail failed:", e)
        if len(out) >= 3:
            break
    return out


def fetch_dw(theme):
    """DW RSS 兜底：抓文章页并粗提取正文段落。"""
    r = requests.get("https://rss.dw.com/rdf/rss-de-all", headers=UA, timeout=30)
    r.raise_for_status()
    links = re.findall(r"<link>(https://www\.dw\.com/de/[^<]+)</link>", r.text)
    out = []
    for url in links[:10]:
        try:
            page = requests.get(url, headers=UA, timeout=30).text
            paras = [strip_tags(p) for p in re.findall(r"<p[^>]*>(.*?)</p>", page, re.S)]
            text = "\n".join(p for p in paras if len(p) > 60)
            m = re.search(r"<title>([^<]+)</title>", page)
            if word_count(text) >= 180:
                out.append({"title": strip_tags(m.group(1)) if m else url,
                            "url": url, "source": "Deutsche Welle", "text": text})
        except Exception as e:
            print("dw article failed:", e)
        if len(out) >= 3:
            break
    return out


def fetch_china_sources():
    """周六中国主题：人民网德语版 / 中国网德语版。"""
    out = []
    for base, name in [("http://german.people.com.cn", "人民网德语版"),
                       ("http://german.china.org.cn", "中国网德语版")]:
        try:
            home = requests.get(base, headers=UA, timeout=30)
            home.encoding = home.apparent_encoding
            hrefs = re.findall(r'href="([^"]+\.html?)"', home.text)
            seen = set()
            for h in hrefs:
                url = h if h.startswith("http") else base + ("" if h.startswith("/") else "/") + h
                if url in seen or not re.search(r"20\d\d", url):
                    continue
                seen.add(url)
                try:
                    page = requests.get(url, headers=UA, timeout=30)
                    page.encoding = page.apparent_encoding
                    paras = [strip_tags(p) for p in re.findall(r"<p[^>]*>(.*?)</p>", page.text, re.S)]
                    text = "\n".join(p for p in paras if len(p) > 60)
                    m = re.search(r"<title>([^<]+)</title>", page.text)
                    if word_count(text) >= 150:
                        out.append({"title": strip_tags(m.group(1)) if m else url,
                                    "url": url, "source": name, "text": text})
                except Exception:
                    pass
                if len(out) >= 3:
                    return out
        except Exception as e:
            print(name, "failed:", e)
    return out


# ---------------------------------------------------------------- deepseek

def deepseek(messages, api_key):
    r = requests.post(
        "https://api.deepseek.com/chat/completions",
        headers={"Authorization": "Bearer " + api_key},
        json={"model": env("DS_MODEL", "deepseek-chat"),
              "messages": messages,
              "response_format": {"type": "json_object"},
              "temperature": 0.6, "max_tokens": 6000},
        timeout=300)
    r.raise_for_status()
    return json.loads(r.json()["choices"][0]["message"]["content"])


PROMPT = """你是 CATTI 德语二级笔译备考出题人。今天的主题是「{theme}」。下面给你 {n} 篇真实德语新闻（JSON），请完成四项任务，只输出一个 JSON 对象：

1. pick: 选最适合做 CATTI 二笔德译汉练习的一篇，给出其下标（0 起）。
2. passage: 从该篇原文中逐字摘取一个 150-250 词、语义完整的连续片段（可跨相邻段落）。必须与原文逐字一致，不得改写、增删任何词。
3. zh2de: 围绕相近主题自拟一段 180-280 字汉语段落，文体对标 CATTI 汉译德真题（新闻通稿/政府工作报告/白皮书体，含数据或政策表述；若主题是 China-Themen 则写中国政治/经济/文化特色内容，如非遗、京剧、经贸数据等）。格式 {{"title": "...", "text": "..."}}。
4. drills: 基于该新闻的语言点和主题词场，出当日词汇小卷：
   - mcq: 10 道 CATTI 综合风格单选（同义词替换 / 介词搭配 / 功能动词结构 / 语法辨析各若干），格式 [{{"q":"题干(德语句子，空缺用___)","opts":["A","B","C","D"],"ans":0,"why":"汉语解析，含考点"}}]
   - colloc: 6 道固定搭配填空（Funktionsverbgefüge、名动搭配、介词搭配），格式 [{{"q":"含___的德语短句","ans":"答案词","hint":"汉语意思","why":"搭配讲解"}}]

新闻列表：
{articles}
"""


def normalize(s):
    return re.sub(r"\s+", " ", s or "").strip().lower()


def build_day(date_str, theme, api_key):
    if theme == "China-Themen":
        articles = fetch_china_sources()
        if not articles:
            articles = fetch_tagesschau("Panorama")
    else:
        try:
            articles = fetch_tagesschau(theme)
        except Exception as e:
            print("tagesschau failed:", e)
            articles = []
        if not articles:
            articles = fetch_dw(theme)
    if not articles:
        raise RuntimeError("no news source reachable")

    slim = [{"title": a["title"], "text": a["text"][:6000]} for a in articles]
    res = deepseek([
        {"role": "system", "content": "你是严谨的德语翻译考试出题人，只输出合法 JSON。"},
        {"role": "user", "content": PROMPT.format(
            theme=theme, n=len(slim), articles=json.dumps(slim, ensure_ascii=False))},
    ], api_key)

    idx = min(int(res.get("pick", 0)), len(articles) - 1)
    chosen = articles[idx]
    passage = (res.get("passage") or "").strip()
    # 逐字校验：模型摘取的段落必须真实存在于原文，否则程序化截取
    if normalize(passage) not in normalize(chosen["text"]) or word_count(passage) < 120:
        print("passage failed verbatim check, falling back to leading sentences")
        sents = re.split(r"(?<=[.!?»«])\s+", chosen["text"].replace("\n", " "))
        passage, wc = "", 0
        for s in sents:
            passage += s + " "
            wc = word_count(passage)
            if wc >= 170:
                break
        passage = passage.strip()

    zh = res.get("zh2de") or {}
    drills = res.get("drills") or {}
    return {
        "date": date_str, "theme": theme,
        "de2zh": {"title": chosen["title"], "source": chosen["source"],
                  "url": chosen["url"], "text": passage},
        "zh2de": {"title": zh.get("title", "汉译德练习"), "text": zh.get("text", "")},
        "drills": {"mcq": drills.get("mcq", []), "colloc": drills.get("colloc", [])},
    }


# ---------------------------------------------------------------- email

def send_mail(day, site_url):
    host = env("SMTP_HOST")
    user = env("SMTP_USER")
    pw = env("SMTP_PASS")
    to = env("MAIL_TO")
    if not all([host, user, pw, to]):
        print("SMTP not configured, skip mail")
        return
    port = int(env("SMTP_PORT", "465"))
    d = day["de2zh"]
    body = f"""<div style="max-width:640px;margin:auto;font-family:sans-serif;line-height:1.7">
<h2 style="border-bottom:3px double #235789;padding-bottom:8px">Übersetzungswerkstatt · {day['date']}</h2>
<p><b>今日主题：</b>{day['theme']} ｜ <a href="{site_url}">打开练习页 →</a></p>
<h3>Teil 1 · 德译汉（{word_count(d['text'])} 词）</h3>
<p style="color:#666">{html.escape(d['title'])} — {d['source']}</p>
<blockquote style="border-left:3px solid #235789;margin:0;padding:6px 14px;font-family:Georgia,serif">
{html.escape(d['text']).replace(chr(10), '<br>')}</blockquote>
<h3>Teil 2 · 汉译德</h3>
<blockquote style="border-left:3px solid #8a5a23;margin:0;padding:6px 14px">
{html.escape(day['zh2de']['text'])}</blockquote>
<p>另有 10 道综合单选 + 6 道搭配填空，翻译时可随时点词查<b>词源词根</b>。
先到<a href="{site_url}">练习页</a>复习到期生词，再开始今天的任务。Viel Erfolg!</p></div>"""
    msg = MIMEText(body, "html", "utf-8")
    msg["Subject"] = Header(f"【德语二笔 · {day['date']}】{day['theme']} · {d['title'][:40]}", "utf-8")
    msg["From"] = formataddr((str(Header("Übersetzungswerkstatt", "utf-8")), user))
    msg["To"] = to
    with smtplib.SMTP_SSL(host, port, timeout=60) as s:
        s.login(user, pw)
        s.sendmail(user, [to], msg.as_string())
    print("mail sent to", to)


# ---------------------------------------------------------------- main

def main():
    api_key = env("DEEPSEEK_API_KEY")
    if not api_key:
        sys.exit("DEEPSEEK_API_KEY missing")
    site_url = env("SITE_URL")

    now_bj = datetime.now(timezone.utc) + timedelta(hours=8)
    date_str = now_bj.strftime("%Y-%m-%d")
    out_path = os.path.join(DATA, date_str + ".json")
    if os.path.exists(out_path):
        print("today already generated, nothing to do")
        return

    theme = THEMES[now_bj.weekday()]
    day = build_day(date_str, theme, api_key)

    idx_path = os.path.join(DATA, "index.json")
    try:
        with open(idx_path, encoding="utf-8") as f:
            index = json.load(f)
    except Exception:
        index = {"exam": "2027-06-20", "days": []}
    if date_str not in index["days"]:
        index["days"].insert(0, date_str)
    day["issue"] = len(index["days"])

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(day, f, ensure_ascii=False, indent=1)
    with open(idx_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print("generated", out_path, "theme:", theme)

    try:
        send_mail(day, site_url)
    except Exception as e:
        print("mail failed:", e)  # 邮件失败不影响材料生成


if __name__ == "__main__":
    main()
