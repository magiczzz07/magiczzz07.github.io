/* MagicZ OTA Workbench Controller */
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

  function isIOSDevice() {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isBlockedInAppBrowser() {
    const ua = navigator.userAgent || "";
    return isIOSDevice() && /FBAN|FBAV|Zalo|Line\/|Instagram|Telegram|MicroMessenger|CriOS|FxiOS|EdgiOS/i.test(ua);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
      "          <string>" + escapeHtml(ipaUrl) + "</string>",
      "        </dict>",
      "      </array>",
      "      <key>metadata</key>",
      "      <dict>",
      "        <key>bundle-identifier</key>",
      "        <string>" + escapeHtml(bundleId) + "</string>",
      "        <key>bundle-version</key>",
      "        <string>" + escapeHtml(version || "1.0") + "</string>",
      "        <key>kind</key>",
      "        <string>software</string>",
      "        <key>title</key>",
      "        <string>" + escapeHtml(title || "App") + "</string>",
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

  async function probeServer(url) {
    if (!url) return null;
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
    const params = new URLSearchParams(window.location.search);
    const paramServer = params.get("server") || params.get("s");
    if (paramServer) {
      setStored(STORE_KEYS.server, paramServer.replace(/\/+$/, ""));
      window.history.replaceState({}, "", window.location.pathname);
    }

    const candidates = [];
    const saved = getStored(STORE_KEYS.server);
    if (saved) candidates.push(saved);

    const liveJson = await loadCatalogJson("ota/live.json");
    if (liveJson && liveJson.server && !candidates.includes(liveJson.server)) {
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
      const ids = new Set(connected.apps.map((a) => a.id));
      state.apps = connected.apps.concat(ghApps.filter((a) => !ids.has(a.id)));
    } else {
      state.serverUrl = saved || (liveJson && liveJson.server) || "";
      state.serverOnline = false;
      state.apps = ghApps;
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

  function renderAppList() {
    const listEl = $("app-list");
    const emptyEl = $("empty-state");
    const countEl = $("app-count");

    countEl.textContent = state.apps.length + " bản dựng";
    if (!state.apps.length) {
      listEl.innerHTML = "";
      emptyEl.classList.remove("is-hidden");
      return;
    }
    emptyEl.classList.add("is-hidden");

    listEl.innerHTML = state.apps
      .map((a) => {
        const p = a.provision;
        let tagHtml = "";
        let provSpecs = "";
        let udidHtml = "";

        if (p) {
          const bad = p.expired || p.kind === "App Store";
          tagHtml =
            '<span class="tag ' +
            (bad ? "tag-warn" : "tag-ok") +
            '">' +
            escapeHtml(p.expired ? "Hết hạn" : p.kind) +
            "</span>";
          provSpecs =
            "<span>" +
            escapeHtml(p.team || "Signed") +
            "</span>" +
            '<span class="num">' +
            (Array.isArray(p.devices) ? p.devices.length : 0) +
            " UDID</span>" +
            (p.expires ? '<span class="num">HSD ' + escapeHtml(p.expires) + "</span>" : "");

          if (Array.isArray(p.devices) && p.devices.length > 0) {
            const rows = p.devices.map((d) => "<div>" + escapeHtml(d) + "</div>").join("");
            udidHtml =
              '<details class="udid-details">' +
              "<summary>Tra cứu danh sách UDID (" +
              p.devices.length +
              ")</summary>" +
              '<div class="udid-box">' +
              '<input type="text" class="input input-sm mono" placeholder="Nhập mã UDID cần kiểm tra" data-udid-filter="' +
              escapeHtml(a.id) +
              '">' +
              '<div class="udid-list" id="udid-list-' +
              escapeHtml(a.id) +
              '">' +
              rows +
              "</div></div></details>";
          }
        } else {
          tagHtml = '<span class="tag">' + escapeHtml(a.source === "github" ? "GitHub OTA" : "Direct OTA") + "</span>";
        }

        const verLabel = "v" + escapeHtml(a.version || "1.0") + (a.build && a.build !== a.version ? " (" + escapeHtml(a.build) + ")" : "");
        const shareUrl = a.page_url || SITE_ORIGIN + "/?app=" + encodeURIComponent(a.id);

        return (
          '<li class="app-row">' +
          '<div class="app-main">' +
          '<div class="app-info">' +
          '<div class="app-name-row">' +
          '<span class="app-name">' +
          escapeHtml(a.name) +
          "</span>" +
          tagHtml +
          "</div>" +
          '<div class="app-specs">' +
          '<span class="mono">' +
          escapeHtml(a.bundle_id) +
          "</span>" +
          '<span class="num">' +
          verLabel +
          "</span>" +
          '<span class="num">' +
          formatSize(a.size) +
          "</span>" +
          provSpecs +
          "</div>" +
          "</div>" +
          '<div class="app-actions">' +
          '<a class="btn btn-primary" href="' +
          escapeHtml(a.itms_url) +
          '">Install</a>' +
          '<button type="button" class="btn btn-ghost" data-qr="' +
          escapeHtml(shareUrl) +
          '" data-qr-name="' +
          escapeHtml(a.name) +
          '">QR</button>' +
          '<button type="button" class="btn btn-ghost" data-copy="' +
          escapeHtml(a.itms_url) +
          '">Copy</button>' +
          '<button type="button" class="btn btn-ghost" data-del="' +
          escapeHtml(a.id) +
          '" data-source="' +
          escapeHtml(a.source || "server") +
          '">Xóa</button>' +
          "</div>" +
          "</div>" +
          udidHtml +
          "</li>"
        );
      })
      .join("");
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

  function setStatus(el, msg, kind) {
    el.textContent = msg || "";
    el.className = "status-line" + (kind === "error" ? " is-error" : kind === "ok" ? " is-ok" : "");
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
    const preview = $("parsed-preview");

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
        const provText = localMeta.provision
          ? localMeta.provision.kind +
            " - " +
            (localMeta.provision.team || "") +
            " - " +
            localMeta.provision.devices.length +
            " UDID" +
            (localMeta.provision.expires ? " (HSD " + localMeta.provision.expires + ")" : "")
          : "Không kèm mobileprovision";
        preview.innerHTML =
          "<div><strong>" +
          escapeHtml(localMeta.name) +
          "</strong> - v" +
          escapeHtml(localMeta.version) +
          " (" +
          formatSize(file.size) +
          ")</div>" +
          '<div class="mono">' +
          escapeHtml(localMeta.bundle_id) +
          "</div>" +
          "<div>" +
          escapeHtml(provText) +
          "</div>";
        preview.classList.add("is-visible");
      }
    } catch (err) {
      preview.classList.remove("is-visible");
      setStatus(st, err.message, "error");
      return;
    }

    const pin = getStored(STORE_KEYS.pin);
    const ghToken = getStored(STORE_KEYS.ghToken);

    if (state.serverOnline && state.serverUrl) {
      try {
        const uid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
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
          state.serverUrl + "/upload/finish?uid=" + uid + "&name=" + encodeURIComponent(file.name),
          new Blob([]),
          pin,
          null
        );
        const created = JSON.parse(rawRes);
        setProgress(pw, pf, 1);
        setStatus(st, "Đã sẵn sàng cài đặt: " + created.name, "ok");
        await discoverAndLoad();
        if (isIOSDevice() && !isBlockedInAppBrowser()) {
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
        const id = Math.random().toString(16).slice(2, 10);
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
          page_url: SITE_ORIGIN + "/?app=" + id,
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
    setStatus(st, "Hãy bật CAI_IPA.bat hoặc nhập Server URL / GitHub Token trong mục Kết nối", "error");
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

    if (!rawUrl) {
      setStatus(st, "Vui lòng dán link Dropbox hoặc Direct HTTPS của file .ipa", "error");
      return;
    }

    const pin = getStored(STORE_KEYS.pin);
    const ghToken = getStored(STORE_KEYS.ghToken);

    if (state.serverOnline && state.serverUrl) {
      try {
        setProgress(pw, pf, 0.05);
        setStatus(st, pullViaServer ? "Máy chủ đang kết nối và tải file IPA về..." : "Đang kiểm tra link và tạo manifest...", "");
        const res = await fetch(state.serverUrl + "/remote", {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, pin ? { "X-Pin": pin } : {}),
          body: JSON.stringify({ url: rawUrl, bundle_id: bundleId, name: appName, pull: pullViaServer })
        });
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = await res.json();

        if (res.status === 202 && data.id) {
          const jobId = data.id;
          while (true) {
            await new Promise((r) => setTimeout(r, 900));
            const jr = await fetch(state.serverUrl + "/remote/status?job=" + encodeURIComponent(jobId), { cache: "no-store" });
            if (!jr.ok) throw new Error("Mất kết nối tiến trình tải");
            const job = await jr.json();
            if (job.state === "error") throw new Error(job.error || "Tải file thất bại");
            if (job.state === "done" && job.app) {
              setProgress(pw, pf, 1);
              setStatus(st, "Máy chủ đã tải xong: " + job.app.name, "ok");
              $("remote-url").value = "";
              await discoverAndLoad();
              if (isIOSDevice() && !isBlockedInAppBrowser()) {
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
          if (isIOSDevice() && !isBlockedInAppBrowser()) {
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
      if (!finalBid) {
        setStatus(st, "Khi tắt máy chủ, hãy điền Bundle ID (hoặc chọn file .ipa ở tab bên cạnh để tự đọc Bundle ID)", "error");
        return;
      }
      try {
        setProgress(pw, pf, 0.5);
        setStatus(st, "Đang tạo manifest.plist trên GitHub Pages...", "");
        const id = Math.random().toString(16).slice(2, 10);
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
          page_url: SITE_ORIGIN + "/?app=" + id,
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
      const r = await fetch(state.serverUrl + "/a/" + encodeURIComponent(id), {
        method: "DELETE",
        headers: pin ? { "X-Pin": pin } : {}
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

  function bindEvents() {
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

    $("app-list").addEventListener("click", (e) => {
      const qrBtn = e.target.closest("[data-qr]");
      if (qrBtn) {
        openQrModal(qrBtn.getAttribute("data-qr"), qrBtn.getAttribute("data-qr-name"));
        return;
      }
      const copyBtn = e.target.closest("[data-copy]");
      if (copyBtn) {
        navigator.clipboard.writeText(copyBtn.getAttribute("data-copy")).then(() => {
          const prev = copyBtn.textContent;
          copyBtn.textContent = "Đã copy";
          setTimeout(() => {
            copyBtn.textContent = prev;
          }, 1400);
        });
        return;
      }
      const delBtn = e.target.closest("[data-del]");
      if (delBtn) {
        deleteApp(delBtn.getAttribute("data-del"), delBtn.getAttribute("data-source"));
      }
    });

    $("app-list").addEventListener("input", (e) => {
      const filterId = e.target.getAttribute("data-udid-filter");
      if (!filterId) return;
      const q = e.target.value.trim().toLowerCase();
      const box = $("udid-list-" + filterId);
      if (!box) return;
      Array.from(box.children).forEach((row) => {
        row.style.display = !q || row.textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });

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
