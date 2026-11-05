const $ = document.querySelector.bind(document);
const els = {
  gaugeValue: $("#gaugeValue"), gaugeLabel: $("#gaugeLabel"), gaugeArc: $("#gaugeArc"),
  startBtn: $("#startBtn"), cancelBtn: $("#cancelBtn"),
  dlValue: $("#dlValue"), ulValue: $("#ulValue"), pingValue: $("#pingValue"),
  jitterValue: $("#jitterValue"), serverValue: $("#serverValue"),
  dlMeter: $("#dlMeter"), ulMeter: $("#ulMeter"),
  dlBadge: $("#dlBadge"), ulBadge: $("#ulBadge"),
  dlSub: $("#dlSub"), ulSub: $("#ulSub"), pingSub: $("#pingSub"),
  verdictPill: $("#verdictPill"), verdictText: $("#verdictText"), verdictList: $("#verdictList"),
  copyBtn: $("#copyBtn"), shareBtn: $("#shareBtn"), copyFeedback: $("#copyFeedback"),
  historyList: $("#historyList"), clearHistoryBtn: $("#clearHistoryBtn"),
  aboutBtn: $("#aboutBtn"), aboutDialog: $("#aboutDialog"), closeDialogBtn: $("#closeDialogBtn"),
  settingsBtn: $("#settingsBtn"), settingsDialog: $("#settingsDialog"), saveSettingsBtn: $("#saveSettingsBtn"), cancelSettingsBtn: $("#cancelSettingsBtn"),
  dlDurationInput: $("#dlDurationInput"), dlParallelInput: $("#dlParallelInput"), ulDurationInput: $("#ulDurationInput"), ulParallelInput: $("#ulParallelInput"),
  fixPanel: $("#fixPanel"), fixTitle: $("#fixTitle"), fixText: $("#fixText"), fixLink: $("#fixLink"),
  ticks: $("#ticks"),
};

let isRunning = false;
let abortController = null;
let lastResult = null;
let totalBytes = 0; // rough global tally for display

// Gauge setup
function speedToFraction(mbps){
  if(mbps<=0) return 0;
  if(mbps>=1000) return 1;
  if(mbps<10) return (mbps/10)*0.2;
  if(mbps<50) return 0.2 + ((mbps-10)/40)*0.2;
  if(mbps<100) return 0.4 + ((mbps-50)/50)*0.2;
  if(mbps<500) return 0.6 + ((mbps-100)/400)*0.2;
  return 0.8 + ((mbps-500)/500)*0.2;
}
function setGauge(mbps, labelText){
  els.gaugeValue.textContent = Math.max(0, mbps).toFixed(mbps>=100?0:1);
  const frac = speedToFraction(mbps);
  els.gaugeArc.style.strokeDashoffset = 424 - (frac * 424);
  if(labelText) els.gaugeLabel.textContent = labelText;
}

const fmt = (val,dec=1)=>val.toFixed(dec);

function setProgress(pct){ $("#progressBar").style.width = `${pct}%`; }
function setStep(step, state){
  const el = document.querySelector(`[data-step="${step}"]`);
  if(el) el.className = `step ${state}`;
}

// CF Speed API wrappers
const DL_URL = "https://speed.cloudflare.com/__down";
const UL_URL = "https://speed.cloudflare.com/__up";

async function measurePing(signal){
  let times=[];
  for(let i=0;i<10;i++){
    if(signal.aborted) break;
    const s=performance.now();
    try{ await fetch(`${DL_URL}?bytes=0`, {signal, cache:'no-store'}); }catch{}
    times.push(performance.now()-s);
    totalBytes+=100;
  }
  if(times.length===0) return {ping:0, jitter:0};
  times.sort((a,b)=>a-b);
  const med = times[Math.floor(times.length/2)];
  let jitters=[];
  for(let i=1;i<times.length;i++) jitters.push(Math.abs(times[i]-times[i-1]));
  const jMed = jitters.length>0 ? jitters[Math.floor(jitters.length/2)] : 0;
  return {ping: med, jitter: jMed};
}

// --- Download ---
async function measureDownload(signal, onProgress){
  const DURATION_MS = TEST_CONFIG.dlDuration * 1000;
  const PARALLEL = TEST_CONFIG.dlParallel;
  const start = performance.now();
  let bytes = 0;
  let lastBytes = 0;
  let lastTime = start;
  let currentMbps = 0;

  const worker = async ()=>{
    let targetSize = 100_000; // start small
    while(performance.now()-start < DURATION_MS && !signal.aborted){
      try{
        const r = await fetch(`${DL_URL}?bytes=${targetSize}`, {signal, cache:'no-store'});
        const b = parseInt(r.headers.get("content-length")||"0",10) || targetSize;
        await r.arrayBuffer(); // consume
        bytes += b;
        targetSize = Math.min(targetSize*4, 25_000_000); // ramp up
      }catch{
        break;
      }
    }
  };

  const progressTimer = setInterval(()=>{
    const now = performance.now();
    const elapsed = (now-start)/1000;
    if(elapsed<=0) return;
    const intervalBytes = bytes-lastBytes;
    const intervalTime = (now-lastTime)/1000;
    if(intervalTime>0.25){
      currentMbps = (intervalBytes*8)/(intervalTime*1_000_000);
      lastBytes = bytes; lastTime = now;
    }
    const overallMbps = (bytes*8)/(elapsed*1_000_000);
    // Smooth out initial spikes
    const display = currentMbps>0 ? (currentMbps*0.6 + overallMbps*0.4) : overallMbps;
    onProgress(display, bytes, elapsed);
  }, 200);

  try{ await Promise.all(Array.from({length: PARALLEL}, worker)); }
  finally{ clearInterval(progressTimer); }

  const elapsed = (performance.now()-start)/1000;
  const mbps = (bytes*8)/(elapsed*1_000_000);
  totalBytes += bytes;
  return { mbps, bytes, elapsed };
}

// --- Upload ---
async function measureUpload(signal, onProgress){
  const DURATION_MS = TEST_CONFIG.ulDuration * 1000;
  const PARALLEL = TEST_CONFIG.ulParallel;
  const start = performance.now();
  let bytes = 0;
  let lastBytes = 0, lastTime = start, currentMbps = 0;

  const getPayload = (size)=>{
    const p = new Uint8Array(size);
    for(let i=0;i<size;i++) p[i]=Math.random()*256;
    return p;
  };

  const worker = async ()=>{
    let targetSize = 50_000;
    while(performance.now()-start < DURATION_MS && !signal.aborted){
      try{
        const payload = getPayload(targetSize);
        await fetch(UL_URL, {method:'POST', signal, body:payload, headers:{'Content-Type':'application/octet-stream'}});
        bytes += payload.length;
        targetSize = Math.min(targetSize*2, 2_000_000);
      }catch{
        break;
      }
    }
  };

  const progressTimer = setInterval(()=>{
    const now = performance.now();
    const elapsed = (now-start)/1000;
    if(elapsed<=0) return;
    const intervalBytes = bytes-lastBytes;
    const intervalTime = (now-lastTime)/1000;
    if(intervalTime>0.25){
      currentMbps = (intervalBytes*8)/(intervalTime*1_000_000);
      lastBytes = bytes; lastTime = now;
    }
    const overallMbps = (bytes*8)/(elapsed*1_000_000);
    const display = currentMbps>0 ? (currentMbps*0.6 + overallMbps*0.4) : overallMbps;
    onProgress(display, bytes, elapsed);
  }, 200);

  try{ await Promise.all(Array.from({length: PARALLEL}, worker)); }
  finally{ clearInterval(progressTimer); }

  const elapsed = (performance.now()-start)/1000;
  const mbps = (bytes*8)/(elapsed*1_000_000);
  totalBytes += bytes;
  return { mbps, bytes, elapsed };
}

// --- History (localStorage) ---
const HISTORY_KEY = "pulse-speed-history-v1";
function loadHistory(){
  try{ return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }catch{ return []; }
}
function saveHistory(entry){
  const list = loadHistory();
  list.unshift(entry);
  const trimmed = list.slice(0,8);
  try{ localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed)); }catch{}
  renderHistory(trimmed);
}
function renderHistory(list = loadHistory()){
  if(!list.length){
    els.historyList.innerHTML = `<p class="empty">No tests yet. Your last 8 results will appear here and stay on this device.</p>`;
    return;
  }
  els.historyList.innerHTML = list.map(h=>{
    const d = new Date(h.time);
    const when = d.toLocaleString(undefined,{month:"short", day:"numeric", hour:"numeric", minute:"2-digit"});
    const score = h.dl>=50 ? "Fast" : h.dl>=25 ? "Good" : h.dl>=10 ? "Fair" : "Slow";
    return `<div class="history-item">
      <div class="h-when">${when}</div>
      <div class="h-vals"><span>↓ ${fmt(h.dl, h.dl>=100?0:1)} Mbps</span> &nbsp; <span>↑ ${fmt(h.ul, h.ul>=100?0:1)} Mbps</span> &nbsp; <span>${fmt(h.ping,0)} ms</span></div>
      <div class="h-score">${score}</div>
    </div>`;
  }).join("");
}
renderHistory();

// --- UI reset / run ---
function resetUI(){
  setGauge(0, "Press Start Test");
  els.dlValue.textContent="—"; els.ulValue.textContent="—"; els.pingValue.textContent="—";
  els.jitterValue.textContent="—";
  els.dlMeter.style.width="0%"; els.ulMeter.style.width="0%";
  els.dlBadge.textContent="—"; els.dlBadge.className="card-badge";
  els.ulBadge.textContent="—"; els.ulBadge.className="card-badge";
  els.dlSub.textContent="Your download speed"; els.ulSub.textContent="Your upload speed";
  els.pingSub.textContent="Latency to edge server";
  els.verdictPill.textContent="Not tested"; els.verdictText.textContent="Run a test to see what your connection is good for — streaming, gaming, calls, and more.";
  els.verdictList.innerHTML = `
    <div class="v-row"><span>4K streaming</span><b>—</b></div>
    <div class="v-row"><span>Video calls</span><b>—</b></div>
    <div class="v-row"><span>Online gaming</span><b>—</b></div>
    <div class="v-row"><span>Large uploads</span><b>—</b></div>`;
  els.copyBtn.disabled = true; els.shareBtn.disabled = true;
  els.copyFeedback.textContent="";
  els.fixPanel.classList.add("hidden");
  setProgress(0);
  ["ping","download","upload","done"].forEach(s=>setStep(s,""));
}

async function runTest(){
  if(isRunning) return;
  isRunning = true;
  totalBytes = 0;
  testStart = performance.now();
  abortController = new AbortController();
  const signal = abortController.signal;

  resetUI();
  els.startBtn.disabled = true;
  $("#startBtnText").textContent = "Testing…";
  els.cancelBtn.classList.remove("hidden");
  $("#phaseLabel").textContent = "Testing"; $("#phaseLabel").classList.add("testing");
  $("#serverPill").innerHTML = `<span class="dot dot-live"></span> Testing — Cloudflare Edge`;
  $("#liveHint").textContent="Measuring latency — sending tiny pings to the edge…";

  // Meta
  fetch("https://speed.cloudflare.com/meta").then(r=>r.json()).then(meta=>{
    if(meta){
      const coloObj = meta.colo && typeof meta.colo==="object" ? meta.colo : null;
      const colo = coloObj ? (coloObj.iata || coloObj.city || "") : (meta.colo || "");
      const coloCity = coloObj ? (coloObj.city || meta.city || "") : (meta.city || "");
      const coloLabel = colo ? (coloCity && coloCity !== colo ? `${colo} — ${coloCity}` : colo) : coloCity;
      if(coloLabel){ els.serverValue.textContent = coloLabel; $("#dServer").textContent = `Cloudflare — ${coloLabel} (closest edge)`; }
      if(meta.clientIp) $("#dIp").textContent = meta.clientIp;
    }
  }).catch(()=>{});

  try{
    // Ping
    setStep("ping","active"); setProgress(5);
    const pingRes = await measurePing(signal);
    if(signal.aborted) throw new DOMException("Aborted","AbortError");
    els.pingValue.textContent = fmt(pingRes.ping,0); els.jitterValue.textContent = `${fmt(pingRes.jitter,1)} ms`;
    els.pingSub.textContent = pingRes.ping<=30 ? "Very responsive" : pingRes.ping<=60 ? "Responsive" : "Noticeable delay";
    setStep("ping","done"); setProgress(18);

    // Download
    setStep("download","active"); $("#liveHint").textContent="Measuring download — opening parallel streams…";
    const dlRes = await measureDownload(signal, (mbps, bytes, sec)=>{
      setGauge(mbps, "Downloading…");
      els.dlValue.textContent = fmt(mbps, mbps>=100?0:1);
      setProgress(18 + (sec/10)*40); // estimate up to ~58%
    });
    if(signal.aborted) throw new DOMException("Aborted","AbortError");
    els.dlValue.textContent = fmt(dlRes.mbps, dlRes.mbps>=100?0:1);
    els.dlMeter.style.width = `${speedToFraction(dlRes.mbps)*100}%`;
    const isDlGood = dlRes.mbps>=25;
    els.dlBadge.textContent = dlRes.mbps>=50?"Good":dlRes.mbps>=15?"Okay":"Slow";
    els.dlBadge.className = `card-badge ${dlRes.mbps>=50?"good":dlRes.mbps>=15?"ok":"slow"}`;
    els.dlSub.textContent = dlRes.mbps>=50?"Great for 4K":"Okay for HD";
    setStep("download","done"); setProgress(58);
    await new Promise(r=>setTimeout(r, 400)); // pause

    // Upload
    setStep("upload","active"); $("#liveHint").textContent="Measuring upload — sending data to the edge…";
    const ulRes = await measureUpload(signal, (mbps, bytes, sec)=>{
      setGauge(mbps, "Uploading…");
      els.ulValue.textContent = fmt(mbps, mbps>=100?0:1);
      setProgress(62 + (sec/10)*30);
    });
    if(signal.aborted) throw new DOMException("Aborted","AbortError");
    els.ulValue.textContent = fmt(ulRes.mbps, ulRes.mbps>=100?0:1);
    els.ulMeter.style.width = `${speedToFraction(ulRes.mbps)*100}%`;
    const isUlGood = ulRes.mbps>=10;
    els.ulBadge.textContent = ulRes.mbps>=20?"Good":ulRes.mbps>=5?"Okay":"Slow";
    els.ulBadge.className = `card-badge ${ulRes.mbps>=20?"good":ulRes.mbps>=5?"ok":"slow"}`;
    els.ulSub.textContent = ulRes.mbps>=20?"Fast for calls":"Slow for large uploads";
    setStep("upload","done"); setProgress(100);

    // Done
    setStep("done","done");
    const dur = (performance.now()-testStart)/1000;

    // Verdict
    const score = (isDlGood?2:1) + (isUlGood?2:1) + (pingRes.ping<=50?2:1);
    els.verdictPill.textContent = score>=5?"Excellent":score>=3?"Good":"Weak";
    els.verdictText.textContent = score>=5?"This connection is fast and responsive.":score>=3?"This connection is solid for everyday use.":"This connection is struggling.";
    els.verdictList.innerHTML = `
      <div class="v-row"><span>4K streaming</span><b>${dlRes.mbps>=25?"Good":"Struggles"}</b></div>
      <div class="v-row"><span>Video calls</span><b>${dlRes.mbps>=10&&ulRes.mbps>=3?"Good":"Struggles"}</b></div>
      <div class="v-row"><span>Online gaming</span><b>${pingRes.ping<=50?"Good":"Struggles"}</b></div>
      <div class="v-row"><span>Large uploads</span><b>${ulRes.mbps>=20?"Good":"Struggles"}</b></div>`;

    setGauge(dlRes.mbps, `Download ${fmt(dlRes.mbps, dlRes.mbps>=100?0:1)} • Upload ${fmt(ulRes.mbps, ulRes.mbps>=100?0:1)}`);
    $("#phaseLabel").textContent = "Complete"; $("#phaseLabel").classList.remove("testing");
    $("#liveHint").textContent = "Test complete. Run again to confirm — speeds vary with network load.";
    $("#dDuration").textContent = `${dur.toFixed(1)}s`;
    $("#dData").textContent = `${(totalBytes/1_000_000).toFixed(1)} MB`;
    $("#dTime").textContent = new Date().toLocaleString();

    showFixTip(dlRes.mbps, ulRes.mbps, pingRes.ping);

    lastResult = { dl: dlRes.mbps, ul: ulRes.mbps, ping: pingRes.ping, jitter: pingRes.jitter, time: Date.now() };
    saveHistory(lastResult);
    els.copyBtn.disabled = false; els.shareBtn.disabled = false;

  }catch(e){
    if(e.name==="AbortError"){
      $("#phaseLabel").textContent = "Cancelled"; $("#phaseLabel").classList.remove("testing");
      $("#liveHint").textContent="Test cancelled. Press Start Test to try again.";
      setGauge(0,"Cancelled");
    }else{
      $("#phaseLabel").textContent = "Error"; $("#phaseLabel").classList.remove("testing");
      $("#liveHint").textContent = "Something went wrong. Check your connection.";
      setGauge(0,"Test failed");
    }
    setProgress(0);
    ["ping","download","upload","done"].forEach(s=>setStep(s,""));
  }finally{
    isRunning = false;
    els.startBtn.disabled = false;
    $("#startBtnText").textContent = lastResult ? "Test Again" : "Start Test";
    els.cancelBtn.classList.add("hidden");
    $("#serverPill").innerHTML = `<span class="dot dot-idle"></span> Cloudflare Edge`;
    abortController = null;
  }
}

els.startBtn.addEventListener("click", runTest);
els.cancelBtn.addEventListener("click", ()=>{ if(abortController) abortController.abort(); });
els.clearHistoryBtn.addEventListener("click", ()=>{ localStorage.removeItem(HISTORY_KEY); renderHistory([]); });
els.aboutBtn.addEventListener("click", ()=> els.aboutDialog.showModal());
els.closeDialogBtn.addEventListener("click", ()=> els.aboutDialog.close());
els.aboutDialog.addEventListener("click", (e)=>{ if(e.target===els.aboutDialog) els.aboutDialog.close(); });

// Tip Logic
const AFFILIATE = { tag: "pulse-tips-20", baseUrl: "https://www.example.com/shop" };
function tipFor(dl, ul, ping) {
  if (ping > 80 && dl > 50) return { title: "High latency detected", text: "Your ping is noticeably high. Upgrading to a mesh Wi-Fi system can reduce latency drops.", url: `${AFFILIATE.baseUrl}/mesh-wifi?tag=${AFFILIATE.tag}` };
  if (dl < 20) return { title: "Slow download speed", text: "Your speeds are lower than what most modern households need. An upgraded router with Wi-Fi 6 can help.", url: `${AFFILIATE.baseUrl}/wifi6-router?tag=${AFFILIATE.tag}` };
  return null;
}
function showFixTip(dl, ul, ping) {
  const tip = tipFor(dl, ul, ping);
  if (!tip) { els.fixPanel.classList.add("hidden"); return; }
  els.fixTitle.textContent = tip.title; els.fixText.textContent = tip.text;
  els.fixLink.href = tip.url; els.fixLink.classList.remove("hidden");
  els.fixPanel.classList.remove("hidden");
}

document.addEventListener("keydown", (e)=>{
  if(e.code==="Space" && document.activeElement===document.body){ e.preventDefault(); if(!isRunning) runTest(); }
});


// --- Settings Config ---
const CONFIG_KEY = "pulse-speed-config-v1";
let TEST_CONFIG = { dlDuration: 10, dlParallel: 4, ulDuration: 10, ulParallel: 3 };
try{
  const saved = JSON.parse(localStorage.getItem(CONFIG_KEY));
  if(saved) TEST_CONFIG = { ...TEST_CONFIG, ...saved };
}catch{}

function applyConfigToUI() {
  if(els.dlDurationInput) els.dlDurationInput.value = TEST_CONFIG.dlDuration;
  if(els.dlParallelInput) els.dlParallelInput.value = TEST_CONFIG.dlParallel;
  if(els.ulDurationInput) els.ulDurationInput.value = TEST_CONFIG.ulDuration;
  if(els.ulParallelInput) els.ulParallelInput.value = TEST_CONFIG.ulParallel;
}
applyConfigToUI();

if(els.settingsBtn) {
  els.settingsBtn.addEventListener("click", () => {
    applyConfigToUI();
    els.settingsDialog.showModal();
  });
}
if(els.cancelSettingsBtn) els.cancelSettingsBtn.addEventListener("click", () => els.settingsDialog.close());
if(els.saveSettingsBtn) {
  els.saveSettingsBtn.addEventListener("click", () => {
    TEST_CONFIG = {
      dlDuration: Math.max(5, Math.min(30, parseInt(els.dlDurationInput.value, 10) || 10)),
      dlParallel: Math.max(1, Math.min(10, parseInt(els.dlParallelInput.value, 10) || 4)),
      ulDuration: Math.max(5, Math.min(30, parseInt(els.ulDurationInput.value, 10) || 10)),
      ulParallel: Math.max(1, Math.min(10, parseInt(els.ulParallelInput.value, 10) || 3)),
    };
    try{ localStorage.setItem(CONFIG_KEY, JSON.stringify(TEST_CONFIG)); }catch{}
    els.settingsDialog.close();
  });
}
if(els.settingsDialog) els.settingsDialog.addEventListener("click", (e) => { if (e.target === els.settingsDialog) els.settingsDialog.close(); });
