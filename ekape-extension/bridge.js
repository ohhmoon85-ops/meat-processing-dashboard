'use strict';
/**
 * EKAPE 원패스 자동화 — Bridge Content Script
 * 대시보드 페이지(localhost / vercel)에서 실행됩니다.
 * window.postMessage → chrome.runtime.sendMessage 중계역할.
 */

window.addEventListener('message', function (event) {
  if (event.source !== window) return;
  if (!event.data || event.data.__ekape !== true) return;

  // 확장프로그램 컨텍스트 유효성 확인 (재설치/새로고침 후 무효화될 수 있음)
  if (!chrome.runtime || !chrome.runtime.id) {
    window.postMessage({
      __ekapeResp: true, ok: false,
      error: '확장프로그램 컨텍스트가 초기화됐습니다. 대시보드 페이지를 새로고침(F5)해 주세요.',
    }, '*');
    return;
  }

  const payload = event.data;

  try {
    chrome.runtime.sendMessage(payload, function (response) {
      if (chrome.runtime.lastError) {
        window.postMessage({
          __ekapeResp: true, ok: false,
          error: chrome.runtime.lastError.message,
        }, '*');
        return;
      }
      window.postMessage(Object.assign({ __ekapeResp: true }, response), '*');
    });
  } catch (e) {
    window.postMessage({
      __ekapeResp: true, ok: false,
      error: '확장프로그램 오류: 대시보드 페이지를 새로고침(F5)해 주세요.',
    }, '*');
  }
});
