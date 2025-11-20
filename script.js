// Data loaded from selections.json
let selections = { teachers: [], subjects: [], projects: [] };

// --- Service Worker registration (GitHub Pages /phsphoto) ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/phsphoto/service-worker.js');
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('Update available. Reload for latest.');
          }
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {});
    } catch (err) {
      console.warn('SW registration failed', err);
    }
  });
}

// UI refs
const initBtn = document.getElementById('initBtn');
const helpBtn = document.getElementById('helpBtn');
const themeBtn = document.getElementById('themeBtn');
const installBtn = document.getElementById('installBtn');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const preview = document.getElementById('preview');
const shootBtn = document.getElementById('shootBtn');
const shareBtn = document.getElementById('shareBtn');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const nameInput = document.getElementById('name');
const subjectInput = document.getElementById('subject'); // hidden internal subject text
const subjectSelect = document.getElementById('subjectSelect');
const projectSelect = document.getElementById('projectSelect');
const customProjectGroup = document.getElementById('customProjectGroup');
const customProjectInput = document.getElementById('customProjectInput');
const teacherSelect = document.getElementById('teacherSelect');
const teacherEmail = document.getElementById('teacherEmail');
const copyEmailBtn = document.getElementById('copyEmailBtn');
const teacherList = document.getElementById('teacherList');
const fileInput = document.getElementById('fileInput');
const fileStampBtn = document.getElementById('fileStampBtn');
const toast = document.getElementById('toast');
const overlayText = document.getElementById('overlayText');
const customTeacherGroup = document.getElementById('customTeacherGroup');
const customTeacherName = document.getElementById('customTeacherName');
const tipsDialog = document.getElementById('tipsDialog');
const recentStudentsDL = document.getElementById('recentStudents');

// State
let stream, stampedFile, lastMeta = null;
let logoImg = new Image(), logoReady = false;
let deferredPrompt = null;

// Try to preload crest
(function preloadLogo() {
  logoImg.onload = () => { logoReady = true; };
  logoImg.onerror = () => {
    logoReady = false;
    console.warn('Logo failed to load (crest-192.png)');
  };
  // crest-192.png must sit next to index.html
  logoImg.src = 'crest-192.png';
})();

// --- Helpers ---
function showToast(text, ok = true) {
  toast.textContent = text;
  toast.classList.toggle('error', !ok);
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 4500);
}

function getTheme() { return localStorage.getItem('phs_theme') || 'auto'; }

function setTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  try { localStorage.setItem('phs_theme', mode); } catch {}
}

function toggleTheme() {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : current === 'light' ? 'auto' : 'dark';
  setTheme(next);
  showToast(`Theme: ${next}`);
}

function persist() {
  const data = {
    student: nameInput.value || '',
    teacherId: teacherSelect.value || '',
    teacherEmail: teacherEmail.value || '',
    customTeacherName: customTeacherName.value || '',
    subjectId: subjectSelect.value || '',
    projectId: projectSelect.value || '',
    customProjectText: customProjectInput.value || ''
  };
  try { localStorage.setItem('printme_pref', JSON.stringify(data)); } catch {}
}

function restore() {
  try {
    const data = JSON.parse(localStorage.getItem('printme_pref') || '{}');
    if (data.student) nameInput.value = data.student;
    if (data.customTeacherName) customTeacherName.value = data.customTeacherName;
    if (data.teacherId) teacherSelect.value = data.teacherId;
    if (data.teacherEmail) teacherEmail.value = data.teacherEmail;

    // apply teacher filter to subjects
    handleTeacherSelectChange(false); // false = don't persist during restore

    if (data.subjectId) {
      subjectSelect.value = data.subjectId;
      populateProjects(data.subjectId);
    }

    if (data.projectId) {
      projectSelect.value = data.projectId;
    }

    if (data.customProjectText) {
      customProjectInput.value = data.customProjectText;
      customProjectGroup.style.display = '';
    }

    updateSubjectTextFromSelections();
  } catch {}
}

function loadRecentStudents() {
  try {
    const arr = JSON.parse(localStorage.getItem('recent_students') || '[]');
    recentStudentsDL.innerHTML = arr.map(s => `<option value="${s}"></option>`).join('');
  } catch {
    recentStudentsDL.innerHTML = '';
  }
}

function pushRecentStudent(name) {
  const s = (name || '').trim(); if (!s) return;
  try {
    const arr = JSON.parse(localStorage.getItem('recent_students') || '[]');
    const next = [s, ...arr.filter(x => x.toLowerCase() !== s.toLowerCase())].slice(0, 10);
    localStorage.setItem('recent_students', JSON.stringify(next));
    loadRecentStudents();
  } catch {}
}

// --- JSON-driven selections ---
// Preserve selected teacher where possible, even when filtering by subject
function populateTeachersFromSelections(filterSubjectId) {
  const previousId = teacherSelect.value;

  const teachers = filterSubjectId
    ? selections.teachers.filter(t => (t.subjects || []).includes(filterSubjectId))
    : selections.teachers;

  const options = teachers.map(t => `<option value="${t.id}">${t.name}</option>`);
  options.push('<option value="custom">Custom…</option>');
  teacherSelect.innerHTML = options.join('');

  let newId = previousId;
  if (!teachers.some(t => t.id === previousId)) {
    if (teachers[0]) newId = teachers[0].id;
    else newId = 'custom';
  }
  teacherSelect.value = newId;

  if (newId !== 'custom') {
    const t = selections.teachers.find(t => t.id === newId);
    teacherEmail.value = t?.email || '';
  } else {
    teacherEmail.value = '';
  }

  teacherList.innerHTML = selections.teachers
    .map(t => `<li><span>${t.name}</span><span><code>${t.email}</code></span></li>`)
    .join('');
}

// Preserve subject if still valid for the chosen teacher
function populateSubjects(filterTeacherId) {
  const previousId = subjectSelect.value;

  let availableSubjects = selections.subjects;

  if (filterTeacherId && filterTeacherId !== 'custom') {
    const teacher = selections.teachers.find(t => t.id === filterTeacherId);
    if (teacher) {
      availableSubjects = selections.subjects.filter(s => (teacher.subjects || []).includes(s.id));
    }
  }

  const options = ['<option value="">Select subject…</option>'].concat(
    availableSubjects.map(s => `<option value="${s.id}">${s.label}</option>`)
  );

  subjectSelect.innerHTML = options.join('');

  let newId = '';
  if (availableSubjects.some(s => s.id === previousId)) {
    newId = previousId;
  }
  subjectSelect.value = newId;
}

function populateProjects(subjectId) {
  const projects = selections.projects.filter(p => p.subjectId === subjectId);
  const options = ['<option value="">Select project…</option>'].concat(
    projects.map(p => `<option value="${p.id}">${p.label}</option>`)
  );
  projectSelect.innerHTML = options.join('');
  projectSelect.disabled = projects.length === 0;
  if (projects.length === 0) projectSelect.value = '';
  customProjectGroup.style.display = 'none';
  customProjectInput.value = '';
}

function formatTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const YYYY = now.getFullYear(), MM = pad(now.getMonth()+1), DD = pad(now.getDate());
  const hh = pad(now.getHours()), mm = pad(now.getMinutes());
  return {
    display: now.toLocaleString([], { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }),
    compact: `${YYYY}${MM}${DD}_${hh}${mm}`
  };
}

function getSelectedTeacherName() {
  const val = teacherSelect.value;
  if (val === 'custom') return (customTeacherName.value || '').trim();
  const t = selections.teachers.find(t => t.id === val);
  return t ? t.name : '';
}

function getSelectedSubjectLabel() {
  const subjId = subjectSelect.value;
  const s = selections.subjects.find(s => s.id === subjId);
  return s ? s.label : '';
}

function getSelectedProjectMeta() {
  const projId = projectSelect.value;
  return selections.projects.find(p => p.id === projId) || null;
}

// ---------- MULTI-LINE STAMP ----------
function buildStampText() {
  const studentName = (nameInput.value || '').trim();
  const teacherName = getSelectedTeacherName();
  const subj = (subjectInput.value || '').trim();
  const tsObj = formatTimestamp();

  const line1 = [studentName, teacherName].filter(Boolean).join(' • ');
  const line2 = ['Pukekohe High School', tsObj.display].join(' • ');
  const line3 = subj ? subj : null;

  const lines = [line1, line2, line3].filter(Boolean);
  return { lines, studentName, teacherName, subject: subj, tsDisplay: tsObj.display, tsCompact: tsObj.compact };
}

function updateOverlay() {
  const { lines } = buildStampText();
  overlayText.textContent = lines.join('\n');
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

// Stamp text top-right, crest top-left
function drawStampMultiline(ctx, lines, w, h) {
  const margin = Math.max(12, Math.round(w * 0.012));
  const fontSize = Math.max(20, Math.round(w * 0.03));
  const lineH = Math.round(fontSize * 1.25);
  const padX = Math.round(fontSize * 0.6);
  const padY = Math.round(fontSize * 0.5);

  ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  ctx.textBaseline = 'top';

  let maxWidth = 0;
  for (const ln of lines) maxWidth = Math.max(maxWidth, ctx.measureText(ln).width);

  const boxW = Math.ceil(maxWidth + padX * 2);
  const boxH = Math.ceil(lines.length * lineH + padY * 2);
  const x = w - margin - boxW, y = margin;

  // Top-right text box
  ctx.save();
  roundRect(ctx, x, y, boxW, boxH, Math.round(fontSize * 0.5));
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'right';

  const tx = x + boxW - padX;
  let ty = y + padY;
  for (const ln of lines) {
    ctx.fillText(ln, tx, ty);
    ty += lineH;
  }
  ctx.restore();

  // Crest TOP-LEFT (no extra box)
  if (logoReady) {
    const targetW = Math.max(48, Math.round(w * 0.12));
    const scale = targetW / logoImg.naturalWidth;
    const targetH = Math.round(logoImg.naturalHeight * scale);
    const gap = Math.round(w * 0.02);

    const lx = gap; // left
    const ly = gap; // top

    ctx.save();
    ctx.drawImage(logoImg, lx, ly, targetW, targetH);
    ctx.restore();
  }
}

function sanitizeName(str) {
  return (str || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildFilename({ studentName, teacherName, tsCompact }) {
  const s = sanitizeName(studentName) || 'Unknown';
  const t = sanitizeName(teacherName) || 'Unknown';
  return `PHS_${s}_${t}_${tsCompact}.jpg`;
}

function updateSubjectTextFromSelections() {
  const subjLabel = getSelectedSubjectLabel();
  const projMeta = getSelectedProjectMeta();
  let projectLabel = projMeta?.label || '';

  if (projMeta?.allowCustomName && customProjectInput.value.trim()) {
    projectLabel = customProjectInput.value.trim();
  }

  subjectInput.value = [subjLabel, projectLabel].filter(Boolean).join(' — ');
  updateOverlay();
  persist();
}

// ---------- STAMPING FLOW ----------
function stampFromImage(img) {
  const maxW = 800;
  const scale = Math.min(1, maxW / img.naturalWidth);
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);

  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  const { lines, studentName, teacherName, subject, tsDisplay, tsCompact } = buildStampText();
  drawStampMultiline(ctx, lines, w, h);

  preview.src = canvas.toDataURL('image/jpeg', 0.85);
  preview.style.display = 'block';
  video.style.display = 'none';

  return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85)).then(blob => {
    const fname = buildFilename({ studentName, teacherName, tsCompact });
    stampedFile = new File([blob], fname, { type: 'image/jpeg' });

    lastMeta = {
      studentName: studentName || 'Unknown',
      teacherName: teacherName || 'Unknown',
      teacherEmail: teacherEmail.value || '',
      subject: subject || '',
      ts: tsDisplay,
      filename: fname
    };

    shareBtn.disabled = false;
    downloadBtn.disabled = false;
    pushRecentStudent(studentName);
    showToast('Photo ready. Tap Share or Download.');
  });
}

async function initCamera() {
  try {
    const constraints = { audio: false, video: { facingMode: { ideal: 'environment' } } };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    shootBtn.disabled = false;
    initBtn.disabled = true;
    showToast('Camera enabled.');
  } catch (err) {
    console.error(err);
    showToast('Could not access camera. Allow permission in browser settings.', false);
  }
}

async function captureAndStamp() {
  if (!stream) {
    await initCamera();
    if (!stream) return;
  }
  if (!nameInput.value.trim() || !teacherSelect.value) {
    return showToast('Enter student name and select teacher.', false);
  }
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return showToast('Camera not ready. Try again.', false);

  const off = document.createElement('canvas');
  off.width = vw; off.height = vh;
  off.getContext('2d').drawImage(video, 0, 0);

  const img = new Image();
  img.onload = () => stampFromImage(img);
  img.src = off.toDataURL('image/jpeg', 0.9);
}

async function chooseFileAndStamp() {
  if (!nameInput.value.trim() || !teacherSelect.value) {
    return showToast('Enter student name and select teacher.', false);
  }
  const f = fileInput.files && fileInput.files[0];
  if (!f) return showToast('Choose a photo first.', false);

  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); stampFromImage(img); };
  img.src = url;
}

async function sharePhoto() {
  if (!stampedFile) return showToast('No image to share. Capture or choose first.', false);

  const body = `Student: ${lastMeta?.studentName || 'Unknown'}
Teacher: ${lastMeta?.teacherName || 'Unknown'} (${lastMeta?.teacherEmail || ''})
Subject: ${lastMeta?.subject || '-'}
Time: ${lastMeta?.ts || ''}`;

  if (navigator.canShare && navigator.canShare({ files: [stampedFile] })) {
    try {
      await navigator.share({
        files: [stampedFile],
        title: lastMeta?.filename || 'PHS evidence',
        text: body
      });
      showToast('Shared. Choose your email app to send.');
    } catch (err) {
      console.warn('Share cancelled or failed', err);
      showToast('Share cancelled or not supported on this device.', false);
    }
  } else {
    downloadImage();
  }
}

function downloadImage() {
  if (!stampedFile) return showToast('Nothing to download yet.', false);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(stampedFile);
  a.download = lastMeta?.filename || 'photo.jpg';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  showToast('Downloaded.');
}

function clearAll() {
  stampedFile = null;
  lastMeta = null;
  preview.style.display = 'none';
  video.style.display = 'block';
  shareBtn.disabled = true;
  downloadBtn.disabled = true;
  showToast('Cleared.');
}

// When teacher changes, preserve subject + project if still valid
function handleTeacherSelectChange(shouldPersist = true) {
  const prevSubjectId = subjectSelect.value;

  const idx = teacherSelect.value;
  const isCustom = idx === 'custom';
  customTeacherGroup.style.display = isCustom ? '' : 'none';

  if (!isCustom) {
    const t = selections.teachers.find(t => t.id === idx);
    teacherEmail.value = t?.email || '';
    populateSubjects(idx);
  } else {
    teacherEmail.value = '';
    populateSubjects();
  }

  const newSubjectId = subjectSelect.value;

  if (newSubjectId !== prevSubjectId) {
    populateProjects(newSubjectId);
  }

  if (shouldPersist) {
    updateSubjectTextFromSelections();
  } else {
    updateOverlay();
  }
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
    if (!shootBtn.disabled) captureAndStamp();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!shareBtn.disabled) sharePhoto();
    else if (!downloadBtn.disabled) downloadImage();
  }
});

// --- PWA install prompt (optional install button) ---
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = '';
});

installBtn?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  installBtn.disabled = true;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.style.display = 'none';
});

window.addEventListener('appinstalled', () => {
  installBtn.style.display = 'none';
});

function isIosStandalone() {
  return (window.navigator.standalone === true) ||
         window.matchMedia('(display-mode: standalone)').matches;
}
function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}
if (isIos() && !isIosStandalone()) {
  // Optional: showToast('Tip: On iPhone/iPad, use Share → Add to Home Screen to install.');
}

if (navigator.mediaDevices && navigator.permissions) {
  navigator.permissions.query({ name: 'camera' }).then(p => {
    if (p.state === 'granted') initCamera();
  }).catch(() => {});
}

async function loadSelections() {
  try {
    const res = await fetch('selections.json');
    selections = await res.json();
    populateTeachersFromSelections();
    populateSubjects();
    restore();
  } catch (err) {
    console.error('Failed to load selections.json', err);
    showToast('Could not load selections (teachers/subjects).', false);
    updateOverlay();
  }
}

// Init
(function init(){
  setTheme(getTheme());
  loadRecentStudents();
  loadSelections();
})();
