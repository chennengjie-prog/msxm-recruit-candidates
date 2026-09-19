# 联系方式 / 沟通反馈自动同步 —— 部署步骤

这套东西做完之后，招聘专员在网页上录入的**手机号**、以及"联系时间 + 简要反馈内容"，都会自动写进 GitHub 上的 `data/candidates.js` 并推送，所有人打开网站都能看到，不再是只存在自己电脑里。这两类录入共用同一个 Worker（两个接口 `/update-contact` 和 `/update-feedback`），只需要部署一次。

代码我已经写好了（`worker/index.js`），免费额度就够用，不需要付费。但里面有几步涉及账号密码/密钥，按照安全规则我不能替你输入这些内容，需要你自己在浏览器里操作，一共 15 分钟左右。做完后把**最后一步拿到的网址**发给我，我就能把网站接上。

---

## 第一步：给 Worker 一把"只能改这一个仓库"的 GitHub 钥匙

1. 打开 [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)（需要先登录）
2. **Token name** 填 `msxm-recruit-contact-sync`
3. **Expiration** 建议选 **No expiration**（不过期），或者选一年，到期了重新生成一个换上即可
4. **Repository access** 选 **Only select repositories**，下拉选择 `msxm-recruit-candidates`（只授权这一个仓库，出问题影响范围最小）
5. **Permissions** 展开 → 找到 **Contents** → 右侧选 **Read and write**（其他权限都不用动，保持 No access）
6. 拉到最下面点 **Generate token**
7. 页面会显示一长串以 `github_pat_` 开头的字符串——**这就是密钥，只会显示这一次**，先复制到一个安全的地方（比如密码管理器），等下第三步要用。**不要把它发给我或贴在聊天里**。

## 第二步：注册 Cloudflare 账号（免费）

1. 打开 [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)，用邮箱注册（不需要绑定信用卡）
2. 登录后进入控制台

## 第三步：创建 Worker 并粘贴代码

1. 左侧菜单找到 **Workers 和 Pages** → 点 **创建**（Create）
2. 选择 **创建 Worker**（不是 Pages），名字可以填 `msxm-recruit-contact-sync`，点 **部署**（Deploy，会先部署一个默认模板，没关系，下一步会替换代码）
3. 部署完成后点 **编辑代码**（Edit code），会打开一个在线代码编辑器
4. 把编辑器里默认的代码**全部删除**，打开本项目里的 [worker/index.js](worker/index.js) 文件，把里面的内容**全部复制粘贴**进去，替换掉
5. 点右上角 **部署**（Deploy）保存

## 第四步：设置两个密钥（Secrets）

回到这个 Worker 的管理页面（不是代码编辑器，是 Worker 主页）：

1. 找到 **设置**（Settings）→ **变量和机密**（Variables and Secrets）
2. 点 **添加**（Add），添加第一个：
   - 类型选 **Secret**（不是 Text，Secret 类型加密存储、页面上不会明文显示）
   - 变量名填 `GITHUB_TOKEN`
   - 值粘贴第一步拿到的那串 `github_pat_...` 密钥
3. 再点 **添加**，添加第二个：
   - 类型选 **Secret**
   - 变量名填 `TEAM_SECRET`
   - 值自己定一个口令，作为 3 位招聘专员共用的"门槛密码"（比如一个词组，不需要很复杂，但也别用"123456"这种），记住这个口令，之后要告诉陈彦汐、李祖荃、蔡家宝
4. 保存

## 第五步：拿到 Worker 网址，发给我

1. 回到 Worker 主页，顶部会显示一个网址，形如：
   ```
   https://msxm-recruit-contact-sync.你的用户名.workers.dev
   ```
2. 把这个网址**完整复制发给我**（这个网址本身不是秘密，可以直接发）

我拿到网址后会把它填进网站代码里、推送更新，之后你把第四步定的"团队口令"告诉三位招聘专员，她们第一次点"录入联系方式"时会被要求输入这个口令（只需输入一次，电脑会记住）。

---

## 之后怎么用

- 招聘专员在首页点"+ 录入联系方式"输入手机号，或点"+ 记录反馈"填写联系时间和简要反馈，保存后都会自动同步到 GitHub，几秒钟内所有人刷新网页就能看到（不再只存在自己电脑里）。
- 如果同步失败（比如网络问题、口令输错），内容依然会先保存在当前电脑本地，不会丢，页面会弹窗提示失败原因，可以重试。
- 如果你已经按早期版本部署过 Worker，之后又更新了 `worker/index.js`（比如这次加了"沟通反馈"功能），需要回到 Cloudflare Worker 的编辑代码页面，把新代码重新整份粘贴替换进去再点部署一次——密钥（Secrets）不受影响，不用重新设置。
- 如果某天想换掉团队口令，去 Cloudflare Worker 的 Settings → Variables and Secrets 里改 `TEAM_SECRET` 的值即可，不需要重新发布代码。
- 如果 GitHub 密钥意外泄露或想吊销，去 [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens) 找到 `msxm-recruit-contact-sync` 删除即可，仓库其他内容不受影响（这个密钥只能改这一个仓库）。
