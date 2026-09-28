# 东方太极养生堂邀请函

- 公开邀请函：`index.html`
- 专属邀请链接生成器：`manage.html`
- 线上网址：<https://immort-magic.github.io/dongfang-taiji-invitation/>

## 专属链接

`manage.html` 在浏览器本机保存被邀请人名单，并生成包含 `guest`、`suffix` 和 `invite` 参数的网址。名单不会提交到 GitHub。

## 决策记录

- 2026-09-28：新增独立的链接管理页，不在公开邀请函中显示管理入口，避免访客误入。
- 名单仅保存在管理者的浏览器本地；回滚时删除 `manage.html` 即可，不需要数据迁移。
- 赴约记录将在确认飞书表格类型和字段后接入，不在前端代码中暴露飞书应用密钥。
