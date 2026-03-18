'use strict';
/**
 * EKAPE 원패스 자동화 — Background Service Worker
 * - 대시보드(bridge.js)로부터 START_ISSUE_JOB 수신
 * - chrome.storage.local에 작업 저장
 * - EKAPE 원패스 탭 열기/포커스
 */

const JOB_KEY = 'ekape_issue_job';
const EKAPE_MAIN = 'https://www.ekape.or.kr/kapecp/oneservicemng/oneSrvcMng/combineSearchOne.do';

// ── 대시보드(bridge.js)로부터 내부 메시지 수신 ──────────────
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {

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
      // EKAPE 탭이 이미 열려 있으면 포커스, 없으면 새로 열기
      chrome.tabs.query({ url: '*://www.ekape.or.kr/*' }, function (tabs) {
        if (tabs && tabs.length > 0) {
          chrome.tabs.update(tabs[0].id, { active: true });
          chrome.tabs.reload(tabs[0].id);
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
});
