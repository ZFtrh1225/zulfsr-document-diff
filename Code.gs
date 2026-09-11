/**
 * ZulFsr — Document Intelligence Diff
 * code.gs
 *
 * - Web app entry
 * - LanguageTool proxy untuk Cek EYD (huruf/kata, kalimat, paragraf)
 *
 * === KONFIGURASI ENDPOINT ===
 * Ganti LT_ENDPOINT ke salah satu:
 *   A) Public API (uji coba, ada batas kuota):
 *      https://api.languagetool.org/v2/check
 *   B) Self-hosted Anda (disarankan untuk produksi):
 *      https://lt.domain-anda.com/v2/check
 * Jangan pakai localhost — UrlFetchApp Google tidak bisa mengakses laptop Anda.
 *
 * Jika server LT butuh API key, isi LT_API_KEY di bawah.
 */

/** Endpoint LanguageTool — WAJIB URL yang reachable dari internet */
var LT_ENDPOINT = 'https://api.languagetool.org/v2/check';
// Self-hosted contoh:
// var LT_ENDPOINT = 'https://lt.domain-anda.com/v2/check';

/** Opsional: API key LanguageTool Premium / instance privat */
var LT_API_KEY = '';

function doGet() {
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('ZulFsr — Document Intelligence Diff')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setFaviconUrl('https://cdn-icons-png.flaticon.com/32/2921/2921222.png');
}

/**
 * Uji koneksi ke LanguageTool. Jalankan dari editor (Run ▶).
 * Harus mengembalikan "OK — HTTP 200 ..." jika endpoint benar.
 */
function testLanguageToolConnection() {
  var payload = {
    text: 'Ini adalah tes ejaan Bahasa Indonesia.',
    language: 'id',
    enabledOnly: 'false'
  };
  if (LT_API_KEY) payload.apiKey = LT_API_KEY;

  var res = UrlFetchApp.fetch(LT_ENDPOINT, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: payload,
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': 'ZulFsr-DocumentDiff/3.4 (Google Apps Script)'
    }
  });
  var code = res.getResponseCode();
  var raw = res.getContentText();
  if (code === 200) {
    try {
      var j = JSON.parse(raw);
      return 'OK — HTTP 200. Matches: ' + ((j.matches && j.matches.length) || 0) +
        '. Endpoint siap dipakai.';
    } catch (e) {
      return 'HTTP 200 tapi respons bukan JSON. Cuplikan: ' + raw.substring(0, 120);
    }
  }
  return 'GAGAL — HTTP ' + code + '. Cuplikan: ' + String(raw).substring(0, 200) +
    '\nPeriksa LT_ENDPOINT / API key / firewall server LT.';
}

/**
 * Otorisasi scope external_request (sekali).
 * Prasyarat: appsscript.json berisi oauthScopes script.external_request.
 */
function authorizeExternalRequest() {
  var res = UrlFetchApp.fetch('https://www.google.com', {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true
  });
  return 'OK — izin external_request aktif (HTTP ' + res.getResponseCode() +
    '). Deploy ulang web app (New version), lalu coba Cek EYD.';
}

/**
 * Proxy LanguageTool — hanya teks, tidak menyimpan ke Drive.
 */
function checkSpellingLanguageTool(text) {
  if (!text || String(text).trim().length < 2) {
    return { matches: [], error: null };
  }

  var full = String(text);
  var chunk = full;
  if (full.length > 20000) {
    chunk = full.substring(0, 20000);
    var lastBreak = Math.max(
      chunk.lastIndexOf('\n\n'),
      chunk.lastIndexOf('\n'),
      chunk.lastIndexOf('. '),
      chunk.lastIndexOf(' ')
    );
    if (lastBreak > 15000) chunk = chunk.substring(0, lastBreak + 1);
  }

  // Placeholder domain sering → 403 HTML
  if (String(LT_ENDPOINT).indexOf('domain-anda') !== -1 ||
      String(LT_ENDPOINT).indexOf('localhost') !== -1 ||
      String(LT_ENDPOINT).indexOf('127.0.0.1') !== -1) {
    return {
      matches: [],
      error:
        'ENDPOINT_SALAH: LT_ENDPOINT masih placeholder/localhost. ' +
        'Ganti di Code.gs ke https://api.languagetool.org/v2/check (uji) ' +
        'atau URL self-hosted publik Anda, lalu deploy ulang.'
    };
  }

  var payload = {
    text: chunk,
    language: 'id',
    enabledOnly: 'false'
  };
  if (LT_API_KEY) payload.apiKey = LT_API_KEY;

  var options = {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: payload,
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'User-Agent': 'ZulFsr-DocumentDiff/3.4 (Google Apps Script)'
    }
  };

  try {
    var res = UrlFetchApp.fetch(LT_ENDPOINT, options);
    var code = res.getResponseCode();
    var raw = res.getContentText() || '';
    var body = null;
    var isJson = false;

    try {
      body = JSON.parse(raw);
      isJson = true;
    } catch (e) {
      isJson = false;
    }

    if (code !== 200) {
      var hint = '';
      if (code === 403) {
        hint =
          ' Server menolak (403). Cek: endpoint benar? API key? ' +
          'Firewall/Cloudflare memblokir IP Google? ' +
          'Untuk uji coba pakai https://api.languagetool.org/v2/check';
      } else if (code === 429) {
        hint = ' Kuota/rate-limit LanguageTool terlampaui. Coba lagi nanti atau self-host.';
      } else if (code === 401) {
        hint = ' Unauthorized — isi LT_API_KEY di Code.gs jika server membutuhkannya.';
      } else if (code >= 500) {
        hint = ' Server LanguageTool error. Coba lagi atau ganti endpoint.';
      }
      var detail = isJson
        ? (body.message || body.error || JSON.stringify(body).substring(0, 150))
        : raw.replace(/\s+/g, ' ').substring(0, 150);
      return {
        matches: [],
        error: 'HTTP ' + code + ': ' + detail + hint
      };
    }

    if (!isJson) {
      return {
        matches: [],
        error:
          'Respons bukan JSON (HTTP ' + code + '). ' +
          'Cuplikan: ' + raw.replace(/\s+/g, ' ').substring(0, 120) +
          ' — Pastikan URL berakhiran /v2/check dan mengembalikan JSON.'
      };
    }

    var matches = (body.matches || []).map(function (m) {
      var replacements = (m.replacements || []).slice(0, 5).map(function (r) {
        return r.value;
      });
      var ctx = m.context || {};
      var bad = '';
      if (ctx.text && typeof ctx.offset === 'number' && typeof ctx.length === 'number') {
        bad = String(ctx.text).substring(ctx.offset, ctx.offset + ctx.length);
      }
      var rule = m.rule || {};
      var category = (rule.category && rule.category.id) || (rule.category && rule.category.name) || '';
      var categoryName = (rule.category && rule.category.name) || category || '';
      return {
        offset: m.offset,
        length: m.length,
        message: m.message || '',
        shortMessage: m.shortMessage || '',
        replacements: replacements,
        bad: bad,
        context: ctx.text || '',
        ruleId: rule.id || '',
        category: category,
        categoryName: categoryName,
        issueType: rule.issueType || ''
      };
    });

    return { matches: matches, error: null };
  } catch (err) {
    var msg = String(err.message || err);
    if (
      msg.indexOf('permission') !== -1 ||
      msg.indexOf('Authorization') !== -1 ||
      msg.indexOf('script.external_request') !== -1 ||
      msg.indexOf('izin') !== -1 ||
      msg.indexOf('UrlFetchApp') !== -1
    ) {
      return {
        matches: [],
        error:
          'IZIN_URLFETCH: Jalankan authorizeExternalRequest di editor, ' +
          'Izinkan akses, lalu Deploy ulang (New version).'
      };
    }
    return { matches: [], error: msg };
  }
}