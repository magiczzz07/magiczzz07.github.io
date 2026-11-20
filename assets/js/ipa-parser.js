/* MagicZ Client-Side IPA Inspector (ZIP Central Directory + bplist00 + XML Plist + SHA-256 UDID Privacy) */
(function (global) {
  "use strict";

  const tdUtf8 = new TextDecoder("utf-8");
  const tdLatin = new TextDecoder("latin1");

  function readU16LE(u8, o) {
    return u8[o] | (u8[o + 1] << 8);
  }

  function readU32LE(u8, o) {
    return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
  }

  function readUIntBE(u8, offset, byteLen) {
    let val = 0;
    for (let i = 0; i < byteLen; i++) {
      val = val * 256 + u8[offset + i];
    }
    return val;
  }

  async function sha256Hex16(str) {
    const data = new TextEncoder().encode(String(str).trim().toUpperCase());
    const buf = await crypto.subtle.digest("SHA-256", data);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  }

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("Trình duyệt không hỗ trợ DecompressionStream");
    }
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(u8);
    writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  }

  function parseBinaryPlist(u8) {
    if (u8.length < 40) return null;
    const trailerOff = u8.length - 32;
    const offsetIntSize = u8[trailerOff + 6];
    const objectRefSize = u8[trailerOff + 7];
    const numObjects = readUIntBE(u8, trailerOff + 8, 8);
    const topObject = readUIntBE(u8, trailerOff + 16, 8);
    const offsetTableOffset = readUIntBE(u8, trailerOff + 24, 8);

    const offsets = new Array(numObjects);
    for (let i = 0; i < numObjects; i++) {
      offsets[i] = readUIntBE(u8, offsetTableOffset + i * offsetIntSize, offsetIntSize);
    }

    function readLen(pos, nibble) {
      if (nibble !== 0x0f) return { len: nibble, next: pos };
      const intMarker = u8[pos];
      const byteCount = 1 << (intMarker & 0x0f);
      return { len: readUIntBE(u8, pos + 1, byteCount), next: pos + 1 + byteCount };
    }

    const seen = new Map();
    function parseObj(idx) {
      if (seen.has(idx)) return seen.get(idx);
      const off = offsets[idx];
      const marker = u8[off];
      const type = (marker & 0xf0) >> 4;
      const info = marker & 0x0f;
      let res = null;

      if (type === 0x0) {
        if (info === 0x08) res = false;
        else if (info === 0x09) res = true;
      } else if (type === 0x1) {
        const n = 1 << info;
        res = readUIntBE(u8, off + 1, n);
      } else if (type === 0x2) {
        const dv = new DataView(u8.buffer, u8.byteOffset + off + 1, 1 << info);
        res = info === 2 ? dv.getFloat32(0, false) : dv.getFloat64(0, false);
      } else if (type === 0x3) {
        const dv = new DataView(u8.buffer, u8.byteOffset + off + 1, 8);
        const secs = dv.getFloat64(0, false);
        res = new Date((secs + 978307200) * 1000);
      } else if (type === 0x4) {
        const { len, next } = readLen(off + 1, info);
        res = u8.subarray(next, next + len);
      } else if (type === 0x5) {
        const { len, next } = readLen(off + 1, info);
        res = tdLatin.decode(u8.subarray(next, next + len));
      } else if (type === 0x6) {
        const { len, next } = readLen(off + 1, info);
        const chars = new Uint16Array(len);
        for (let i = 0; i < len; i++) {
          chars[i] = (u8[next + i * 2] << 8) | u8[next + i * 2 + 1];
        }
        res = String.fromCharCode.apply(null, Array.from(chars));
      } else if (type === 0xa) {
        const { len, next } = readLen(off + 1, info);
        res = [];
        seen.set(idx, res);
        for (let i = 0; i < len; i++) {
          const ref = readUIntBE(u8, next + i * objectRefSize, objectRefSize);
          res.push(parseObj(ref));
        }
      } else if (type === 0xd) {
        const { len, next } = readLen(off + 1, info);
        res = {};
        seen.set(idx, res);
        const valsStart = next + len * objectRefSize;
        for (let i = 0; i < len; i++) {
          const kRef = readUIntBE(u8, next + i * objectRefSize, objectRefSize);
          const vRef = readUIntBE(u8, valsStart + i * objectRefSize, objectRefSize);
          res[String(parseObj(kRef))] = parseObj(vRef);
        }
      }
      seen.set(idx, res);
      return res;
    }

    return parseObj(topObject);
  }

  function parseXmlPlistNode(el) {
    if (!el) return null;
    const tag = el.tagName;
    if (tag === "dict") {
      const obj = {};
      const children = Array.from(el.children);
      for (let i = 0; i < children.length; i += 2) {
        if (children[i] && children[i].tagName === "key" && children[i + 1]) {
          obj[children[i].textContent] = parseXmlPlistNode(children[i + 1]);
        }
      }
      return obj;
    }
    if (tag === "array") return Array.from(el.children).map(parseXmlPlistNode);
    if (tag === "string") return el.textContent || "";
    if (tag === "integer" || tag === "real") return Number(el.textContent || 0);
    if (tag === "true") return true;
    if (tag === "false") return false;
    if (tag === "date") return new Date(el.textContent.trim());
    return el.textContent || "";
  }

  function parsePlistBytes(u8) {
    const head = tdLatin.decode(u8.subarray(0, 8));
    if (head.startsWith("bplist00")) return parseBinaryPlist(u8);
    const xmlStr = tdUtf8.decode(u8);
    const doc = new DOMParser().parseFromString(xmlStr, "application/xml");
    const rootPlist = doc.querySelector("plist");
    return rootPlist ? parseXmlPlistNode(rootPlist.firstElementChild) : null;
  }

  async function parseMobileProvision(u8) {
    const raw = tdLatin.decode(u8);
    const s = raw.indexOf("<?xml");
    const e = raw.indexOf("</plist>");
    if (s < 0 || e < 0) return null;
    const p = parsePlistBytes(u8.subarray(s, e + 8));
    if (!p) return null;
    const devices = Array.isArray(p.ProvisionedDevices) ? p.ProvisionedDevices.map(String) : [];
    let kind = "App Store";
    if (p.ProvisionsAllDevices) kind = "Enterprise";
    else if (p.Entitlements && p.Entitlements["get-task-allow"]) kind = "Development";
    else if (devices.length > 0) kind = "Ad-Hoc";

    let expires = "";
    let expired = false;
    if (p.ExpirationDate instanceof Date && !isNaN(p.ExpirationDate.getTime())) {
      expires = p.ExpirationDate.toISOString().slice(0, 10);
      expired = p.ExpirationDate.getTime() < Date.now();
    }
    const hashes = await Promise.all(devices.map(sha256Hex16));
    return {
      profile: String(p.Name || "").slice(0, 120),
      team: String(p.TeamName || "").slice(0, 120),
      kind: kind,
      udid_count: devices.length,
      udid_hashes: hashes,
      expires: expires,
      expired: expired
    };
  }

  async function readEntryFromZip(file, entry) {
    if (entry.compSize > 2 * 1024 * 1024) {
      throw new Error("Tệp cấu hình trong IPA vượt giới hạn an toàn");
    }
    const headerBuf = await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer();
    const hv = new Uint8Array(headerBuf);
    if (readU32LE(hv, 0) !== 0x04034b50) {
      throw new Error("Local ZIP header không hợp lệ");
    }
    const fnameLen = readU16LE(hv, 26);
    const extraLen = readU16LE(hv, 28);
    const dataStart = entry.localOffset + 30 + fnameLen + extraLen;
    const compBytes = new Uint8Array(await file.slice(dataStart, dataStart + entry.compSize).arrayBuffer());
    if (entry.method === 0) return compBytes;
    if (entry.method === 8) return await inflateRaw(compBytes);
    throw new Error("Phương thức nén ZIP không hỗ trợ: " + entry.method);
  }

  async function inspectIpaFile(file) {
    const tailSize = Math.min(file.size, 131072);
    const tailOffset = file.size - tailSize;
    const tail = new Uint8Array(await file.slice(tailOffset, file.size).arrayBuffer());

    let eocdPos = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (readU32LE(tail, i) === 0x06054b50) {
        eocdPos = i;
        break;
      }
    }
    if (eocdPos < 0) throw new Error("Tệp không phải định dạng IPA / ZIP hợp lệ");

    const cdSize = readU32LE(tail, eocdPos + 12);
    const cdOffset = readU32LE(tail, eocdPos + 16);
    if (cdOffset === 0xffffffff) return null;

    const cd = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    let ptr = 0;
    let infoEntry = null;
    let appPrefix = "";
    const entries = [];

    while (ptr + 46 <= cd.length) {
      if (readU32LE(cd, ptr) !== 0x02014b50) break;
      const method = readU16LE(cd, ptr + 10);
      const compSize = readU32LE(cd, ptr + 20);
      const nameLen = readU16LE(cd, ptr + 28);
      const extraLen = readU16LE(cd, ptr + 30);
      const commentLen = readU16LE(cd, ptr + 32);
      const localOffset = readU32LE(cd, ptr + 42);
      const name = tdUtf8.decode(cd.subarray(ptr + 46, ptr + 46 + nameLen));
      entries.push({ name, method, compSize, localOffset });
      if (!infoEntry && /^Payload\/[^/]+\.app\/Info\.plist$/.test(name)) {
        infoEntry = entries[entries.length - 1];
        appPrefix = name.slice(0, -10);
      }
      ptr += 46 + nameLen + extraLen + commentLen;
    }

    if (!infoEntry) throw new Error("Không tìm thấy Payload/*.app/Info.plist trong file IPA");
    const provEntry = entries.find((e) => e.name === appPrefix + "embedded.mobileprovision") || null;

    const infoBytes = await readEntryFromZip(file, infoEntry);
    const info = parsePlistBytes(infoBytes);
    const bid = info && info.CFBundleIdentifier ? String(info.CFBundleIdentifier).trim() : "";
    if (!/^[A-Za-z0-9.-]{2,160}$/.test(bid)) {
      throw new Error("Bundle ID trong Info.plist không hợp lệ");
    }

    let provision = null;
    if (provEntry) {
      try {
        const provBytes = await readEntryFromZip(file, provEntry);
        provision = await parseMobileProvision(provBytes);
      } catch (_) {}
    }

    return {
      name: String(info.CFBundleDisplayName || info.CFBundleName || file.name.replace(/\.ipa$/i, "")).slice(0, 100),
      bundle_id: bid,
      version: String(info.CFBundleShortVersionString || info.CFBundleVersion || "1.0").slice(0, 40),
      build: String(info.CFBundleVersion || "").slice(0, 40),
      min_ios: info.MinimumOSVersion ? String(info.MinimumOSVersion).slice(0, 20) : "",
      size: file.size,
      provision: provision
    };
  }

  global.MagicZIpaParser = { inspectIpaFile: inspectIpaFile, sha256Hex16: sha256Hex16 };
})(window);
