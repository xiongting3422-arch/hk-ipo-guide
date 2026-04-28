# 组织 GitHub Pages 根域名重定向

网站**正式地址**是项目 Pages：  
**https://xiongting3422-arch.github.io/hk-ipo-guide/**

只访问 `https://xiongting3422-arch.github.io`（没有后面的路径）时，默认**不会**打开 `hk-ipo-guide` 项目，需要单独为组织建一个「根站」仓库；本包用于在**根域名**做 302/刷新到上面正式地址。

## 一次性部署（在 GitHub 上）

1. 在组织 **xiongting3422-arch** 下**新建**仓库，名称**必须**为：  
   **`xiongting3422-arch.github.io`**

2. 把**本包内**的 `index.html`（和本说明）提交到该仓库的 **`main` 根目录**。

3. **Settings → Pages** → 选 **Branch: main**、**/ (root)** → **Save**。

4. 等约 1 分钟后，打开 `https://xiongting3422-arch.github.io` 会跳转到打新指南。

## 若仍出现 ERR_CONNECTION_CLOSED

说明当前网络在访问 `*.github.io` 时 TLS/连接被中断（与代码无关）。可换 4G/5G、关闭代理后重试，或直接使用：  
**https://xiongting3422-arch.github.io/hk-ipo-guide/**
