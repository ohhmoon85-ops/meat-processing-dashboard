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
  var checks = ['a[href*="logout"]', 'a[href*="logOut"]', '[onclick*="logout"]',
                '.logout', '#logout', '.user-name', '#userNm', '.mypage'];
  return checks.some(function (s) { return !!document.querySelector(s); });
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
function detectPage() {
  var body = document.body ? document.body.innerText : '';
  // 발급신청 팝업 (window.opener 있음 + 납품처/부위 관련 텍스트)
  if (window.opener && (body.includes('납품처') || body.includes('부위') || body.includes('발급신청'))) {
    return 'POPUP';
  }
  // 통합증명서신청 페이지 (이력번호 입력 폼 + 매수인 라디오)
  if (body.includes('통합증명서') && body.includes('이력번호') && body.includes('매수인')) {
    return 'REQUEST';
  }
  // 통합증명서발급 목록 페이지
  if (body.includes('통합증명서') && (body.includes('확인서 발행') || body.includes('발급목록'))) {
    return 'LIST';
  }
  return 'OTHER';
}

// ══════════════════════════════════════════════════════════════
//  LOGIN_WAIT → NAVIGATE_MENU
// ══════════════════════════════════════════════════════════════
async function phaseLoginWait(job) {
  // 이미 로그인 되어 있으면 바로 이동
  if (isLoggedIn()) {
    toast('로그인 확인! 메뉴로 이동합니다.', 'ok');
    await sleep(800);
    transition(job, 'NAVIGATE_MENU');
    phaseNavigateMenu(job);
    return;
  }
  toast('EKAPE 원패스에 로그인해 주세요. 로그인 후 자동으로 진행됩니다.', 'info', 0);

  var retries = 0;
  var timer = setInterval(async function () {
    retries++;
    if (isLoggedIn()) {
      clearInterval(timer);
      toast('로그인 확인! 메뉴로 이동합니다.', 'ok');
      await sleep(1000);
      transition(job, 'NAVIGATE_MENU');
      phaseNavigateMenu(job);
    } else if (retries > 120) { // 10분
      clearInterval(timer);
      toast('로그인 대기 시간 초과. 수동으로 진행해 주세요.', 'err');
    }
  }, 5000);
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
    toast('통합증명서신청 페이지 로딩 중...', 'info');
    // 폼이 로드되길 기다림
    try {
      await waitFor(function () {
        return document.body.innerText.includes('이력번호') &&
               document.body.innerText.includes('매수인');
      }, 10000);
      transition(job, 'FILL_ANIMAL');
      phaseFillAnimal(job);
    } catch (e) {
      toast('통합증명서신청 페이지를 찾지 못했습니다. 수동으로 메뉴를 클릭해 주세요.', 'warn', 0);
    }
    return;
  }

  // 메뉴를 찾지 못한 경우 사용자에게 안내
  toast('메뉴를 찾지 못했습니다. 통합증명서발행 > 통합증명서신청을 수동으로 클릭해 주세요.\n클릭 후 이 안내는 자동으로 사라집니다.', 'warn', 0);

  // 페이지가 바뀌길 감지 (MutationObserver)
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
  var animal = job.animals[job.currentIndex];
  var total  = job.animals.length;
  toast('[' + (job.currentIndex + 1) + '/' + total + '] ' +
        animal.animalNumber + ' — ' + (animal.destination || '') + ' 처리 중', 'info');

  await sleep(600);

  // 소(한우/육우) 라디오 선택
  var cattleSelected = clickRadioByText(['소', '한우', '육우', 'CATTLE', '01']);
  if (!cattleSelected) {
    // value가 "1" 또는 "01"인 라디오 시도
    var radios = document.querySelectorAll('input[type=radio]');
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].value === '1' || radios[i].value === '01') {
        radios[i].click(); break;
      }
    }
  }
  await sleep(400);

  // 매수인 라디오 선택
  clickRadioByText(['매수인', '매수', 'BUYER']);
  await sleep(400);

  // 이력번호 입력
  var lsNoInput = findInputByName(['lsNo', 'animalNo', 'traceNo', 'histNo', 'cattleNo']) ||
                  document.querySelector('input[placeholder*="이력번호"], input[placeholder*="개체번호"]') ||
                  findByText(['input'], []);

  // 이력번호 input이 없으면 텍스트 기반으로 가장 긴 text input 찾기
  if (!lsNoInput) {
    var allInputs = document.querySelectorAll('input[type=text], input:not([type])');
    for (var ii = 0; ii < allInputs.length; ii++) {
      if (allInputs[ii].offsetParent !== null) { // visible
        lsNoInput = allInputs[ii];
        break;
      }
    }
  }

  if (lsNoInput) {
    setVal(lsNoInput, animal.animalNumber);
  } else {
    toast('[' + animal.animalNumber + '] 이력번호 입력 필드를 찾지 못했습니다.', 'warn');
  }
  await sleep(500);

  // 조회 버튼 클릭
  var queryBtn = findByText(['button', 'input', 'a'], ['조회', '검색', 'Search']);
  if (queryBtn) {
    queryBtn.click();
    toast('조회 중...', 'info');
  }

  // 결과 대기 후 발급신청 클릭
  try {
    await waitFor(function () {
      return findByText(['button', 'input', 'a'], ['발급신청']);
    }, 8000);
    await sleep(600);
    transition(job, 'CLICK_APPLY');
    phaseClickApply(job);
  } catch (e) {
    toast('[' + animal.animalNumber + '] 조회 결과가 나타나지 않았습니다. 수동으로 발급신청을 클릭해 주세요.', 'warn', 0);
    waitForManualApply(job);
  }
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
  await sleep(1000);

  // ① 납품처 구분 select
  var destTypeEl = findInputByName(['splyPlcCd', 'destTypeCd', 'plcTypeCd', 'custTypeCd']) ||
    document.querySelector('select[name*="Type"], select[name*="type"], select[name*="Cd"]');
  if (destTypeEl && destTypeEl.tagName === 'SELECT') {
    var destType = guessDestType(animal.destination);
    if (!selectByText(destTypeEl, destType)) {
      // 첫 번째 비어있지 않은 옵션 선택
      var opts = destTypeEl.options;
      for (var i = 1; i < opts.length; i++) {
        if (opts[i].value) { destTypeEl.value = opts[i].value; break; }
      }
      destTypeEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await sleep(600);
  }

  // ② 납품처 입력 (자동완성)
  var destInput = findInputByName(['splyPlcNm', 'destNm', 'custNm', 'plcNm']) ||
    document.querySelector('input[placeholder*="납품처"], input[placeholder*="업체"]');
  if (destInput) {
    var searchName = (animal.destination || '').replace(/\(.*?\)/g, '').trim();
    destInput.focus();
    setVal(destInput, searchName);
    await sleep(1500);

    // 자동완성 드롭다운 탐색
    var dropdown = document.querySelector(
      'ul.ui-autocomplete, .autocomplete-list, [class*="suggest"], [class*="dropdown"] ul, .search-list'
    );
    if (dropdown) {
      var items = dropdown.querySelectorAll('li, a, div[role="option"]');
      var matched = null;
      for (var ii = 0; ii < items.length; ii++) {
        if (items[ii].textContent.includes(searchName)) { matched = items[ii]; break; }
      }
      if (matched) {
        matched.click();
      } else if (items.length > 0) {
        items[0].click();
        toast('납품처 첫 번째 검색 결과를 선택했습니다. 확인 후 수동 수정이 필요할 수 있습니다.', 'warn');
      }
      await sleep(600);
    } else {
      // 검색 버튼이 있으면 클릭
      var searchBtn = findByText(['button', 'a', 'input'], ['검색', '조회']);
      if (searchBtn) { searchBtn.click(); await sleep(1000); }
      var items2 = document.querySelectorAll('.search-result li, .result-list li');
      if (items2.length > 0) items2[0].click();
    }
  } else {
    toast('납품처 입력란을 찾지 못했습니다. 수동으로 입력해 주세요.', 'warn');
  }
  await sleep(500);

  // ③ 발급구분 라디오: "급수불 발급" 선택
  if (!clickRadioByText(['급수불 발급', '급수불', '급수'])) {
    // 첫 번째 라디오 선택
    var radios = document.querySelectorAll('input[type=radio]');
    if (radios.length > 0 && !radios[0].checked) radios[0].click();
  }
  await sleep(400);

  // ④ 부위 select
  var cutEl = findInputByName(['cutCd', 'partCd', 'butchPartCd', 'partNm']) ||
    document.querySelector('select[name*="cut"], select[name*="part"], select[name*="Cut"]');
  if (cutEl && cutEl.tagName === 'SELECT') {
    if (!selectByText(cutEl, animal.cutName || '')) {
      toast('부위 "' + animal.cutName + '"을 드롭다운에서 찾지 못했습니다. 수동 선택 필요.', 'warn');
    }
    await sleep(400);
  }

  // ⑤ 신청량 입력
  var amtInput = findInputByName(['reqAmt', 'issueAmt', 'splyAmt', 'amt', 'weight']) ||
    document.querySelector('input[placeholder*="신청량"], input[placeholder*="중량"]');
  if (amtInput) {
    setVal(amtInput, animal.weightKg || '');
    await sleep(300);
  } else {
    toast('신청량 입력란을 찾지 못했습니다. 수동 입력 필요.', 'warn');
  }

  // ⑥ 발급신청 버튼 클릭
  await sleep(500);
  var submitBtn = findByText(['button', 'input', 'a'], ['발급신청', '신청', '저장', '확인']);
  if (submitBtn) {
    toast('발급신청 클릭!', 'ok');
    submitBtn.click();
  } else {
    toast('발급신청 버튼을 찾지 못했습니다. 수동으로 클릭해 주세요. 완료 후 팝업을 닫으면 자동 진행됩니다.', 'warn', 0);
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
  }
}

// 실행
main();
