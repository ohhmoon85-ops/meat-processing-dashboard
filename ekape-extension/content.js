'use strict';
/**
 * EKAPE 원패스 통합증명서 발급 자동화 — Content Script
 *
 * [자동 처리 단계]
 * LOGIN_WAIT     → 로그인 감지 대기 (수동 로그인)
 * NAVIGATE_MENU  → 통합증명서발행 > 통합증명서신청 메뉴 클릭
 * FILL_ANIMAL    → 이력번호 입력, 소/매수인 선택, 조회
 * CLICK_APPLY    → 발급신청 버튼 클릭
 * POPUP          → 팝업: 납품처구분·납품처·발급구분·부위·신청량 입력 후 발급신청
 * NEXT_ANIMAL    → 다음 개체로 이동 (완료 시 NAVIGATE_LIST)
 * NAVIGATE_LIST  → 통합증명서발급 목록 이동
 * SELECT_PRINT   → 당일 조회 → 전체 선택 → 확인서 발행 → 인쇄
 */

const JOB_KEY = 'ekape_issue_job';

// ── 유틸: sleep ───────────────────────────────────────────────
const sleep = function (ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
};

// ── 유틸: 토스트 알림 ─────────────────────────────────────────
function toast(msg, type, dur) {
  dur = dur || 5000;
  const prev = document.getElementById('_ekape_toast');
  if (prev) prev.remove();
  const colors = { info: '#1d4ed8', ok: '#065f46', warn: '#92400e', err: '#991b1b' };
  const icons  = { info: '🤖', ok: '✅', warn: '⚠️', err: '❌' };
  const div = document.createElement('div');
  div.id = '_ekape_toast';
  Object.assign(div.style, {
    position: 'fixed', top: '14px', right: '14px', zIndex: '2147483647',
    background: colors[type] || colors.info, color: '#fff',
    border: '2px solid rgba(255,255,255,.25)', borderRadius: '10px',
    padding: '10px 18px', fontSize: '13px', fontFamily: '\'Malgun Gothic\', sans-serif',
    fontWeight: '600', boxShadow: '0 6px 20px rgba(0,0,0,.35)',
    display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '360px',
    lineHeight: '1.5', cursor: 'pointer',
  });
  div.innerHTML = '<span style="font-size:17px">' + (icons[type] || '🤖') + '</span>' +
                  '<span>' + msg + '</span>';
  div.addEventListener('click', function () { div.remove(); });
  document.body.appendChild(div);
  if (dur > 0) setTimeout(function () { if (div.parentNode) div.remove(); }, dur);
  return div;
}

// ── 유틸: 텍스트로 DOM 요소 찾기 ─────────────────────────────
function findByText(tags, keywords) {
  const els = document.querySelectorAll(tags.join(','));
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var t = (el.textContent || el.value || el.title || '').trim();
    for (var j = 0; j < keywords.length; j++) {
      if (t === keywords[j] || t.includes(keywords[j])) return el;
    }
  }
  return null;
}

// ── 유틸: name 속성으로 input 찾기 ───────────────────────────
function findInputByName(names) {
  for (var i = 0; i < names.length; i++) {
    var el = document.querySelector('[name="' + names[i] + '"]');
    if (el) return el;
  }
  return null;
}

// ── 유틸: 라디오 버튼 선택 ───────────────────────────────────
function clickRadioByText(keywords) {
  var all = document.querySelectorAll('input[type=radio]');
  for (var i = 0; i < all.length; i++) {
    var radio = all[i];
    // 라디오 자체의 value 또는 근처 label 텍스트로 매칭
    var label = document.querySelector('label[for="' + radio.id + '"]');
    var labelText = label ? label.textContent.trim() : '';
    var val = radio.value || '';
    for (var j = 0; j < keywords.length; j++) {
      if (val.includes(keywords[j]) || labelText.includes(keywords[j])) {
        if (!radio.checked) radio.click();
        return true;
      }
    }
  }
  return false;
}

// ── 유틸: 입력값 설정 (React/jQuery 호환) ────────────────────
function setVal(el, value) {
  if (!el) return;
  try {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (setter && setter.set) {
      setter.set.call(el, value);
    } else {
      el.value = value;
    }
  } catch (e) {
    el.value = value;
  }
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ── 유틸: select에서 텍스트 일치 옵션 선택 ──────────────────
function selectByText(selectEl, text) {
  if (!selectEl) return false;
  var opts = selectEl.options;
  for (var i = 0; i < opts.length; i++) {
    if (opts[i].text.includes(text) || text.includes(opts[i].text.trim())) {
      selectEl.value = opts[i].value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  return false;
}

// ── 유틸: 요소가 나타날 때까지 폴링 대기 ────────────────────
function waitFor(selectorOrFn, maxMs, intervalMs) {
  maxMs = maxMs || 8000;
  intervalMs = intervalMs || 400;
  return new Promise(function (resolve, reject) {
    var elapsed = 0;
    var timer = setInterval(function () {
      elapsed += intervalMs;
      var found = typeof selectorOrFn === 'function'
        ? selectorOrFn()
        : document.querySelector(selectorOrFn);
      if (found) {
        clearInterval(timer);
        resolve(found);
      } else if (elapsed >= maxMs) {
        clearInterval(timer);
        reject(new Error('waitFor timeout: ' + selectorOrFn));
      }
    }, intervalMs);
  });
}

// ── 유틸: 납품처 구분 자동 감지 ──────────────────────────────
function guessDestType(name) {
  var n = name || '';
  if (/초등|중학|고등|학교/.test(n)) return '급식학교';
  if (/유치원/.test(n))             return '유치원';
  if (/어린이집/.test(n))           return '어린이집';
  if (/군|부대|사단|연대|대대/.test(n)) return '군부대';
  if (/병원|의원|클리닉/.test(n))   return '의료기관';
  if (/복지|노인|장애/.test(n))     return '사회복지시설';
  return '급식학교';
}

// ── 유틸: 오늘 날짜 YYYYMMDD ─────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

// ── 로그인 확인 ───────────────────────────────────────────────
function isLoggedIn() {
  // 1. 선택자 기반 (logout 링크, 사용자 정보 영역)
  var checks = [
    'a[href*="logout"]', 'a[href*="logOut"]', 'a[href*="Logout"]',
    '[onclick*="logout"]', '[onclick*="logOut"]',
    '.logout', '#logout', '.user-name', '#userNm', '.mypage',
    'a[href*="mypage"]', 'a[href*="myPage"]',
  ];
  if (checks.some(function (s) { return !!document.querySelector(s); })) return true;

  // 2. 텍스트 기반 — 로그아웃·마이페이지 링크가 보이면 로그인 상태
  var links = document.querySelectorAll('a');
  for (var i = 0; i < links.length; i++) {
    var t = links[i].textContent.trim();
    if (t === '로그아웃' || t === '마이페이지' || t === '로그 아웃') return true;
  }

  // 3. 통합증명서발행 메뉴가 보이면 로그인 상태 (로그인 후에만 노출되는 메뉴)
  var body = document.body ? document.body.innerText : '';
  if (body.includes('통합증명서발행') || body.includes('통합증명서 발행')) return true;

  return false;
}

// ── chrome.storage 저장/로드 ─────────────────────────────────
function saveJob(job) {
  var d = {};
  d[JOB_KEY] = job;
  chrome.storage.local.set(d);
}

function getJob() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(JOB_KEY, function (data) {
      resolve(data[JOB_KEY] || null);
    });
  });
}

// ── 상태 전이 ────────────────────────────────────────────────
function transition(job, newPhase, extra) {
  job.phase = newPhase;
  if (extra) Object.assign(job, extra);
  saveJob(job);
}

// ── 페이지 타입 감지 ─────────────────────────────────────────
// EKAPE 원패스는 SPA (index.html) → URL이 아닌 DOM 내용으로 구분
function detectPage() {
  var body = document.body ? document.body.innerText : '';

  // 발급신청 팝업: window.opener 있고 납품처구분/발급신청정보 텍스트 있음
  // (등급판정확인서 열람 팝업 등 다른 팝업과 구별)
  if (window.opener &&
      (body.includes('납품처구분') || body.includes('발급신청정보') || body.includes('확인서발급신청'))) {
    return 'POPUP';
  }
  // 통합증명서발급현황 페이지: '신청구분' 없고 '통합증명서발급현황' 또는 확인서원본발행 버튼
  if (!body.includes('신청구분') &&
      (body.includes('통합증명서발급현황') || body.includes('확인서원본발행'))) {
    return 'LIST';
  }
  // 통합증명서신청 폼: '신청구분' 라디오가 이 페이지에만 있음
  if (body.includes('신청구분')) {
    return 'REQUEST';
  }
  return 'OTHER';
}

// ══════════════════════════════════════════════════════════════
//  LOGIN_WAIT → NAVIGATE_MENU
// ══════════════════════════════════════════════════════════════
async function phaseLoginWait(job) {
  var goNext = async function () {
    transition(job, 'NAVIGATE_MENU');
    phaseNavigateMenu(job);
  };

  // 이미 로그인 되어 있으면 바로 이동
  if (isLoggedIn()) {
    toast('로그인 확인! 메뉴로 이동합니다.', 'ok');
    await sleep(800);
    goNext();
    return;
  }

  // 로그인 안내 토스트 + 수동 "계속" 버튼
  showLoginToast(job, goNext);

  // 5초마다 자동 감지 시도
  var timer = setInterval(async function () {
    if (isLoggedIn()) {
      clearInterval(timer);
      var prev = document.getElementById('_ekape_toast');
      if (prev) prev.remove();
      toast('로그인 감지! 메뉴로 이동합니다.', 'ok');
      await sleep(800);
      goNext();
    }
  }, 5000);
}

// ── 로그인 대기 토스트 (수동 "계속" 버튼 포함) ───────────────
function showLoginToast(job, goNext) {
  var prev = document.getElementById('_ekape_toast');
  if (prev) prev.remove();

  var div = document.createElement('div');
  div.id = '_ekape_toast';
  Object.assign(div.style, {
    position: 'fixed', top: '14px', right: '14px', zIndex: '2147483647',
    background: '#1d4ed8', color: '#fff',
    border: '2px solid rgba(255,255,255,.25)', borderRadius: '10px',
    padding: '12px 16px', fontSize: '13px',
    fontFamily: '\'Malgun Gothic\', sans-serif',
    boxShadow: '0 6px 20px rgba(0,0,0,.35)',
    display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '300px',
  });

  var total = job.animals ? job.animals.length : 0;
  div.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;font-weight:700">' +
      '<span style="font-size:18px">🤖</span>' +
      '<span>EKAPE 원패스에 로그인해 주세요<br>' +
      '<small style="font-weight:400;opacity:.85">로그인 후 아래 버튼을 클릭하면<br>' +
      total + '건 통합증명서 신청을 자동으로 진행합니다</small></span>' +
    '</div>' +
    '<button id="_ekape_continue_btn" style="' +
      'padding:8px 12px;background:#fff;color:#1d4ed8;border:none;' +
      'border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;' +
      'width:100%;letter-spacing:.3px' +
    '">✅ 로그인 완료 → 자동화 시작</button>';

  document.body.appendChild(div);

  document.getElementById('_ekape_continue_btn').addEventListener('click', async function () {
    div.remove();
    toast('자동화 시작!', 'ok');
    await sleep(500);
    goNext();
  });
}

// ══════════════════════════════════════════════════════════════
//  NAVIGATE_MENU → 통합증명서발행 > 통합증명서신청 클릭
// ══════════════════════════════════════════════════════════════
async function phaseNavigateMenu(job) {
  toast('통합증명서신청 메뉴로 이동 중...', 'info');
  await sleep(500);

  // 1단계: 통합증명서발행 상위 메뉴 클릭
  var menuEl = findByText(['a', 'li', 'span', 'td', 'div'], ['통합증명서발행', '통합증명서 발행']);
  if (menuEl) {
    menuEl.click();
    await sleep(1200);
  }

  // 2단계: 통합증명서신청 서브메뉴 클릭
  var subEl = findByText(['a', 'li', 'span', 'td'], ['통합증명서신청', '통합증명서 신청']);
  if (subEl) {
    subEl.click();
    toast('통합증명서신청 메뉴 클릭! 페이지 이동 중...', 'info');

    // 즉시 FILL_ANIMAL로 전환
    // → 전체 페이지 이동이면 새 content.js가 이 phase를 이어받음
    // → iframe이면 해당 frame의 content.js가 이어받음
    // → AJAX면 아래 MutationObserver가 감지해 처리
    transition(job, 'FILL_ANIMAL');

    var obs = new MutationObserver(async function () {
      if (document.body.innerText.includes('이력번호') && document.body.innerText.includes('매수인')) {
        obs.disconnect();
        clearTimeout(obsTimeout);
        var freshJob = await getJob();
        if (freshJob && freshJob.status === 'running' && freshJob.phase === 'FILL_ANIMAL') {
          toast('통합증명서신청 폼 감지!', 'ok');
          await sleep(500);
          phaseFillAnimal(freshJob);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    // 20초 후 observer 해제 (iframe/전체이동으로 이미 처리됐을 수 있음)
    var obsTimeout = setTimeout(function () { obs.disconnect(); }, 20000);
    return;
  }

  // 메뉴를 찾지 못한 경우 사용자에게 안내
  toast('메뉴를 찾지 못했습니다. 통합증명서발행 > 통합증명서신청을 수동으로 클릭해 주세요.', 'warn', 0);

  // 수동 클릭 후 페이지 감지
  var observer = new MutationObserver(async function () {
    if (document.body.innerText.includes('이력번호') && document.body.innerText.includes('매수인')) {
      observer.disconnect();
      toast('통합증명서신청 페이지 감지!', 'ok');
      await sleep(800);
      transition(job, 'FILL_ANIMAL');
      phaseFillAnimal(job);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

// ══════════════════════════════════════════════════════════════
//  FILL_ANIMAL → 소 선택, 매수인 선택, 이력번호 입력, 조회
// ══════════════════════════════════════════════════════════════
async function phaseFillAnimal(job) {
  // 통합증명서신청 폼인지 확인 ('신청구분' 라디오가 있어야 함)
  if (!document.body.innerText.includes('신청구분')) {
    try {
      await waitFor(function () {
        return document.body.innerText.includes('신청구분');
      }, 8000);
    } catch (e) {
      return; // 통합증명서신청 폼이 아님 — 실행하지 않음
    }
  }

  var animal = job.animals[job.currentIndex];
  var total  = job.animals.length;
  toast('[' + (job.currentIndex + 1) + '/' + total + '] ' +
        animal.animalNumber + ' — ' + (animal.destination || '') + ' 처리 중', 'info');

  await sleep(600);

  // ① 동물 종류 탭 클릭 (소/돼지/닭 — 탭 버튼)
  var animalType = animal.animalType || '소';
  var tabs = document.querySelectorAll('button, a, li, td');
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].textContent.trim() === animalType) {
      tabs[i].click();
      break;
    }
  }
  await sleep(600);

  // ② 신청구분: 매수인 라디오 선택
  clickRadioByText(['매수인']);
  await sleep(400);

  // ③ 이력번호 입력 (필터 영역 — 이력번호 라벨 근처 input)
  var lsNoInput = findInputByName(['lsNo', 'animalNo', 'traceNo', 'histNo', 'animalHistNo']) ||
                  document.querySelector('input[placeholder*="이력번호"], input[placeholder*="개체번호"]');

  // 라벨 텍스트로 근처 input 탐색
  if (!lsNoInput) {
    var allTh = document.querySelectorAll('th, td, label, span');
    for (var k = 0; k < allTh.length; k++) {
      if (allTh[k].textContent.trim() === '이력번호') {
        var row = allTh[k].closest('tr, div');
        if (row) {
          var inputs = row.querySelectorAll('input[type=text], input:not([type])');
          if (inputs.length > 0) { lsNoInput = inputs[inputs.length - 1]; break; }
        }
      }
    }
  }

  if (lsNoInput) {
    setVal(lsNoInput, animal.animalNumber);
    await sleep(300);
    // 이력번호 input에 포커스 (사용자가 바로 조회 클릭할 수 있도록)
    lsNoInput.focus();
  } else {
    toast('[' + animal.animalNumber + '] 이력번호 입력 필드를 찾지 못했습니다.', 'warn');
  }

  // ── 여기서 자동화 중단 ──
  // 이후 조회 → 결과 행 클릭 → 팝업 입력 → 발급신청은 수동으로 진행
  // 팝업이 닫히면 다음 동물로 자동 이동
  var remaining = job.animals.length - job.currentIndex - 1;
  var remainMsg = remaining > 0 ? ' (이후 ' + remaining + '건 자동 이동)' : ' (마지막 건)';

  transition(job, 'CLICK_APPLY');
  _popupRef = null;

  // 수동 발급신청 안내 토스트
  toast('✅ [' + (job.currentIndex + 1) + '/' + job.animals.length + '] 이력번호 입력 완료' + remainMsg +
        '\n▶ 조회 → 결과 행 클릭 → 팝업 입력 → 발급신청을 수동으로 진행하세요.\n팝업을 닫으면 다음 동물로 자동 이동합니다.',
        'ok', 0);

  // 팝업 열림/닫힘 감지 → 다음 동물로 이동
  waitForManualApply(job);
}

// ══════════════════════════════════════════════════════════════
//  수동 발급신청 대기 (자동 탐색 실패 시)
// ══════════════════════════════════════════════════════════════
function waitForManualApply(job) {
  var observer = new MutationObserver(async function () {
    var btn = findByText(['button', 'input', 'a'], ['발급신청']);
    if (btn) {
      observer.disconnect();
      toast('발급신청 버튼 감지!', 'ok');
      await sleep(500);
      transition(job, 'CLICK_APPLY');
      phaseClickApply(job);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ══════════════════════════════════════════════════════════════
//  CLICK_APPLY → 발급신청 버튼 클릭, 팝업 추적
// ══════════════════════════════════════════════════════════════
var _popupRef = null;

function interceptWindowOpen() {
  var origOpen = window.open;
  window.open = function () {
    var popup = origOpen.apply(window, arguments);
    _popupRef = popup;
    return popup;
  };
}

async function phaseClickApply(job) {
  var applyBtn = findByText(['button', 'input', 'a'], ['발급신청']);
  if (!applyBtn) {
    toast('발급신청 버튼을 찾지 못했습니다.', 'err');
    return;
  }

  _popupRef = null;
  applyBtn.click();

  // 팝업이 열렸는지 최대 4초 대기
  var waited = 0;
  var popupCheckTimer = setInterval(function () {
    waited += 300;
    if (_popupRef && !_popupRef.closed) {
      clearInterval(popupCheckTimer);
      toast('발급신청 팝업 열림. 입력 중...', 'info');
      waitForPopupClose(job);
    } else if (waited > 4000) {
      clearInterval(popupCheckTimer);
      // 팝업 차단됐을 가능성 → 사용자 안내
      toast('팝업이 열리지 않았습니다. 브라우저 팝업 차단을 해제하거나 수동으로 발급신청을 클릭하세요.', 'warn', 0);
    }
  }, 300);
}

// ── 팝업 닫힘 감지 → 다음 동물로 ────────────────────────────
function waitForPopupClose(job) {
  var timer = setInterval(async function () {
    if (_popupRef && _popupRef.closed) {
      clearInterval(timer);
      _popupRef = null;
      await sleep(600);
      phaseNextAnimal(job);
    }
  }, 400);
  // 3분 타임아웃
  setTimeout(function () { clearInterval(timer); }, 180000);
}

// ══════════════════════════════════════════════════════════════
//  POPUP 페이지: 납품처구분·납품처·발급구분·부위·신청량 자동 입력
// ══════════════════════════════════════════════════════════════
async function phasePopup(job) {
  var animal = job.animals[job.currentIndex];
  toast('발급신청 팝업: ' + animal.animalNumber + ' 입력 중...', 'info');

  // 팝업 DOM 로드 대기
  try {
    await waitFor(function () {
      return document.body.innerText.includes('납품처구분') ||
             document.body.innerText.includes('발급신청정보');
    }, 8000);
  } catch (e) {
    toast('팝업 로드 실패. 수동으로 입력 후 발급신청을 클릭하세요. 팝업 닫으면 자동 진행됩니다.', 'warn', 0);
    return;
  }
  await sleep(800);

  // ① 납품처구분 select (급식학교/유치원/군부대 등)
  var selects = document.querySelectorAll('select');
  var destTypeEl = null;
  for (var i = 0; i < selects.length; i++) {
    var opts = selects[i].options;
    for (var oi = 0; oi < opts.length; oi++) {
      if (opts[oi].text.includes('급식학교') || opts[oi].text.includes('유치원') ||
          opts[oi].text.includes('군부대') || opts[oi].text.includes('의료기관')) {
        destTypeEl = selects[i];
        break;
      }
    }
    if (destTypeEl) break;
  }
  if (destTypeEl) {
    var destType = guessDestType(animal.destination);
    if (!selectByText(destTypeEl, destType)) {
      // 첫 번째 비어있지 않은 옵션 선택
      for (var j = 1; j < destTypeEl.options.length; j++) {
        if (destTypeEl.options[j].value) {
          destTypeEl.value = destTypeEl.options[j].value;
          destTypeEl.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }
    await sleep(800); // 납품처 드롭다운 갱신 대기
  }

  // ② 납품처 select (납품처구분 선택 후 옵션이 채워짐)
  // 납품처구분 바로 다음 select가 납품처 select일 가능성이 높음
  var destEl = null;
  if (destTypeEl) {
    var nextEl = destTypeEl.closest('tr, td')
      ? destTypeEl.closest('tr').nextElementSibling
      : null;
    if (nextEl) destEl = nextEl.querySelector('select');
    if (!destEl) {
      // 모든 select 중 납품처구분 select 다음 select
      for (var si = 0; si < selects.length - 1; si++) {
        if (selects[si] === destTypeEl) { destEl = selects[si + 1]; break; }
      }
    }
  }
  if (destEl && animal.destination) {
    var name = (animal.destination || '').replace(/\(.*?\)/g, '').trim();
    if (!selectByText(destEl, name)) {
      toast('납품처 "' + name + '"를 목록에서 찾지 못했습니다. 수동 선택 필요.', 'warn', 0);
    }
    await sleep(400);
  }

  // ③ 발급구분 라디오: 검수용 발급 (기본값 유지) — 필요 시 animal.issueType으로 선택
  if (animal.issueType) {
    clickRadioByText([animal.issueType]);
  }
  await sleep(300);

  // ④ 부위 select
  var cutEl = null;
  for (var ci = 0; ci < selects.length; ci++) {
    var copts = selects[ci].options;
    for (var coi = 0; coi < copts.length; coi++) {
      if (copts[coi].text.includes('양지') || copts[coi].text.includes('등심') ||
          copts[coi].text.includes('갈비') || copts[coi].text.includes('안심')) {
        cutEl = selects[ci];
        break;
      }
    }
    if (cutEl) break;
  }
  if (cutEl && animal.cutName) {
    if (!selectByText(cutEl, animal.cutName)) {
      toast('부위 "' + animal.cutName + '"을 드롭다운에서 찾지 못했습니다. 수동 선택 필요.', 'warn', 0);
    }
    await sleep(300);
  }

  // ⑤ 신청량 입력
  var amtInput = findInputByName(['reqAmt', 'issueAmt', 'splyAmt', 'amt', 'weight', 'reqWeight']) ||
    document.querySelector('input[placeholder*="신청량"], input[placeholder*="중량"]');
  // kg 단위 옆 input 찾기
  if (!amtInput) {
    var kgSpans = document.querySelectorAll('span, td');
    for (var ki = 0; ki < kgSpans.length; ki++) {
      if (kgSpans[ki].textContent.trim() === 'kg') {
        var prev = kgSpans[ki].previousElementSibling;
        if (prev && prev.tagName === 'INPUT') { amtInput = prev; break; }
        var parent = kgSpans[ki].closest('td, div');
        if (parent) {
          var inp = parent.querySelector('input');
          if (inp) { amtInput = inp; break; }
        }
      }
    }
  }
  if (amtInput && animal.weightKg) {
    setVal(amtInput, String(animal.weightKg));
    await sleep(300);
  } else if (!amtInput) {
    toast('신청량 입력란을 찾지 못했습니다. 수동 입력 후 발급신청을 클릭하세요. 팝업 닫으면 자동 진행됩니다.', 'warn', 0);
    return;
  }

  // ⑥ 발급신청 버튼 클릭
  await sleep(400);
  var submitBtn = findByText(['button', 'input'], ['발급신청']);
  if (submitBtn) {
    toast('발급신청 클릭!', 'ok');
    submitBtn.click();
  } else {
    toast('발급신청 버튼을 찾지 못했습니다. 수동으로 클릭해 주세요. 팝업 닫으면 자동 진행됩니다.', 'warn', 0);
  }
}

// ══════════════════════════════════════════════════════════════
//  NEXT_ANIMAL → 다음 개체로 이동 또는 목록으로
// ══════════════════════════════════════════════════════════════
async function phaseNextAnimal(job) {
  // 현재 개체 완료 표시
  job.animals[job.currentIndex].done = true;
  job.currentIndex++;
  saveJob(job);

  var remaining = job.animals.length - job.currentIndex;

  if (remaining <= 0) {
    // 모든 개체 완료
    toast('전체 ' + job.animals.length + '건 발급신청 완료!\n통합증명서발급 목록으로 이동합니다.', 'ok');
    await sleep(1200);
    transition(job, 'NAVIGATE_LIST');
    phaseNavigateList(job);
  } else {
    toast('다음 개체로 이동... (남은 ' + remaining + '건)', 'info');
    await sleep(1000);
    transition(job, 'FILL_ANIMAL');
    phaseFillAnimal(job);
  }
}

// ══════════════════════════════════════════════════════════════
//  NAVIGATE_LIST → 통합증명서발급 목록으로 이동
// ══════════════════════════════════════════════════════════════
async function phaseNavigateList(job) {
  toast('통합증명서발급 목록 이동 중...', 'info');
  await sleep(500);

  // 메뉴에서 통합증명서발급 클릭
  var listMenuEl = findByText(['a', 'li', 'span', 'td'], ['통합증명서발급', '통합증명서 발급', '발급목록', '발급 목록']);
  if (listMenuEl) {
    listMenuEl.click();
    try {
      await waitFor(function () {
        return document.body.innerText.includes('확인서 발행') ||
               document.body.innerText.includes('발급목록');
      }, 10000);
      transition(job, 'SELECT_PRINT');
      await sleep(800);
      phaseSelectPrint(job);
    } catch (e) {
      toast('발급 목록 페이지를 찾지 못했습니다. 수동으로 이동해 주세요.', 'warn', 0);
      waitForListPage(job);
    }
    return;
  }

  toast('발급 목록 메뉴를 찾지 못했습니다. 통합증명서발급 > 발급 목록을 수동으로 클릭하세요.', 'warn', 0);
  waitForListPage(job);
}

function waitForListPage(job) {
  var obs = new MutationObserver(async function () {
    if (document.body.innerText.includes('확인서 발행')) {
      obs.disconnect();
      await sleep(800);
      transition(job, 'SELECT_PRINT');
      phaseSelectPrint(job);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
}

// ══════════════════════════════════════════════════════════════
//  SELECT_PRINT → 당일 날짜 조회 → 전체 선택 → 확인서 발행
// ══════════════════════════════════════════════════════════════
async function phaseSelectPrint(job) {
  toast('발급 목록: 오늘 날짜로 조회 중...', 'info');
  await sleep(600);

  // ① 소 선택 (동물 종류 필터)
  var cattleFilter = document.querySelector('select[name*="lsType"], select[name*="kindCd"], select[name*="cattle"]');
  if (cattleFilter) {
    selectByText(cattleFilter, '소');
    await sleep(400);
  }

  // ② 오늘 날짜 입력
  var today = todayStr();
  // 다양한 날짜 입력 필드 이름 시도
  ['startDt', 'fromDt', 'regStartDt', 'issueStartDt', 'searchFromDt'].forEach(function (nm) {
    var el = document.querySelector('[name="' + nm + '"], [id="' + nm + '"]');
    if (el) setVal(el, today);
  });
  ['endDt', 'toDt', 'regEndDt', 'issueEndDt', 'searchToDt'].forEach(function (nm) {
    var el = document.querySelector('[name="' + nm + '"], [id="' + nm + '"]');
    if (el) setVal(el, today);
  });
  await sleep(500);

  // ③ 조회 버튼 클릭
  var queryBtn = findByText(['button', 'input'], ['조회', '검색']);
  if (queryBtn) { queryBtn.click(); await sleep(2000); }

  // ④ 전체 선택 체크박스
  var allChk = document.querySelector(
    'th input[type=checkbox], input[id*="allChk"], input[id*="chkAll"], input[name*="allChk"]'
  );
  if (allChk && !allChk.checked) {
    allChk.click();
    await sleep(400);
  } else {
    // 개별 체크박스 모두 선택
    var chks = document.querySelectorAll('td input[type=checkbox]');
    chks.forEach(function (c) { if (!c.checked) c.click(); });
    await sleep(400);
  }

  // ⑤ 확인서 발행 버튼 클릭
  var issueBtn = findByText(['button', 'input', 'a'], ['확인서 발행', '확인서발행', '발행']);
  if (issueBtn) {
    toast('확인서 발행 클릭! 인쇄 창을 확인하세요.', 'ok');
    issueBtn.click();
    await sleep(1000);
    // 완료
    job.status = 'done';
    job.phase  = 'DONE';
    saveJob(job);
    toast('✅ 통합증명서 발급 자동화 완료! (' + job.animals.length + '건)', 'ok', 8000);
  } else {
    toast('확인서 발행 버튼을 찾지 못했습니다. 목록에서 항목을 선택 후 수동으로 "확인서 발행"을 클릭하세요.', 'warn', 0);
  }
}

// ══════════════════════════════════════════════════════════════
//  메인 진입점
// ══════════════════════════════════════════════════════════════
async function main() {
  // window.open 항상 인터셉트 (팝업 추적용)
  interceptWindowOpen();

  var job = await getJob();
  if (!job || job.status !== 'running') return;

  var page = detectPage();

  if (page === 'POPUP') {
    // 팝업 페이지: 납품처 등 입력 후 발급신청
    await phasePopup(job);
    return;
  }

  if (page === 'REQUEST') {
    // 통합증명서신청 페이지: 이미 도달한 경우
    if (job.phase === 'NAVIGATE_MENU' || job.phase === 'FILL_ANIMAL' || job.phase === 'CLICK_APPLY') {
      await phaseFillAnimal(job);
    }
    return;
  }

  if (page === 'LIST') {
    // 통합증명서발급 목록 페이지
    if (job.phase === 'NAVIGATE_LIST' || job.phase === 'SELECT_PRINT') {
      await phaseSelectPrint(job);
    }
    return;
  }

  // OTHER: 로그인 → 메뉴 이동 시작
  if (job.phase === 'LOGIN_WAIT') {
    await phaseLoginWait(job);
  } else if (job.phase === 'NAVIGATE_MENU') {
    if (isLoggedIn()) {
      await phaseNavigateMenu(job);
    } else {
      await phaseLoginWait(job);
    }
  } else if (job.phase === 'FILL_ANIMAL' || job.phase === 'CLICK_APPLY') {
    // 통합증명서신청 폼('신청구분')이 나타날 때까지 대기
    toast('통합증명서신청 폼 대기 중...', 'info', 3000);
    var fillObs = new MutationObserver(async function () {
      if (document.body.innerText.includes('신청구분')) {
        fillObs.disconnect();
        clearTimeout(fillObsTimeout);
        var freshJob = await getJob();
        if (freshJob && freshJob.status === 'running') {
          toast('통합증명서신청 폼 감지!', 'ok');
          await sleep(500);
          await phaseFillAnimal(freshJob);
        }
      }
    });
    fillObs.observe(document.body, { childList: true, subtree: true, characterData: true });
    var fillObsTimeout = setTimeout(function () {
      fillObs.disconnect();
      toast('통합증명서신청 폼을 찾지 못했습니다. 수동으로 통합증명서신청 페이지로 이동해 주세요.', 'warn', 0);
    }, 30000);

    // 이미 폼이 있으면 즉시 처리
    await sleep(600);
    if (document.body.innerText.includes('신청구분')) {
      fillObs.disconnect();
      clearTimeout(fillObsTimeout);
      await phaseFillAnimal(job);
    }
  }
}

// ── storage 변경 감지: 모든 프레임(iframe 포함)에서 phase 전환 즉시 반응 ──
// main()은 페이지 첫 로드 시 1회만 실행되므로,
// 다른 프레임에서 phase가 바뀌면 이 리스너가 해당 프레임의 처리를 맡음
chrome.storage.onChanged.addListener(async function (changes, area) {
  if (area !== 'local' || !changes[JOB_KEY]) return;
  var newJob = changes[JOB_KEY].newValue;
  if (!newJob || newJob.status !== 'running') return;

  var page = detectPage();

  // FILL_ANIMAL로 전환됐고, 이 프레임/창이 통합증명서신청 폼이면 즉시 처리
  if (newJob.phase === 'FILL_ANIMAL' && page === 'REQUEST') {
    await sleep(800);
    var freshJob = await getJob();
    if (freshJob && freshJob.status === 'running' && freshJob.phase === 'FILL_ANIMAL') {
      toast('폼 감지 (프레임)! 자동 입력 시작...', 'ok');
      await phaseFillAnimal(freshJob);
    }
    return;
  }

  // NAVIGATE_LIST로 전환됐고, 이 프레임이 LIST 페이지면 즉시 처리
  if (newJob.phase === 'NAVIGATE_LIST' && page === 'LIST') {
    await sleep(800);
    var freshJob2 = await getJob();
    if (freshJob2 && freshJob2.status === 'running' && freshJob2.phase === 'NAVIGATE_LIST') {
      await phaseSelectPrint(freshJob2);
    }
    return;
  }
});

// 실행
main();
