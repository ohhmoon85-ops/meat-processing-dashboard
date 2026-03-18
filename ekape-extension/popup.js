'use strict';

const JOB_KEY  = 'ekape_issue_job';
const SETT_KEY = 'ekape_auto_settings';
const DEFAULT  = { autoStart: true, autoPrint: false };

const $ = function (id) { return document.getElementById(id); };

// ── 설정 로드 ────────────────────────────────────────────────
chrome.storage.local.get(SETT_KEY, function (data) {
  const s = Object.assign({}, DEFAULT, data[SETT_KEY] || {});
  $('autoStart').checked = s.autoStart;
  $('autoPrint').checked = s.autoPrint;
});

// ── 설정 저장 ────────────────────────────────────────────────
$('saveBtn').addEventListener('click', function () {
  const settings = { autoStart: $('autoStart').checked, autoPrint: $('autoPrint').checked };
  const d = {};
  d[SETT_KEY] = settings;
  chrome.storage.local.set(d, function () {
    const btn = $('saveBtn');
    btn.textContent = '✓ 저장 완료!';
    btn.classList.add('saved');
    setTimeout(function () { btn.textContent = '설정 저장'; btn.classList.remove('saved'); }, 1500);
  });
});

// ── 작업 취소 ────────────────────────────────────────────────
$('cancelBtn').addEventListener('click', function () {
  chrome.runtime.sendMessage({ type: 'CANCEL_JOB' });
});

// ── 작업 상태 표시 ───────────────────────────────────────────
function refreshStatus() {
  chrome.storage.local.get(JOB_KEY, function (data) {
    const job = data[JOB_KEY];

    if (!job || job.status === 'idle' || job.status === 'cancelled' || !job.animals) {
      $('jobHeader').className = 'job-header idle';
      $('jobIcon').textContent = '💤';
      $('jobStatusText').textContent = '대기 중';
      $('jobBody').style.display = 'none';
      $('noJob').style.display = '';
      return;
    }

    $('noJob').style.display = 'none';
    $('jobBody').style.display = '';

    const done  = job.animals.filter(function (a) { return a.done; }).length;
    const total = job.animals.length;
    $('jobProgress').textContent = done + ' / ' + total;

    const cur = job.animals[job.currentIndex];
    $('jobCurrent').textContent = cur
      ? '처리 중: ' + cur.animalNumber + (cur.destination ? ' (' + cur.destination + ')' : '')
      : '';

    if (job.status === 'done') {
      $('jobHeader').className = 'job-header ok';
      $('jobIcon').textContent = '✅';
      $('jobStatusText').textContent = '완료!';
      $('cancelBtn').style.display = 'none';
    } else if (job.status === 'error' || job.status === 'cancelled') {
      $('jobHeader').className = 'job-header err';
      $('jobIcon').textContent = '❌';
      $('jobStatusText').textContent = job.status === 'cancelled' ? '중단됨' : '오류 발생';
      $('cancelBtn').style.display = 'none';
    } else {
      $('jobHeader').className = 'job-header';
      $('jobIcon').textContent = '⏳';
      $('jobStatusText').textContent = '진행 중... (Phase: ' + (job.phase || '-') + ')';
      $('cancelBtn').style.display = '';
    }
  });
}

refreshStatus();
setInterval(refreshStatus, 1000);
