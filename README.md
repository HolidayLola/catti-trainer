# Übersetzungswerkstatt · CATTI 德语二级笔译每日训练

自动化备考系统：每天早上抓取德语新闻 → 生成当日训练材料 → 邮件推送 → 网页练习（AI 批改 / 词源讲解 / 生词间隔重复 / 综合小卷）。

## 架构

- **GitHub Actions**（`.github/workflows/daily.yml`）每天北京时间约 6:45 运行 `scripts/daily.py`：
  抓取 Tagesschau（主）/ DW（备）新闻，周六抓人民网/中国网德语版（中国主题），
  调 DeepSeek 选出 150–250 词德译汉段落、生成 CATTI 风格汉译德段落、10 道综合单选 + 6 道搭配填空，
  写入 `data/YYYY-MM-DD.json` 并发邮件。
- **GitHub Pages** 托管 `index.html` 练习页。
- 练习页在浏览器里直连你自己的大模型 API（OpenAI 兼容，默认 DeepSeek），批改、词源讲解都走你的 Key；Key 只存在本机浏览器。
- 学习记录（生词本/成绩）存浏览器 localStorage，可选用**私密 Gist** 跨设备同步——不会进入这个公开仓库。

## 首次配置

1. 仓库 Settings → Secrets and variables → Actions，添加：
   - `DEEPSEEK_API_KEY` — DeepSeek 平台的 API Key
   - `SMTP_HOST` — 如 `smtp.qq.com`
   - `SMTP_PORT` — `465`
   - `SMTP_USER` — 发信邮箱（如 `xxx@qq.com`）
   - `SMTP_PASS` — 邮箱 SMTP 授权码（QQ 邮箱：设置 → 账号 → 开启 SMTP → 生成授权码）
   - `MAIL_TO` — 收件邮箱
2. Settings → Pages → Source 选 `main` 分支根目录。
3. Actions 页手动运行一次 `daily-material` 验证。
4. 打开练习页 → 设置 → 填入 API Key。

## 训练法（针对综合 51 / 实务 39 的短板）

| 每天 | 动作 |
|---|---|
| ① 复习 | 先清掉到期生词（间隔重复队列） |
| ② 德译汉 | 读新闻段落，**点词查词源/同根词族**收词，翻译后 AI 扣分制批改 |
| ③ 汉译德 | 从第一天就练（上次考试空着的 50 分），卡壳用「问表达」 |
| ④ 小卷 | 10 单选 + 6 搭配，直击综合丢分点 |

每篇 25 分制，15 为及格线；错题和批改中收的词自动进入复习循环。

## 路线图

- [ ] 2027-03 起：每周一次 2+2 篇 180 分钟全真模考模式
- [ ] 回译训练（参考译文 → 回译 → 对照）
- [ ] 词根专题周报（按词族汇总本周生词）
