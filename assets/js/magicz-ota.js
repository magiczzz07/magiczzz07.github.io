/* MagicZ Private Vault PWA Controller (MorphIcons + Server-Signed HMAC Tokens + Zero innerHTML) */
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

  /* MorphIcons SVG Path Definitions (24x24 stroke icons) */
  const ICON_PATHS = {
    lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z",
    unlock: "M7 11V7a5 5 0 0 1 9.9-1M5 11h14v10H5z",
    download: "M12 4v12M8 12l4 4 4-4M4 19h16",
    upload: "M12 16V4M8 8l4-4 4 4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2",
    check: "M5 13l4 4L19 7",
    copy: "M8 8h11v11H8zM5 15H4V4h11v1",
    qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2z",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
    refresh: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"
  };

  const state = {
    serverUrl: "",
    serverOnline: false,
    unlocked: false,
    apps: [],
    pendingMeta: null
  };

  const morphs = {};
  const $ = (id) => document.getElementById(id);

  function initMorph(pathId, initialKey) {
    const pathEl = $(pathId);
    if (!pathEl) return null;
    if (window.MorphIcons && typeof window.MorphIcons.createMorph === "function") {
      try {
        return window.MorphIcons.createMorph(pathEl, ICON_PATHS[initialKey], {
          reducedMotion: "user",
          strokeWidth: 1.75
        });
      } catch (_) {}
    }
    return {
      to(nextPath) {
        pathEl.setAttribute("d", nextPath);
      }
    };
  }

  function makeSvgIcon(pathKey) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.75");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", ICON_PATHS[pathKey] || ICON_PATHS.lock);
    svg.appendChild(path);

    let driver = null;
    if (window.MorphIcons && typeof window.MorphIcons.createMorph === "function") {
      try {
        driver = window.MorphIcons.createMorph(path, ICON_PATHS[pathKey], {
          reducedMotion: "user",
          strokeWidth: 1.75
        });
      } catch (_) {}
    }
    svg._morphTo = (nextKey) => {
      const target = ICON_PATHS[nextKey];
      if (!target) return;
      if (driver && typeof driver.to === "function") driver.to(target);
      else path.setAttribute("d", target);
    };
    return svg;
  }

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
    if (!bytes || bytes <= 0) return "Direct";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function randomHex16() {
    const arr = new Uint8Array(8);
    crypto.getRandomValues(arr);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
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
    if (changed) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }

  async function probeServer(url, pin) {
    if (!isSafeHttpsOrLocal(url)) return null;
    const clean = url.replace(/\/+$/, "");
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const headers = pin ? { "X-Pin": pin } : {};
      const res = await fetch(clean + "/apps", { signal: ctrl.signal, headers, cache: "no-store" });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.ok) {
        return {
          url: clean,
          unlocked: Boolean(data.unlocked),
          apps: Array.isArray(data.apps) ? data.apps : []
        };
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
    const pin = getStored(STORE_KEYS.pin);

    const candidates = [];
    const liveJson = await loadCatalogJson("data/live.json");
    if (liveJson && liveJson.server && isSafeHttpsOrLocal(liveJson.server)) {
      candidates.push(liveJson.server);
    }
    const saved = getStored(STORE_KEYS.server);
    if (saved && !candidates.includes(saved)) candidates.push(saved);
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      candidates.push("http://localhost:8686");
    }

    let connected = null;
    for (const c of candidates) {
      const hit = await probeServer(c, pin);
      if (hit) {
        connected = hit;
        break;
      }
    }

    const catalogJson = await loadCatalogJson("data/catalog.json");
    const ghApps = catalogJson && Array.isArray(catalogJson.apps) ? catalogJson.apps : [];

    if (connected) {
      state.serverUrl = connected.url;
      state.serverOnline = true;
      state.unlocked = connected.unlocked;
      setStored(STORE_KEYS.server, connected.url);
      const trap = $("honeypot-link");
      if (trap) trap.setAttribute("href", connected.url + "/api/internal/trap");
      const ids = new Set(connected.apps.map((a) => a.id));
      state.apps = connected.apps.concat(ghApps.filter((a) => !ids.has(a.id)));
    } else {
      state.serverUrl = saved || (liveJson && liveJson.server) || "";
      state.serverOnline = false;
      state.unlocked = false;
      const livApps = liveJson && Array.isArray(liveJson.apps) ? liveJson.apps : [];
      const ids = new Set(livApps.map((a) => a.id));
      state.apps = livApps.concat(ghApps.filter((a) => !ids.has(a.id)));
    }

    updateVaultUI();
    renderAppList();
  }

  function updateVaultUI() {
    const unlocked = state.unlocked;
    const nextIcon = unlocked ? ICON_PATHS.unlock : ICON_PATHS.lock;
    if (morphs.vaultLock) morphs.vaultLock.to(nextIcon);
    if (morphs.mobileLock) morphs.mobileLock.to(nextIcon);
    if (morphs.heroAction) morphs.heroAction.to(unlocked ? ICON_PATHS.upload : ICON_PATHS.lock);

    $("vault-label").textContent = unlocked ? "Đã mở khóa" : "Mở khóa";
    $("mobile-lock-label").textContent = unlocked ? "Đã mở" : "Mở khóa";
    $("hero-action-label").textContent = unlocked ? "Nạp file IPA mới" : "Mở khóa bằng mã PIN";
    $("vault-state-pill").textContent = unlocked ? "Đã mở khóa" : "Chế độ xem";
    $("vault-substate").textContent = unlocked ? "Sẵn sàng tải và quản trị kho" : "Nhập PIN để tải và nạp app";
    $("stat-apps").textContent = String(state.apps.length);
    $("stat-access").textContent = unlocked ? "open" : "locked";
    $("studio-lock-badge").textContent = unlocked ? "Sẵn sàng" : "Đã khóa";

    $("studio-locked-gate").classList.toggle("is-hidden", unlocked);
    $("studio-unlocked-body").classList.toggle("is-hidden", !unlocked);
    $("btn-lock-out").classList.toggle("is-hidden", !unlocked);
  }

  function buildAppRowDom(a) {
    const li = el("li", "app-row");
    const main = el("div", "app-main");
    const head = el("div", "app-head");

    const iconImg = document.createElement("img");
    iconImg.className = "app-icon";
    iconImg.width = 60;
    iconImg.height = 60;
    iconImg.alt = a.name || "App";
    iconImg.loading = "lazy";
    iconImg.src = isSafeHttpsOrLocal(a.icon_url) ? a.icon_url : "assets/brand/magicz-mark.svg";
    iconImg.addEventListener("error", () => {
      if (!iconImg.src.endsWith("magicz-mark.svg")) {
        iconImg.src = "assets/brand/magicz-mark.svg";
      }
    });
    head.appendChild(iconImg);

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
      if (p.expires) specs.appendChild(el("span", "num", "HSD " + p.expires));
    }

    info.appendChild(nameRow);
    info.appendChild(specs);
    head.appendChild(info);

    const actions = el("div", "app-actions");
    if (state.unlocked && isSafeItmsUrl(a.itms_url)) {
      const installLink = el("a", "btn btn-primary");
      installLink.setAttribute("href", a.itms_url);
      const dlSvg = makeSvgIcon("download");
      installLink.appendChild(dlSvg);
      installLink.appendChild(el("span", "", "Install"));
      installLink.addEventListener("click", () => {
        dlSvg._morphTo("check");
        setTimeout(() => dlSvg._morphTo("download"), 2200);
      });
      actions.appendChild(installLink);

      if (isSafeHttpsOrLocal(a.page_url)) {
        const qrBtn = el("button", "btn btn-ghost");
        qrBtn.type = "button";
        qrBtn.setAttribute("aria-label", "Mã QR");
        qrBtn.appendChild(makeSvgIcon("qr"));
        qrBtn.addEventListener("click", () => openQrModal(a.page_url, a.name));
        actions.appendChild(qrBtn);
      }

      const copyBtn = el("button", "btn btn-ghost");
      copyBtn.type = "button";
      copyBtn.setAttribute("aria-label", "Sao chép link cài đặt");
      const cpSvg = makeSvgIcon("copy");
      copyBtn.appendChild(cpSvg);
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(a.itms_url).then(() => {
          cpSvg._morphTo("check");
          setTimeout(() => cpSvg._morphTo("copy"), 1600);
        });
      });
      actions.appendChild(copyBtn);

      const delBtn = el("button", "btn btn-ghost");
      delBtn.type = "button";
      delBtn.setAttribute("aria-label", "Xóa ứng dụng");
      delBtn.appendChild(makeSvgIcon("trash"));
      delBtn.addEventListener("click", () => deleteApp(a.id));
      actions.appendChild(delBtn);
    } else {
      const lockBtn = el("button", "btn btn-secondary");
      lockBtn.type = "button";
      lockBtn.appendChild(makeSvgIcon("lock"));
      lockBtn.appendChild(el("span", "", "Đã khóa"));
      lockBtn.addEventListener("click", openSettingsModal);
      actions.appendChild(lockBtn);
    }

    main.appendChild(head);
    main.appendChild(actions);
    li.appendChild(main);

    if (state.unlocked && p && Array.isArray(p.udid_hashes) && p.udid_hashes.length > 0) {
      const details = el("details", "udid-details");
      details.appendChild(el("summary", "", "Kiểm tra UDID (" + p.udid_hashes.length + " thiết bị)"));
      const box = el("div", "udid-box");
      const inp = el("input", "input input-sm mono");
      inp.type = "text";
      inp.placeholder = "Dán mã UDID để kiểm tra nhanh";
      const resultLine = el("div", "status-line", "");
      const hashSet = new Set(p.udid_hashes);
      inp.addEventListener("input", async () => {
        const val = inp.value.trim();
        if (!val) {
          setStatus(resultLine, "", "");
          return;
        }
        const h = await window.MagicZIpaParser.sha256Hex16(val);
        if (hashSet.has(h)) setStatus(resultLine, "Khớp: thiết bị đã nằm trong chứng chỉ", "ok");
        else setStatus(resultLine, "Không tìm thấy UDID này trong bản dựng", "error");
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

    countEl.textContent = state.apps.length + " ứng dụng";
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
    preview.appendChild(line1);
    preview.appendChild(el("div", "mono", meta.bundle_id));
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
      xhr.onerror = () => reject(new Error("Không kết nối được máy chủ"));
      xhr.send(blob);
    });
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
    if (!state.unlocked || !state.serverUrl) {
      openSettingsModal();
      return;
    }

    const file = files[0];
    setStatus(st, "Đang phân tích file IPA...", "");
    try {
      const localMeta = await window.MagicZIpaParser.inspectIpaFile(file);
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
            setStatus(st, "Đang tải lên: " + Math.round(overall * 100) + "% (" + formatSize(start + loadedInChunk) + " / " + formatSize(file.size) + ")", "");
          }
        );
      }

      setStatus(st, "Đang tách icon và tạo gói cài đặt...", "");
      const rawRes = await sendChunkXhr(state.serverUrl + "/upload/finish?uid=" + uid, new Blob([]), pin, null);
      const created = JSON.parse(rawRes);
      setProgress(pw, pf, 1);
      if (morphs.uploadState) {
        morphs.uploadState.to(ICON_PATHS.check);
        setTimeout(() => morphs.uploadState.to(ICON_PATHS.upload), 2200);
      }
      setStatus(st, "Đã thêm vào kho: " + created.name, "ok");
      await discoverAndLoad();
      if (isIOSDevice() && !isBlockedInAppBrowser() && isSafeItmsUrl(created.itms_url)) {
        window.location.href = created.itms_url;
      }
    } catch (err) {
      setProgress(pw, pf, null);
      setStatus(st, err.message, "error");
    }
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

    if (!rawUrl.toLowerCase().startsWith("https://")) {
      setStatus(st, "Chỉ chấp nhận đường dẫn HTTPS", "error");
      return;
    }
    if (!state.unlocked || !state.serverUrl) {
      openSettingsModal();
      return;
    }

    const pin = getStored(STORE_KEYS.pin);
    try {
      setProgress(pw, pf, 0.05);
      setStatus(st, pullViaServer ? "Đang tải file về kho..." : "Đang tạo liên kết cài đặt...", "");
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
            setStatus(st, "Đã tải xong: " + job.app.name, "ok");
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
            setStatus(st, "Đang tải: " + Math.round(r * 100) + "% (" + formatSize(job.downloaded) + " / " + formatSize(job.total) + ")", "");
          } else {
            setStatus(st, "Đang tải: " + formatSize(job.downloaded), "");
          }
        }
      } else {
        setProgress(pw, pf, 1);
        setStatus(st, "Đã thêm vào kho: " + data.name, "ok");
        $("remote-url").value = "";
        await discoverAndLoad();
      }
    } catch (err) {
      setProgress(pw, pf, null);
      setStatus(st, err.message, "error");
    }
  }

  async function deleteApp(id) {
    if (!window.confirm("Xóa ứng dụng này khỏi kho?")) return;
    const pin = getStored(STORE_KEYS.pin);
    if (!state.serverUrl || !pin) return;
    const r = await fetch(state.serverUrl + "/a/" + encodeURIComponent(id), {
      method: "DELETE",
      headers: { "X-Pin": pin }
    });
    if (!r.ok) {
      window.alert(await r.text());
      return;
    }
    await discoverAndLoad();
  }

  function openSettingsModal() {
    $("cfg-server").value = getStored(STORE_KEYS.server) || state.serverUrl || "";
    $("cfg-pin").value = getStored(STORE_KEYS.pin);
    $("cfg-gh-token").value = getStored(STORE_KEYS.ghToken);
    setStatus($("pin-verify-status"), "", "");
    $("modal-settings").classList.add("is-open");
    setTimeout(() => $("cfg-pin").focus(), 80);
  }

  function openQrModal(url, title) {
    $("qr-title").textContent = title || "Quét mã QR bằng Camera iPhone";
    $("qr-img").src = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=" + encodeURIComponent(url);
    $("qr-link").textContent = url;
    $("modal-qr").classList.add("is-open");
  }

  function activateContentShield() {
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

  function registerPwaServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }

  function bindEvents() {
    activateContentShield();
    registerPwaServiceWorker();

    morphs.vaultLock = initMorph("icon-vault-lock", "lock");
    morphs.mobileLock = initMorph("icon-mobile-lock", "lock");
    morphs.heroAction = initMorph("icon-hero-action", "lock");
    morphs.refresh = initMorph("icon-refresh", "refresh");
    morphs.uploadState = initMorph("icon-upload-state", "upload");

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
    $("file-input").addEventListener("change", (e) => handleFilesSelected(e.target.files));
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

    $("btn-refresh").addEventListener("click", async () => {
      await discoverAndLoad();
      if (morphs.refresh) {
        morphs.refresh.to(ICON_PATHS.check);
        setTimeout(() => morphs.refresh.to(ICON_PATHS.refresh), 1200);
      }
    });

    $("btn-settings").addEventListener("click", openSettingsModal);
    $("btn-gate-unlock").addEventListener("click", openSettingsModal);
    $("btn-hero-unlock").addEventListener("click", () => {
      if (state.unlocked) {
        $("section-studio").scrollIntoView({ behavior: "smooth" });
      } else {
        openSettingsModal();
      }
    });

    /* Mobile PWA Native Bottom Tab Bar */
    const setMobileTab = (activeId) => {
      ["mnav-store", "mnav-upload", "mnav-lock"].forEach((id) => {
        $(id).classList.toggle("is-active", id === activeId);
      });
    };
    $("mnav-store").addEventListener("click", () => {
      setMobileTab("mnav-store");
      $("section-registry").scrollIntoView({ behavior: "smooth" });
    });
    $("mnav-upload").addEventListener("click", () => {
      setMobileTab("mnav-upload");
      if (!state.unlocked) openSettingsModal();
      else $("section-studio").scrollIntoView({ behavior: "smooth" });
    });
    $("mnav-lock").addEventListener("click", () => {
      setMobileTab("mnav-lock");
      openSettingsModal();
    });

    $("btn-lock-out").addEventListener("click", async () => {
      setStored(STORE_KEYS.pin, "");
      $("modal-settings").classList.remove("is-open");
      await discoverAndLoad();
    });

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
      const st = $("pin-verify-status");
      const pinVal = $("cfg-pin").value.trim();
      const srvVal = $("cfg-server").value.trim();
      const targetSrv = (srvVal && isSafeHttpsOrLocal(srvVal) ? srvVal : state.serverUrl).replace(/\/+$/, "");

      if (!targetSrv) {
        setStatus(st, "Chưa tìm thấy máy chủ đồng bộ", "error");
        return;
      }
      setStatus(st, "Đang xác thực mã PIN với máy chủ...", "");
      try {
        const res = await fetch(targetSrv + "/auth/verify", {
          method: "POST",
          headers: { "X-Pin": pinVal }
        });
        if (!res.ok) {
          setStatus(st, "Mã PIN không chính xác", "error");
          return;
        }
        setStored(STORE_KEYS.pin, pinVal);
        if (srvVal) setStored(STORE_KEYS.server, srvVal);
        setStored(STORE_KEYS.ghToken, $("cfg-gh-token").value);
        $("modal-settings").classList.remove("is-open");
        await discoverAndLoad();
      } catch (_) {
        setStatus(st, "Không thể kết nối máy chủ xác thực", "error");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    discoverAndLoad();
  });
})();
