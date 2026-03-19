'use strict';
/**
 * EKAPE 원패스 자동화 — Background Service Worker
 * - 대시보드로부터 메시지 수신 (onMessage: bridge.js / onMessageExternal: 직접 연결)
 * - chrome.storage.local에 작업 저장
 * - EKAPE 원패스 탭 열기/포커스
 */

const JOB_KEY = 'ekape_issue_job';
const EKAPE_MAIN = 'https://www.ekape.or.kr/kapecp/ui/kapecp/index.html';

// ── 메시지 처리 공통 로직 ─────────────────────────────────────
function handleMessage(message, sendResponse) {

  // ── 작업 시작 ──────────────────────────────────────────────
  if (message.type === 'START_ISSUE_JOB') {
    const animals = message.animals || [];
    if (animals.length === 0) {
      sendResponse({ ok: false, error: '개체 목록이 비어있습니다.' });
      return true;
    }

    const job = {
      status: 'running',
      phase: 'LOGIN_WAIT',
      animals: animals.map(function (a) {
        return Object.assign({}, a, { done: false, error: null });
      }),
      currentIndex: 0,
      createdAt: Date.now(),
      log: [],
    };

    const data = {};
    data[JOB_KEY] = job;

    chrome.storage.local.set(data, function () {
      // EKAPE 탭이 이미 열려 있으면 해당 탭을 EKAPE_MAIN으로 이동, 없으면 새 탭
      chrome.tabs.query({}, function (allTabs) {
        var ekapeTab = null;
        // 1순위: 원패스 SPA 메인 (index.html) 탭
        for (var i = 0; i < allTabs.length; i++) {
          var url = allTabs[i].url || '';
          if (url.includes('ekape.or.kr') && url.includes('index.html')) {
            ekapeTab = allTabs[i]; break;
          }
        }
        // 2순위: 기타 ekape.or.kr 탭 (팝업 제외 — 팝업은 openerTabId 있음)
        if (!ekapeTab) {
          for (var j = 0; j < allTabs.length; j++) {
            var u = allTabs[j].url || '';
            if (u.includes('ekape.or.kr') && !allTabs[j].openerTabId) {
              ekapeTab = allTabs[j]; break;
            }
          }
        }
        if (ekapeTab && ekapeTab.id) {
          chrome.tabs.update(ekapeTab.id, { active: true });
        } else {
          chrome.tabs.create({ url: EKAPE_MAIN });
        }
      });
      sendResponse({ ok: true, count: animals.length });
    });
    return true; // async
  }

  // ── 작업 취소 ──────────────────────────────────────────────
  if (message.type === 'CANCEL_JOB') {
    chrome.storage.local.get(JOB_KEY, function (data) {
      const job = data[JOB_KEY];
      if (job) {
        const d = {};
        d[JOB_KEY] = Object.assign({}, job, { status: 'cancelled', phase: 'IDLE' });
        chrome.storage.local.set(d);
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  // ── 작업 상태 조회 (팝업 UI용) ─────────────────────────────
  if (message.type === 'GET_JOB') {
    chrome.storage.local.get(JOB_KEY, function (data) {
      sendResponse(data[JOB_KEY] || null);
    });
    return true;
  }
}

// ── 내부 메시지 (bridge.js content script) ───────────────────
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  return handleMessage(message, sendResponse);
});

// ── 외부 메시지 (대시보드 웹페이지 직접 연결) ───────────────
chrome.runtime.onMessageExternal.addListener(function (message, sender, sendResponse) {
  return handleMessage(message, sendResponse);
});
