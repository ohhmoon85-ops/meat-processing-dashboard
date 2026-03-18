'use strict';
/**
 * EKAPE 원패스 자동화 — Bridge Content Script
 * 대시보드 페이지(localhost / vercel)에서 실행됩니다.
 * window.postMessage → chrome.runtime.sendMessage 중계역할.
 */

window.addEventListener('message', function (event) {
  if (event.source !== window) return;
  if (!event.data || event.data.__ekape !== true) return;

  const payload = event.data;

  chrome.runtime.sendMessage(payload, function (response) {
    if (chrome.runtime.lastError) {
      window.postMessage({ __ekapeResp: true, ok: false, error: chrome.runtime.lastError.message }, '*');
      return;
    }
    window.postMessage(Object.assign({ __ekapeResp: true }, response), '*');
  });
});
