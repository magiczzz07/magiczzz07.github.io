/* MagicZ OTA Workbench Controller (Strix Hardened - Zero innerHTML, Zero-Knowledge UDID Hash, ContentShield) */
(function () {
  "use strict";

  const CHUNK_SIZE = 20 * 1024 * 1024;
  const GH_OWNER = "magiczzz07";
  const GH_REPO = "magiczzz07.github.io";
  const SITE_ORIGIN = "https://magiczzz07.github.io";

  const STORE_KEYS = {
    server: "magicz_server_url",
    pin: "magicz_server_pin",
    ghToken: "magicz_gh_token"
  };

  const state = {
    serverUrl: "",
    serverOnline: false,
    apps: [],
    pendingMeta: null
  };

  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function isIOSDevice() {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isBlockedInAppBrowser() {
    const ua = navigator.userAgent || "";
    return isIOSDevice() && /FBAN|FBAV|Zalo|Line\/|Instagram|Telegram|MicroMessenger|CriOS|FxiOS|EdgiOS/i.test(ua);
  }

  function escapeXml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isSafeItmsUrl(url) {
    return typeof url === "string" && /^itms-services:\/\/\?action=download-manifest&url=https(%3A|:)/i.test(url);
  }

  function isSafeHttpsOrLocal(url) {
    if (!url || typeof url !== "string") return false;
    try {
      const u = new URL(url);
      if (u.protocol === "https:") return true;
      if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return "Direct HTTPS";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function normalizeDropboxOrDrive(rawUrl) {
    const trimmed = rawUrl.trim();
    try {
      const u = new URL(trimmed);
      const host = u.hostname.toLowerCase();
      if (host === "www.dropbox.com" || host === "dropbox.com") {
        u.hostname = "dl.dropboxusercontent.com";
        u.searchParams.delete("dl");
        u.searchParams.set("raw", "1");
        return u.toString();
      }
      if (host.includes("drive.google.com")) {
        const m = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        const gid = m ? m[1] : u.searchParams.get("id");
        if (gid) {
          return "https://drive.usercontent.google.com/download?id=" + encodeURIComponent(gid) + "&export=download&confirm=t";
        }
      }
      return u.toString();
    } catch (_) {
      return trimmed;
    }
  }

  function randomHex16() {
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function buildManifestXml(ipaUrl, bundleId, version, title) {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      "<dict>",
      "  <key>items</key>",
      "  <array>",
      "    <dict>",
      "      <key>assets</key>",
      "      <array>",
      "        <dict>",
      "          <key>kind</key>",
      "          <string>software-package</string>",
      "          <key>url</key>",
      "          <string>" + escapeXml(ipaUrl) + "</string>",
      "        </dict>",
      "      </array>",
      "      <key>metadata</key>",
      "      <dict>",
      "        <key>bundle-identifier</key>",
      "        <string>" + escapeXml(bundleId) + "</string>",
      "        <key>bundle-version</key>",
      "        <string>" + escapeXml(version || "1.0") + "</string>",
      "        <key>kind</key>",
      "        <string>software</string>",
      "        <key>title</key>",
      "        <string>" + escapeXml(title || "App") + "</string>",
      "      </dict>",
      "    </dict>",
      "  </array>",
      "</dict>",
      "</plist>"
    ].join("\n");
  }

  function getStored(key) {
    try {
      return (localStorage.getItem(key) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function setStored(key, val) {
    try {
      if (val) localStorage.setItem(key, val.trim());
      else localStorage.removeItem(key);
    } catch (_) {}
  }

  function importCredentialsFromLocation() {
    let changed = false;
    if (window.location.hash && window.location.hash.length > 1) {
      const hp = new URLSearchParams(window.location.hash.slice(1));
      const hs = hp.get("server") || hp.get("s");
      const hpin = hp.get("pin");
      if (hs && isSafeHttpsOrLocal(hs)) {
        setStored(STORE_KEYS.server, hs.replace(/\/+$/, ""));
        changed = true;
      }
      if (hpin) {
        setStored(STORE_KEYS.pin, hpin);
        changed = true;
      }
    }
    const qp = new URLSearchParams(window.location.search);
    const qsServer = qp.get("server") || qp.get("s");
    if (qsServer && isSafeHttpsOrLocal(qsServer)) {
      setStored(STORE_KEYS.server, qsServer.replace(/\/+$/, ""));
      changed = true;
    }
    if (changed) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }

  async function probeServer(url) {
    if (!isSafeHttpsOrLocal(url)) return null;
    const clean = url.replace(/\/+$/, "");
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4500);
      const res = await fetch(clean + "/apps", { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.ok) {
        return { url: clean, apps: Array.isArray(data.apps) ? data.apps : [] };
      }
    } catch (_) {}
    return null;
  }

  async function loadCatalogJson(path) {
    try {
      const res = await fetch(path + "?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  async function discoverAndLoad() {
    importCredentialsFromLocation();

    const candidates = [];
    const saved = getStored(STORE_KEYS.server);
    if (saved) candidates.push(saved);

    const liveJson = await loadCatalogJson("ota/live.json");
    if (liveJson && liveJson.server && isSafeHttpsOrLocal(liveJson.server) && !candidates.includes(liveJson.server)) {
      candidates.push(liveJson.server);
    }

    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      candidates.push("http://localhost:8686");
    }

    let connected = null;
    for (const c of candidates) {
      const hit = await probeServer(c);
      if (hit) {
        connected = hit;
        break;
      }
    }

    const catalogJson = await loadCatalogJson("ota/catalog.json");
    const ghApps = catalogJson && Array.isArray(catalogJson.apps) ? catalogJson.apps : [];

    if (connected) {
      state.serverUrl = connected.url;
      state.serverOnline = true;
      setStored(STORE_KEYS.server, connected.url);
      const trap = $("honeypot-link");
      if (trap) trap.setAttribute("href", connected.url + "/api/internal/trap");
      const ids = new Set(connected.apps.map((a) => a.id));
      state.apps = connected.apps.concat(ghApps.filter((a) => !ids.has(a.id)));
    } else {
      state.serverUrl = saved || (liveJson && liveJson.server) || "";
      state.serverOnline = false;
      const livApps = liveJson && Array.isArray(liveJson.apps) ? liveJson.apps : [];
      const ids = new Set(livApps.map((a) => a.id));
      state.apps = livApps.concat(ghApps.filter((a) => !ids.has(a.id)));
    }

    updateConnectionBadge();
    renderAppList();
  }

  function updateConnectionBadge() {
    const btn = $("btn-settings");
    const pullWrap = $("pull-check-wrap");
    const ghToken = getStored(STORE_KEYS.ghToken);
    if (state.serverOnline) {
      btn.textContent = "Máy chủ sẵn sàng";
      if (pullWrap) pullWrap.classList.remove("is-hidden");
    } else if (ghToken) {
      btn.textContent = "Chế độ GitHub API";
      if (pullWrap) pullWrap.classList.add("is-hidden");
    } else {
      btn.textContent = "Kết nối máy chủ";
    }
  }

  function buildAppRowDom(a) {
    const li = el("li", "app-row");
    const main = el("div", "app-main");
    const info = el("div", "app-info");
    const nameRow = el("div", "app-name-row");
    nameRow.appendChild(el("span", "app-name", a.name || "App"));

    const p = a.provision;
    const specs = el("div", "app-specs");
    specs.appendChild(el("span", "mono", a.bundle_id || ""));
    const verLabel = "v" + String(a.version || "1.0") + (a.build && a.build !== a.version ? " (" + String(a.build) + ")" : "");
    specs.appendChild(el("span", "num", verLabel));
    specs.appendChild(el("span", "num", formatSize(a.size)));

    if (p) {
      const bad = Boolean(p.expired || p.kind === "App Store");
      nameRow.appendChild(el("span", "tag " + (bad ? "tag-warn" : "tag-ok"), p.expired ? "Hết hạn" : p.kind || "Signed"));
      if (p.team) specs.appendChild(el("span", "", p.team));
      const uCount = typeof p.udid_count === "number" ? p.udid_count : Array.isArray(p.udid_hashes) ? p.udid_hashes.length : 0;
      specs.appendChild(el("span", "num", uCount + " UDID"));
      if (p.expires) specs.appendChild(el("span", "num", "HSD " + p.expires));
    } else {
      nameRow.appendChild(el("span", "tag", a.source === "github" ? "GitHub OTA" : "Direct OTA"));
    }

    info.appendChild(nameRow);
    info.appendChild(specs);

    const actions = el("div", "app-actions");
    if (isSafeItmsUrl(a.itms_url)) {
      const installLink = el("a", "btn btn-primary", "Install");
      installLink.setAttribute("href", a.itms_url);
      actions.appendChild(installLink);
    }

    const shareUrl = isSafeHttpsOrLocal(a.page_url) ? a.page_url : SITE_ORIGIN;
    const qrBtn = el("button", "btn btn-ghost", "QR");
    qrBtn.type = "button";
    qrBtn.addEventListener("click", () => openQrModal(shareUrl, a.name));
    actions.appendChild(qrBtn);

    if (isSafeItmsUrl(a.itms_url)) {
      const copyBtn = el("button", "btn btn-ghost", "Copy");
      copyBtn.type = "button";
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(a.itms_url).then(() => {
          copyBtn.textContent = "Đã copy";
          setTimeout(() => {
            copyBtn.textContent = "Copy";
          }, 1400);
        });
      });
      actions.appendChild(copyBtn);
    }

    const delBtn = el("button", "btn btn-ghost", "Xóa");
    delBtn.type = "button";
    delBtn.addEventListener("click", () => deleteApp(a.id, a.source || "server"));
    actions.appendChild(delBtn);

    main.appendChild(info);
    main.appendChild(actions);
    li.appendChild(main);

    if (p && Array.isArray(p.udid_hashes) && p.udid_hashes.length > 0) {
      const details = el("details", "udid-details");
      details.appendChild(el("summary", "", "Kiểm tra UDID bảo mật SHA-256 (" + p.udid_hashes.length + " thiết bị)"));
      const box = el("div", "udid-box");
      const inp = el("input", "input input-sm mono");
      inp.type = "text";
      inp.placeholder = "Dán mã UDID thiết bị vào đây để đối chiếu";
      const resultLine = el("div", "status-line", "");
      const hashSet = new Set(p.udid_hashes);
      inp.addEventListener("input", async () => {
        const val = inp.value.trim();
        if (!val) {
          setStatus(resultLine, "", "");
          return;
        }
        const h = await window.MagicZIpaParser.sha256Hex16(val);
        if (hashSet.has(h)) {
          setStatus(resultLine, "Khớp: UDID này đã được cấp quyền trong bản dựng", "ok");
        } else {
          setStatus(resultLine, "Không tìm thấy UDID này trong danh sách chứng chỉ", "error");
        }
      });
      box.appendChild(inp);
      box.appendChild(resultLine);
      details.appendChild(box);
      li.appendChild(details);
    }

    return li;
  }

  function renderAppList() {
    const listEl = $("app-list");
    const emptyEl = $("empty-state");
    const countEl = $("app-count");

    countEl.textContent = state.apps.length + " bản dựng";
    listEl.replaceChildren();
    if (!state.apps.length) {
      emptyEl.classList.remove("is-hidden");
      return;
    }
    emptyEl.classList.add("is-hidden");
    const frag = document.createDocumentFragment();
    state.apps.forEach((a) => frag.appendChild(buildAppRowDom(a)));
    listEl.appendChild(frag);
  }

  function renderParsedPreview(meta, fileSize) {
    const preview = $("parsed-preview");
    preview.replaceChildren();
    if (!meta) {
      preview.classList.remove("is-visible");
      return;
    }
    const line1 = el("div", "");
    line1.appendChild(el("strong", "", meta.name));
    line1.appendChild(document.createTextNode(" - v" + meta.version + " (" + formatSize(fileSize) + ")"));
    const line2 = el("div", "mono", meta.bundle_id);
    const provText = meta.provision
      ? meta.provision.kind +
        " - " +
        (meta.provision.team || "") +
        " - " +
        meta.provision.udid_count +
        " UDID" +
        (meta.provision.expires ? " (HSD " + meta.provision.expires + ")" : "")
      : "Không kèm mobileprovision";
    const line3 = el("div", "", provText);
    preview.appendChild(line1);
    preview.appendChild(line2);
    preview.appendChild(line3);
    preview.classList.add("is-visible");
  }

  function setProgress(elWrap, elFill, ratio) {
    if (ratio === null) {
      elWrap.classList.remove("is-visible");
      elFill.style.transform = "scaleX(0)";
      return;
    }
    elWrap.classList.add("is-visible");
    const clamped = Math.max(0, Math.min(1, ratio));
    elFill.style.transform = "scaleX(" + clamped.toFixed(4) + ")";
  }

  function setStatus(elNode, msg, kind) {
    elNode.textContent = msg || "";
    elNode.className = "status-line" + (kind === "error" ? " is-error" : kind === "ok" ? " is-ok" : "");
  }

  function sendChunkXhr(url, blob, pin, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      if (pin) xhr.setRequestHeader("X-Pin", pin);
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) onProgress(ev.loaded);
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
        else reject(new Error(xhr.responseText || "HTTP " + xhr.status));
      };
      xhr.onerror = () => reject(new Error("Không kết nối được máy chủ upload"));
      xhr.send(blob);
    });
  }

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    const parts = [];
    for (let i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return btoa(parts.join(""));
  }

  async function ghPutFile(token, path, base64Content, message) {
    const api = "https://api.github.com/repos/" + GH_OWNER + "/" + GH_REPO + "/contents/" + path;
    const headers = {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    };
    let sha = undefined;
    const check = await fetch(api, { headers });
    if (check.ok) {
      const existing = await check.json();
      sha = existing.sha;
    }
    const body = { message, content: base64Content };
    if (sha) body.sha = sha;
    const put = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
    if (!put.ok) {
      const errText = await put.text();
      throw new Error("GitHub API (" + put.status + "): " + errText.slice(0, 140));
    }
    return await put.json();
  }

  async function publishToGitHubCatalog(token, appEntry, manifestXml, ipaFile) {
    const id = appEntry.id;
    if (ipaFile) {
      const buf = await ipaFile.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      await ghPutFile(token, "ota/packages/" + id + ".ipa", b64, "chore(ota): upload ipa " + id);
      appEntry.ipa_url = SITE_ORIGIN + "/ota/packages/" + id + ".ipa";
    }
    const plistBytes = new TextEncoder().encode(manifestXml);
    await ghPutFile(token, "ota/manifests/" + id + ".plist", arrayBufferToBase64(plistBytes.buffer), "chore(ota): manifest " + id);

    const current = (await loadCatalogJson("ota/catalog.json")) || { apps: [] };
    const filtered = (current.apps || []).filter((x) => x.id !== id);
    filtered.unshift(appEntry);
    const catBytes = new TextEncoder().encode(JSON.stringify({ updated_at: Math.floor(Date.now() / 1000), apps: filtered }, null, 2));
    await ghPutFile(token, "ota/catalog.json", arrayBufferToBase64(catBytes.buffer), "chore(ota): update catalog");
  }

  async function handleFilesSelected(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.name.toLowerCase().endsWith(".ipa"));
    const st = $("upload-status");
    const pw = $("upload-progress-wrap");
    const pf = $("upload-progress-fill");

    if (!files.length) {
      setStatus(st, "Vui lòng chọn file có đuôi .ipa", "error");
      return;
    }

    const file = files[0];
    setStatus(st, "Đang kiểm tra cấu trúc IPA trên trình duyệt...", "");
    let localMeta = null;
    try {
      localMeta = await window.MagicZIpaParser.inspectIpaFile(file);
      if (localMeta) {
        state.pendingMeta = localMeta;
        renderParsedPreview(localMeta, file.size);
      }
    } catch (err) {
      renderParsedPreview(null, 0);
      setStatus(st, err.message, "error");
      return;
    }

    const pin = getStored(STORE_KEYS.pin);
    const ghToken = getStored(STORE_KEYS.ghToken);

    if (state.serverOnline && state.serverUrl) {
      if (!pin) {
        openSettingsModal();
        setStatus(st, "Nhập mã PIN quản trị của máy chủ MagicZ để tải file lên", "error");
        return;
      }
      try {
        const uid = randomHex16();
        const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
        setProgress(pw, pf, 0.02);

        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(file.size, (i + 1) * CHUNK_SIZE);
          const slice = file.slice(start, end);
          await sendChunkXhr(
            state.serverUrl + "/upload/chunk?uid=" + uid + "&idx=" + i,
            slice,
            pin,
            (loadedInChunk) => {
              const overall = (start + loadedInChunk) / file.size;
              setProgress(pw, pf, overall);
              setStatus(st, "Đang tải lên máy chủ: " + Math.round(overall * 100) + "% (" + formatSize(start + loadedInChunk) + " / " + formatSize(file.size) + ")", "");
            }
          );
        }

        setStatus(st, "Đang khởi tạo manifest OTA...", "");
        const rawRes = await sendChunkXhr(
          state.serverUrl + "/upload/finish?uid=" + uid,
          new Blob([]),
          pin,
          null
        );
        const created = JSON.parse(rawRes);
        setProgress(pw, pf, 1);
        setStatus(st, "Đã sẵn sàng cài đặt: " + created.name, "ok");
        await discoverAndLoad();
        if (isIOSDevice() && !isBlockedInAppBrowser() && isSafeItmsUrl(created.itms_url)) {
          window.location.href = created.itms_url;
        }
        return;
      } catch (err) {
        setProgress(pw, pf, null);
        setStatus(st, "Lỗi tải lên máy chủ: " + err.message, "error");
        return;
      }
    }

    if (ghToken && localMeta) {
      if (file.size > 72 * 1024 * 1024) {
        setStatus(st, "File trên 72 MB: hãy bật máy chủ MagicZ hoặc tải file lên Dropbox rồi dán link sang tab bên cạnh", "error");
        return;
      }
      try {
        setProgress(pw, pf, 0.35);
        setStatus(st, "Đang đẩy IPA và manifest lên GitHub Pages...", "");
        const id = randomHex16();
        const ipaUrl = SITE_ORIGIN + "/ota/packages/" + id + ".ipa";
        const manifestUrl = SITE_ORIGIN + "/ota/manifests/" + id + ".plist";
        const itms = "itms-services://?action=download-manifest&url=" + encodeURIComponent(manifestUrl);
        const xml = buildManifestXml(ipaUrl, localMeta.bundle_id, localMeta.version, localMeta.name);
        const entry = {
          id: id,
          name: localMeta.name,
          bundle_id: localMeta.bundle_id,
          version: localMeta.version,
          build: localMeta.build,
          size: file.size,
          source: "github",
          manifest_url: manifestUrl,
          itms_url: itms,
          page_url: SITE_ORIGIN,
          provision: localMeta.provision
        };
        await publishToGitHubCatalog(ghToken, entry, xml, file);
        setProgress(pw, pf, 1);
        setStatus(st, "Đã đẩy lên GitHub Pages. Đợi khoảng 20 giây để CDN đồng bộ rồi bấm Install", "ok");
        state.apps.unshift(entry);
        renderAppList();
      } catch (err) {
        setProgress(pw, pf, null);
        setStatus(st, err.message, "error");
      }
      return;
    }

    openSettingsModal();
    setStatus(st, "Hãy mở từ link quản trị CAI_IPA.bat hoặc nhập mã PIN / GitHub Token", "error");
  }

  async function handleRemoteSubmit(ev) {
    ev.preventDefault();
    const rawUrl = $("remote-url").value.trim();
    const bundleId = $("remote-bid").value.trim();
    const appName = $("remote-name").value.trim();
    const pullViaServer = $("remote-pull").checked;
    const st = $("remote-status");
    const pw = $("remote-progress-wrap");
    const pf = $("remote-progress-fill");

    if (!rawUrl || !rawUrl.toLowerCase().startsWith("https://")) {
      setStatus(st, "Chỉ chấp nhận đường dẫn bắt đầu bằng https://", "error");
      return;
    }

    const pin = getStored(STORE_KEYS.pin);
    const ghToken = getStored(STORE_KEYS.ghToken);

    if (state.serverOnline && state.serverUrl) {
      if (!pin) {
        openSettingsModal();
        setStatus(st, "Nhập mã PIN quản trị của máy chủ MagicZ trước khi kéo file", "error");
        return;
      }
      try {
        setProgress(pw, pf, 0.05);
        setStatus(st, pullViaServer ? "Máy chủ đang kiểm tra bảo mật SSRF và tải file IPA về..." : "Đang kiểm tra link và tạo manifest...", "");
        const res = await fetch(state.serverUrl + "/remote", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Pin": pin },
          body: JSON.stringify({ url: rawUrl, bundle_id: bundleId, name: appName, pull: pullViaServer })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        if (res.status === 202 && data.id) {
          const jobId = data.id;
          while (true) {
            await new Promise((r) => setTimeout(r, 900));
            const jr = await fetch(state.serverUrl + "/remote/status?job=" + encodeURIComponent(jobId), {
              headers: { "X-Pin": pin },
              cache: "no-store"
            });
            if (!jr.ok) throw new Error("Mất kết nối tiến trình tải");
            const job = await jr.json();
            if (job.state === "error") throw new Error(job.error || "Tải file thất bại");
            if (job.state === "done" && job.app) {
              setProgress(pw, pf, 1);
              setStatus(st, "Máy chủ đã tải xong: " + job.app.name, "ok");
              $("remote-url").value = "";
              await discoverAndLoad();
              if (isIOSDevice() && !isBlockedInAppBrowser() && isSafeItmsUrl(job.app.itms_url)) {
                window.location.href = job.app.itms_url;
              }
              return;
            }
            if (job.total > 0) {
              const r = job.downloaded / job.total;
              setProgress(pw, pf, r);
              setStatus(st, "Máy chủ đang tải về: " + Math.round(r * 100) + "% (" + formatSize(job.downloaded) + " / " + formatSize(job.total) + ")", "");
            } else {
              setStatus(st, "Máy chủ đang tải về: " + formatSize(job.downloaded), "");
            }
          }
        } else {
          setProgress(pw, pf, 1);
          setStatus(st, "Đã tạo link cài đặt: " + data.name, "ok");
          $("remote-url").value = "";
          await discoverAndLoad();
          if (isIOSDevice() && !isBlockedInAppBrowser() && isSafeItmsUrl(data.itms_url)) {
            window.location.href = data.itms_url;
          }
          return;
        }
      } catch (err) {
        setProgress(pw, pf, null);
        setStatus(st, err.message, "error");
        return;
      }
    }

    if (ghToken) {
      const directUrl = normalizeDropboxOrDrive(rawUrl);
      const finalBid = bundleId || (state.pendingMeta && state.pendingMeta.bundle_id) || "";
      const finalName = appName || (state.pendingMeta && state.pendingMeta.name) || "MagicZ App";
      const finalVer = (state.pendingMeta && state.pendingMeta.version) || "1.0";
      if (!/^[A-Za-z0-9.-]{2,160}$/.test(finalBid)) {
        setStatus(st, "Khi tắt máy chủ, hãy điền Bundle ID hợp lệ (hoặc chọn file .ipa ở tab bên cạnh để tự đọc Bundle ID)", "error");
        return;
      }
      try {
        setProgress(pw, pf, 0.5);
        setStatus(st, "Đang tạo manifest.plist trên GitHub Pages...", "");
        const id = randomHex16();
        const manifestUrl = SITE_ORIGIN + "/ota/manifests/" + id + ".plist";
        const itms = "itms-services://?action=download-manifest&url=" + encodeURIComponent(manifestUrl);
        const xml = buildManifestXml(directUrl, finalBid, finalVer, finalName);
        const entry = {
          id: id,
          name: finalName,
          bundle_id: finalBid,
          version: finalVer,
          size: 0,
          source: "github",
          ipa_url: directUrl,
          manifest_url: manifestUrl,
          itms_url: itms,
          page_url: SITE_ORIGIN,
          provision: state.pendingMeta ? state.pendingMeta.provision : null
        };
        await publishToGitHubCatalog(ghToken, entry, xml, null);
        setProgress(pw, pf, 1);
        setStatus(st, "Đã tạo xong. Chờ khoảng 20 giây để GitHub Pages đồng bộ rồi bấm Install", "ok");
        $("remote-url").value = "";
        state.apps.unshift(entry);
        renderAppList();
      } catch (err) {
        setProgress(pw, pf, null);
        setStatus(st, err.message, "error");
      }
      return;
    }

    openSettingsModal();
    setStatus(st, "Hãy kết nối máy chủ MagicZ hoặc nhập GitHub Token", "error");
  }

  async function deleteApp(id, source) {
    if (!window.confirm("Xóa bản dựng IPA này khỏi danh sách?")) return;
    const pin = getStored(STORE_KEYS.pin);
    if (source !== "github" && state.serverOnline && state.serverUrl) {
      if (!pin) {
        openSettingsModal();
        return;
      }
      const r = await fetch(state.serverUrl + "/a/" + encodeURIComponent(id), {
        method: "DELETE",
        headers: { "X-Pin": pin }
      });
      if (!r.ok) {
        window.alert(await r.text());
        return;
      }
      await discoverAndLoad();
      return;
    }
    const ghToken = getStored(STORE_KEYS.ghToken);
    if (ghToken) {
      try {
        const current = (await loadCatalogJson("ota/catalog.json")) || { apps: [] };
        const next = (current.apps || []).filter((x) => x.id !== id);
        const catBytes = new TextEncoder().encode(JSON.stringify({ updated_at: Math.floor(Date.now() / 1000), apps: next }, null, 2));
        await ghPutFile(ghToken, "ota/catalog.json", arrayBufferToBase64(catBytes.buffer), "chore(ota): remove " + id);
        state.apps = state.apps.filter((x) => x.id !== id);
        renderAppList();
      } catch (err) {
        window.alert(err.message);
      }
    }
  }

  function openSettingsModal() {
    $("cfg-server").value = getStored(STORE_KEYS.server) || state.serverUrl || "";
    $("cfg-pin").value = getStored(STORE_KEYS.pin);
    $("cfg-gh-token").value = getStored(STORE_KEYS.ghToken);
    $("modal-settings").classList.add("is-open");
  }

  function openQrModal(url, title) {
    $("qr-title").textContent = title || "Quét mã QR bằng Camera iPhone";
    $("qr-img").src = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=" + encodeURIComponent(url);
    $("qr-link").textContent = url;
    $("modal-qr").classList.add("is-open");
  }

  /* Strix ContentShield: Anti-Copy / Anti-Scraper DOM Protection (allows normal form inputs) */
  function activateStrixContentShield() {
    document.body.classList.add("content-shield");
    const isEditable = (target) => Boolean(target && target.closest && target.closest("input, textarea"));

    document.addEventListener("contextmenu", (e) => {
      if (!isEditable(e.target)) e.preventDefault();
    });

    document.addEventListener("copy", (e) => {
      if (!isEditable(e.target)) e.preventDefault();
    });

    document.addEventListener("keydown", (e) => {
      if (!isEditable(e.target) && (e.ctrlKey || e.metaKey) && ["u", "s"].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    });
  }

  function bindEvents() {
    activateStrixContentShield();

    if (isBlockedInAppBrowser()) {
      $("safari-alert").classList.add("is-visible");
    }

    const tabFile = $("tab-file");
    const tabLink = $("tab-link");
    const paneFile = $("pane-file");
    const paneLink = $("pane-link");

    tabFile.addEventListener("click", () => {
      tabFile.classList.add("is-active");
      tabLink.classList.remove("is-active");
      paneFile.classList.remove("is-hidden");
      paneLink.classList.add("is-hidden");
    });

    tabLink.addEventListener("click", () => {
      tabLink.classList.add("is-active");
      tabFile.classList.remove("is-active");
      paneLink.classList.remove("is-hidden");
      paneFile.classList.add("is-hidden");
    });

    const dz = $("dropzone");
    const fileInput = $("file-input");
    fileInput.addEventListener("change", (e) => handleFilesSelected(e.target.files));
    ["dragenter", "dragover"].forEach((evName) => {
      dz.addEventListener(evName, (e) => {
        e.preventDefault();
        dz.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach((evName) => {
      dz.addEventListener(evName, (e) => {
        e.preventDefault();
        dz.classList.remove("is-dragover");
      });
    });
    dz.addEventListener("drop", (e) => handleFilesSelected(e.dataTransfer.files));

    $("remote-form").addEventListener("submit", handleRemoteSubmit);
    $("btn-refresh").addEventListener("click", () => discoverAndLoad());
    $("btn-settings").addEventListener("click", openSettingsModal);

    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.remove("is-open"));
      });
    });

    document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) backdrop.classList.remove("is-open");
      });
    });

    $("settings-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      setStored(STORE_KEYS.server, $("cfg-server").value);
      setStored(STORE_KEYS.pin, $("cfg-pin").value);
      setStored(STORE_KEYS.ghToken, $("cfg-gh-token").value);
      $("modal-settings").classList.remove("is-open");
      await discoverAndLoad();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    discoverAndLoad();
  });
})();
