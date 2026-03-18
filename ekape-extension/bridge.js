'use strict';
/**
 * EKAPE 원패스 자동화 — Bridge Content Script
 * 대시보드 페이지(localhost / vercel)에서 실행됩니다.
 * window.postMessage → chrome.runtime.sendMessage 중계역할.
 */

window.addEventListener('message', function (event) {
  if (event.source !== window) return;
  if (!event.data || event.data.__ekape !== true) return;

  // 컨텍스트 완전 무효화 시 window.postMessage도 throw할 수 있으므로 항상 try-catch
  function safePost(data) {
    try { window.postMessage(data, '*'); } catch (e2) { /* 무효화된 컨텍스트 — 무시 */ }
  }

  // 확장프로그램 컨텍스트 유효성 확인
  var runtimeOk = false;
  try { runtimeOk = !!(chrome.runtime && chrome.runtime.id); } catch (e) { /* ignore */ }

  if (!runtimeOk) {
    safePost({
      __ekapeResp: true, ok: false,
      error: '확장프로그램 컨텍스트가 초기화됐습니다. 대시보드 페이지를 새로고침(F5)해 주세요.',
    });
    return;
  }

  try {
    chrome.runtime.sendMessage(event.data, function (response) {
      if (chrome.runtime.lastError) {
        safePost({ __ekapeResp: true, ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      safePost(Object.assign({ __ekapeResp: true }, response));
    });
  } catch (e) {
    safePost({
      __ekapeResp: true, ok: false,
      error: '확장프로그램 오류: 대시보드 페이지를 새로고침(F5)해 주세요.',
    });
  }
});
